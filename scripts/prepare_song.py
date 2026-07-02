#!/usr/bin/env python3
"""
Acordazos — Pipeline de preparación de canciones.
Uso: python3 scripts/prepare_song.py <YouTube-URL> [--name NOMBRE]

Descarga un tema de YouTube, separa stems con Demucs, detecta TODAS las notas
del audio armónico completo, agrupa simultáneas como acordes,
y genera un chart JSON + audio listo para jugar.
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

_PYTHON = '/usr/bin/python3'

def ensure_python3():
    try:
        import librosa
    except ImportError:
        os.execv(_PYTHON, [_PYTHON] + sys.argv)

ensure_python3()

_PYTHON_SITE = os.path.expanduser("~/Library/Python/3.9/lib/python/site-packages")
if os.path.isdir(_PYTHON_SITE) and _PYTHON_SITE not in sys.path:
    sys.path.insert(0, _PYTHON_SITE)

import numpy as np
import librosa

# ─── Config ──────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
SONGS_DIR = REPO_ROOT / "public" / "songs"
TEMP_DIR = REPO_ROOT / "temp_audio"

MIDI_MIN = 36   # C2 — borde izquierdo del Yamaha E333
MIDI_MAX = 96   # C7 — borde derecho
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Parámetros de detección
SR = 22050              # sample rate para análisis
HOP_LENGTH = 256        # resolución temporal ~11.6ms a 22050Hz
ONSET_MARGIN = 3        # frames de margen para agrupar onset → notes
MIN_NOTE_SPACING = 0.06 # segundos mínimos entre notas de la misma pitch
ENERGY_PERCENTILE = 60  # percentil para threshold de energía
CHORD_WINDOW = 0.05     # ventana en segundos para agrupar notas en acordes


def midi_to_name(note):
    octave = (note // 12) - 1
    return f"{NOTE_NAMES[note % 12]}{octave}"


def freq_to_midi(freq):
    if freq <= 0:
        return 0
    note = 12 * (math.log2(freq / 440.0)) + 69
    return int(round(note))


def clamp_midi(note):
    return max(MIDI_MIN, min(MIDI_MAX, note))


def log(msg):
    print(f"  🎵 {msg}")


# ─── Paso 1: Descargar de YouTube ────────────────────────────────────────
def download_audio(url, output_dir):
    log("Descargando audio desde YouTube...")
    out_path = output_dir / "full.wav"
    cmd = [
        _PYTHON, "-m", "yt_dlp",
        "--no-warnings",
        "--extractor-args", "youtube:player_client=android",
        "-x",
        "--audio-format", "wav",
        "-o", str(output_dir / "full.%(ext)s"),
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp falló: {proc.stderr[:500]}")
    if not out_path.exists():
        raise FileNotFoundError(f"No se encontró el audio descargado en {out_path}")

    meta_cmd = [_PYTHON, "-m", "yt_dlp", "--no-warnings", "--extractor-args", "youtube:player_client=android",
                "--print", "title", "--print", "channel", "--print", "duration", url]
    meta_proc = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=30)
    meta_lines = meta_proc.stdout.strip().split("\n")
    title = meta_lines[0] if len(meta_lines) > 0 else Path(out_path).stem
    artist = meta_lines[1] if len(meta_lines) > 1 else "Unknown Artist"
    try:
        duration = float(meta_lines[2]) if len(meta_lines) > 2 else 0
    except ValueError:
        duration = 0

    log(f"  Título: {title}")
    log(f"  Artista: {artist}")
    log(f"  Duración: {duration:.0f}s")
    return out_path, title, artist, duration


# ─── Paso 2: Separar stems con Demucs ────────────────────────────────────
def separate_stems(audio_path, output_dir):
    """Separa stems con Demucs. Retorna dict {stem_name: path}"""
    log("Separando stems con Demucs (puede tardar)...")
    stems_out = output_dir / "stems"
    stems_out.mkdir(parents=True, exist_ok=True)

    models_to_try = ['htdemucs_6s', 'htdemucs']
    result = None
    used_model = 'htdemucs'

    for model in models_to_try:
        cmd = [
            _PYTHON, "-m", "demucs",
            "-n", model,
            "-o", str(stems_out),
            str(audio_path),
        ]
        try:
            import torch
            if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                cmd.extend(['-d', 'mps'])
        except ImportError:
            pass

        log(f"  Modelo: {model}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            used_model = model
            break
        log(f"  Modelo {model} falló, probando siguiente...")

    if result and result.returncode != 0:
        print("ERROR Demucs:", result.stderr[:500])
        raise RuntimeError("Demucs falló")

    stem_name = audio_path.stem
    demucs_out = stems_out / used_model / stem_name
    if not demucs_out.exists():
        candidates = list(stems_out.rglob(stem_name))
        demucs_out = candidates[0] if candidates else demucs_out

    stems = {}
    for f in demucs_out.iterdir():
        if f.suffix in ('.wav', '.mp3'):
            stem_key = f.stem.lower()
            stems[stem_key] = f

    log(f"  Stems: {', '.join(stems.keys())}")
    return stems


# ─── Paso 3: Detectar BPM ────────────────────────────────────────────────
def detect_bpm(audio_path):
    log("Detectando BPM...")
    y, sr = librosa.load(str(audio_path), sr=22050, duration=60)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(tempo)
    log(f"  BPM: {bpm:.1f}")
    return bpm


# ─── Paso 4: Detectar TODAS las notas del audio armónico ────────────────
def mix_harmonic_stems(stems, output_dir):
    """
    Mezcla stems armónicos (piano, guitar, other, bass) en un solo WAV.
    Esto nos da la música SIN voces ni batería, ideal para detectar notas.
    """
    harmonic_sources = []
    for key in ['piano', 'guitar', 'other', 'bass']:
        if key in stems:
            harmonic_sources.append(str(stems[key]))

    if not harmonic_sources:
        return None

    mixed_path = output_dir / "harmonic_mix.wav"

    # Usar ffmpeg para mezclar varios WAVs
    filter_parts = []
    inputs = []
    for i, src in enumerate(harmonic_sources):
        inputs.extend(['-i', src])
        filter_parts.append(f"[{i}:a]")

    filter_str = ''.join(filter_parts) + f"amix=inputs={len(harmonic_sources)}:duration=longest[out]"

    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_str,
        "-map", "[out]",
        str(mixed_path),
    ]
    subprocess.run(cmd, capture_output=True, timeout=120)

    if mixed_path.exists():
        log(f"  Mix armónico: {', '.join(k for k in stems if k in ['piano','guitar','other','bass'])}")
        return mixed_path
    return None


def extract_all_notes(source_path, bpm, duration):
    """
    Extrae TODAS las notas del audio armónico usando detección multi-pitch.
    
    Algoritmo:
    1. CQT sobre el audio armónico (HPSS)
    2. Onset detection para segmentar cambios armónicos
    3. Para cada segmento: promediar espectro en TODOS los frames
    4. Encontrar TODOS los picos locales en el promedio → notas simultáneas
    5. Filtrar armónicos (octavas) para quedarse con las notas reales
    6. Agrupar: 1 nota = individual, 2+ notas = acorde
    """
    if not source_path or not source_path.exists():
        log("  Sin fuente de audio, omitiendo")
        return [], []

    log(f"Analizando {source_path.name} para notas + acordes...")

    y, sr = librosa.load(str(source_path), sr=SR)

    # HPSS: solo componente armónica
    y_harmonic, _ = librosa.effects.hpss(y)

    # Onsets para segmentar cambios armónicos
    onset_frames = librosa.onset.onset_detect(
        y=y_harmonic, sr=sr,
        hop_length=HOP_LENGTH,
        backtrack=True,
        units='frames',
    )

    if len(onset_frames) < 5:
        beats = librosa.beat.beat_frames(y=y_harmonic, sr=sr, hop_length=HOP_LENGTH)
        if len(beats) > 2:
            onset_frames = beats
        else:
            hop_sec = HOP_LENGTH / sr
            stride = max(1, int(0.15 / hop_sec))
            onset_frames = np.arange(0, len(y) // HOP_LENGTH, stride)

    log(f"  {len(onset_frames)} onsets detectados")

    # CQT con resolución completa
    log("  Computando CQT...")
    cqt = np.abs(librosa.cqt(y_harmonic, sr=sr, hop_length=HOP_LENGTH,
                              fmin=librosa.note_to_hz('C2'),
                              n_bins=72, bins_per_octave=12))
    # No pasar a dB - usar amplitud lineal para mejor preservación de armónicos
    # Normalizar cada columna
    cqt_norm = cqt / (np.max(cqt, axis=0, keepdims=True) + 1e-10)

    midi_bins = np.arange(36, 36 + cqt.shape[0])  # C2=36 a C7=96+
    times = librosa.frames_to_time(np.arange(cqt.shape[1]), sr=sr, hop_length=HOP_LENGTH)

    onset_frames = np.clip(onset_frames, 0, cqt.shape[1] - 1)
    onset_frames = np.unique(np.sort(onset_frames))

    # Threshold dinámico
    all_vals = cqt_norm.flatten()
    threshold = np.percentile(all_vals[all_vals > 0.01], 70)

    raw_segments = []  # (time, set_of_midi_notes)

    for i in range(len(onset_frames) - 1):
        f_start = int(onset_frames[i])
        f_end = min(int(onset_frames[i + 1]), cqt.shape[1] - 1)

        if f_end - f_start < 1:
            continue

        t = float(times[f_start])
        if t > duration:
            break

        # Promediar TODOS los frames del segmento
        segment = cqt_norm[:, f_start:f_end]
        avg_spectrum = np.mean(segment, axis=1)

        # Encontrar TODOS los picos locales
        peaks = []
        for b in range(2, len(avg_spectrum) - 2):
            if avg_spectrum[b] < threshold:
                continue
            # Es pico local?
            if (avg_spectrum[b] > avg_spectrum[b-1] and
                avg_spectrum[b] > avg_spectrum[b-2] and
                avg_spectrum[b] > avg_spectrum[b+1] and
                avg_spectrum[b] > avg_spectrum[b+2]):
                midi_note = int(round(midi_bins[b]))
                if MIDI_MIN <= midi_note <= MIDI_MAX:
                    peaks.append((midi_note, float(avg_spectrum[b])))

        if not peaks:
            # Tomar el máximo global
            max_b = int(np.argmax(avg_spectrum))
            if avg_spectrum[max_b] > threshold * 0.5:
                midi_note = int(round(midi_bins[max_b]))
                if MIDI_MIN <= midi_note <= MIDI_MAX:
                    peaks = [(midi_note, float(avg_spectrum[max_b]))]

        if not peaks:
            continue

        # Ordenar por fuerza descendente
        peaks.sort(key=lambda x: -x[1])

        # Filtrar armónicos: si una nota es octava de otra más fuerte, descartarla
        # (a menos que sea significativamente más fuerte que su fundamental)
        filtered = []
        for midi_note, strength in peaks:
            is_harmonic = False
            for existing_midi, existing_strength in filtered:
                diff = abs(midi_note - existing_midi)
                # Octava (12 semitonos) o quinta (7) arriba de una nota más fuerte
                if (diff == 12 or diff == 7 or diff == 19 or diff == 24) and strength < existing_strength * 0.6:
                    is_harmonic = True
                    break
            if not is_harmonic:
                filtered.append((midi_note, strength))

        # Tomar solo las notas más fuertes (max 6)
        filtered = filtered[:6]

        if len(filtered) == 1:
            raw_segments.append((t, {filtered[0][0]}))
        else:
            raw_segments.append((t, set(n for n, _ in filtered)))

    # Agrupar segmentos cercanos en el tiempo en acordes/notas
    # Si dos segmentos están a menos de CHORD_WINDOW, combinarlos
    consolidated = []
    for t, notes_set in raw_segments:
        if consolidated and (t - consolidated[-1][0]) < CHORD_WINDOW:
            # Combinar con el anterior
            prev_t, prev_notes = consolidated[-1]
            combined = prev_notes | notes_set
            consolidated[-1] = (prev_t, combined)
        else:
            consolidated.append((t, notes_set))

    # Generar output
    notes_output = []
    chords_output = []

    for t, notes_set in consolidated:
        sorted_notes = sorted(notes_set)
        if len(sorted_notes) == 1:
            notes_output.append({
                "time": round(t, 3),
                "note": sorted_notes[0],
                "duration": 0.15,
                "velocity": 100,
            })
        else:
            chords_output.append({
                "time": round(t, 3),
                "notes": sorted_notes,
                "duration": 0.3,
            })

    notes_output.sort(key=lambda n: n["time"])
    chords_output.sort(key=lambda c: c["time"])

    log(f"  {len(notes_output)} notas individuales, {len(chords_output)} acordes")
    return notes_output, chords_output


# ─── Paso 5: Post-procesar y mezclar ─────────────────────────────────────
def merge_midi_events(notes, chords, min_gap=0.04):
    """
    Asegura que no haya notas individuales en el mismo tiempo exacto que acordes.
    Si una nota individual coincide con un acorde, se integra al acorde.
    """
    if not chords:
        return notes, chords

    chord_times = {c["time"] for c in chords}
    filtered_notes = []

    for n in notes:
        # Si hay un acorde muy cerca, integrar
        nearby = False
        for ct in chord_times:
            if abs(n["time"] - ct) < min_gap:
                nearby = True
                # Agregar esta nota al acorde
                for c in chords:
                    if abs(c["time"] - ct) < min_gap and n["note"] not in c["notes"]:
                        c["notes"] = sorted(c["notes"] + [n["note"]])
                        break
                break
        if not nearby:
            filtered_notes.append(n)

    return filtered_notes, chords


# ─── Paso 6: Generar chart ──────────────────────────────────────────────
def generate_chart(title, artist, bpm, duration, chords, notes, song_dir):
    audio_file = f"songs/{song_dir.name}/audio.mp3"
    chart = {
        "title": title,
        "artist": artist,
        "bpm": round(bpm, 1),
        "duration": round(duration, 1),
        "audioFile": audio_file,
        "notes": notes,
        "chords": chords,
    }
    chart_path = song_dir / "chart.json"
    with open(chart_path, "w", encoding="utf-8") as f:
        json.dump(chart, f, ensure_ascii=False, indent=2)
    log(f"Chart: {chart_path}")


# ─── Pipeline principal ──────────────────────────────────────────────────
def run_pipeline(url, custom_name=None):
    print("\n  🎸 Pipeline Acordazos v2 (notas + acordes desde mix armónico)")
    print("  ==========================================================\n")

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Descargar de YouTube
    result = download_audio(url, TEMP_DIR)
    audio_path, title, artist, duration = result

    safe = "".join(c for c in title if c.isalnum() or c in " _-").strip()[:40]
    song_name = custom_name or safe
    song_dir = SONGS_DIR / song_name
    song_dir.mkdir(parents=True, exist_ok=True)

    # 2. Separar stems con Demucs
    stems = separate_stems(audio_path, TEMP_DIR)

    # 3. BPM
    bpm = detect_bpm(audio_path)

    # 4. Crear mix armónico (sin voces ni batería)
    harmonic_mix = mix_harmonic_stems(stems, TEMP_DIR)

    # 5. Extraer todas las notas del mix armónico
    if harmonic_mix:
        notes, chords = extract_all_notes(harmonic_mix, bpm, duration)
    else:
        # Fallback: analizar el audio completo
        log("Sin stems armónicos, usando audio completo...")
        notes, chords = extract_all_notes(audio_path, bpm, duration)

    # 6. Post-procesar: integrar notas duplicadas
    notes, chords = merge_midi_events(notes, chords)

    # Si hay muy pocas notas, intentar con el audio completo como fallback
    if len(notes) + len(chords) < 20:
        log("Muy pocas detecciones, reintentando con audio completo...")
        notes2, chords2 = extract_all_notes(audio_path, bpm, duration)
        if len(notes2) + len(chords2) > len(notes) + len(chords):
            notes, chords = notes2, chords2

    # 7. Copiar audio y convertir a MP3
    wav_copy = song_dir / "audio.wav"
    shutil.copy2(str(audio_path), str(wav_copy))
    mp3_path = song_dir / "audio.mp3"

    subprocess.run([
        "ffmpeg", "-y", "-i", str(wav_copy),
        "-codec:a", "libmp3lame", "-qscale:a", "2",
        str(mp3_path),
    ], capture_output=True)
    wav_copy.unlink(missing_ok=True)

    # 8. Generar chart
    generate_chart(title, artist, bpm, duration, chords, notes, song_dir)

    # Cleanup
    shutil.rmtree(TEMP_DIR, ignore_errors=True)

    print(f"\n  ✅ Listo: songs/{song_name}/")
    print(f"     {len(chords)} acordes, {len(notes)} notas individuales")
    print(f"     Total eventos: {len(chords) + len(notes)}")
    print(f"     Chart: {song_dir / 'chart.json'}")
    print(f"     Audio: {mp3_path}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Acordazos — Preparar canción desde YouTube (v2)")
    parser.add_argument("url", help="URL de YouTube")
    parser.add_argument("--name", "-n", help="Nombre personalizado", default=None)
    args = parser.parse_args()
    run_pipeline(args.url, args.name)
