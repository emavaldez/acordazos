#!/usr/bin/env python3
"""
Acordazos — Pipeline de preparación de canciones.
Uso: python3 scripts/prepare_song.py <YouTube-URL> [--name NOMBRE]

Descarga un tema de YouTube, separa stems con Demucs, detecta BPM, 
extrae acordes y punteos, y genera un chart JSON + audio listo para jugar.
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

# Forzar usar el Python del sistema que tiene las librerías
# (Python 3.14 de brew no tiene los paquetes instalados)
_PYTHON = '/usr/bin/python3'

def ensure_python3():
    """Si estamos en un Python sin las librerías, re-ejecutar con el correcto."""
    try:
        import librosa
    except ImportError:
        # Ejecutar este mismo script con el Python del sistema
        os.execv(_PYTHON, [_PYTHON] + sys.argv)

ensure_python3()

# Asegurar que encuentra los paquetes del sistema Python
_PYTHON_SITE = os.path.expanduser("~/Library/Python/3.9/lib/python/site-packages")
if os.path.isdir(_PYTHON_SITE) and _PYTHON_SITE not in sys.path:
    sys.path.insert(0, _PYTHON_SITE)

import numpy as np
import librosa

# ─── Config ──────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
SONGS_DIR = REPO_ROOT / "public" / "songs"
TEMP_DIR = REPO_ROOT / "temp_audio"

MIDI_MIN = 36  # C2
MIDI_MAX = 96  # C7
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


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
    """Descarga el audio de YouTube como WAV usando yt-dlp CLI (más confiable)"""
    log("Descargando audio desde YouTube...")

    out_path = output_dir / "full.wav"
    cmd = [
        "yt-dlp",
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

    # Obtener metadatos del archivo
    # Re-ejecutar yt-dlp en modo simulado para obtener metadata
    meta_cmd = [
        "yt-dlp", "--no-warnings", "--extractor-args", "youtube:player_client=android",
        "--print", "title", "--print", "channel", "--print", "duration",
        url,
    ]
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
    log("Separando stems con Demucs...")

    stems_out = output_dir / "stems"
    stems_out.mkdir(parents=True, exist_ok=True)

    # Intentar primero con htdemucs_6s, fallback a htdemucs
    models_to_try = ['htdemucs_6s', 'htdemucs']
    result = None
    model = 'htdemucs'

    # Demucs está instalado en el mismo Python (sistema)
    demucs_python = _PYTHON

    for model in models_to_try:
        cmd = [
            demucs_python, "-m", "demucs",
            "-n", model,
            "-o", str(stems_out),
            str(audio_path),
        ]

        # Detectar MPS (Apple Silicon)
        try:
            import torch
            if torch.backends.mps.is_available():
                cmd.extend(['-d', 'mps'])
        except ImportError:
            pass

        log(f"  Modelo: {model}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode == 0:
            break
        log(f"  Modelo {model} falló, probando siguiente...")

    if result.returncode != 0:
        print("ERROR Demucs:", result.stderr[:500])
        raise RuntimeError("Demucs falló")

    # Encontrar carpeta de salida de Demucs
    stem_name = audio_path.stem
    demucs_out = stems_out / model / stem_name
    if not demucs_out.exists():
        # Buscar cualquier subdirectorio
        candidates = list(stems_out.rglob(stem_name))
        if candidates:
            demucs_out = candidates[0]
        else:
            raise FileNotFoundError(f"No se encontró salida de Demucs en {stems_out}")

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


# ─── Paso 4: Acordes desde el bajo ───────────────────────────────────────
def extract_chords(bass_path, bpm, duration):
    """Extrae acordes desde el stem de bajo usando chromagram."""
    log("Extrayendo acordes del bajo...")
    y, sr = librosa.load(str(bass_path), sr=22050)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, start_bpm=bpm)

    if len(beat_frames) < 4:
        # Fallback: grilla regular cada beat
        hop = int(sr * 60 / bpm / 512) if bpm > 0 else 128
        beat_frames = np.arange(0, chroma.shape[1], max(hop, 1))

    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    chords = []

    for i in range(len(beat_times) - 1):
        t = float(beat_times[i])
        if t > duration:
            break

        start_f = max(0, int(librosa.time_to_frames(t, sr=sr)))
        end_f = min(chroma.shape[1], int(librosa.time_to_frames(float(beat_times[i+1]), sr=sr)))

        if start_f >= end_f:
            continue

        beat_chroma = chroma[:, start_f:end_f].mean(axis=1)
        if np.isnan(beat_chroma).any() or beat_chroma.max() < 0.1:
            continue

        threshold = beat_chroma.max() * 0.5
        strong_bins = np.where(beat_chroma > threshold)[0]
        if len(strong_bins) < 2:
            continue

        # Top 4 notas más fuertes
        top = np.argsort(beat_chroma)[::-1][:4]
        midi_notes = sorted(clamp_midi(48 + int(b)) for b in top)

        chords.append({
            "time": round(t, 3),
            "notes": midi_notes,
            "duration": round(float(beat_times[i+1] - t), 3),
        })

    if not chords:
        log("  No se detectaron acordes, usando placeholder")
        beat = 60.0 / bpm if bpm > 0 else 0.5
        for i in range(int(duration / beat / 4)):
            t = i * beat * 4
            if t > duration:
                break
            chords.append({"time": round(t, 3), "notes": [48, 52, 55], "duration": round(beat * 4, 3)})

    log(f"  {len(chords)} acordes")
    return chords


# ─── Paso 5: Notas desde guitarra/other ──────────────────────────────────
def extract_notes(source_path, bpm, duration):
    """Extrae notas individuales usando detección de pitch con CQT."""
    if not source_path or not source_path.exists():
        log("  Sin pista de guitarra, omitiendo notas")
        return []

    log(f"Extrayendo notas de {source_path.name}...")
    y, sr = librosa.load(str(source_path), sr=22050)

    cqt = np.abs(librosa.cqt(y, sr=sr, hop_length=512))
    pitches, magnitudes = librosa.piptrack(y=y, sr=sr, hop_length=512)

    times = librosa.frames_to_time(np.arange(pitches.shape[1]), sr=sr, hop_length=512)
    energy_threshold = np.percentile(magnitudes[magnitudes > 0], 40) if np.any(magnitudes > 0) else 0.05
    min_gap = 60.0 / bpm / 6 if bpm > 0 else 0.08

    notes = []
    last_time = -1.0

    for t_idx in range(pitches.shape[1]):
        t = float(times[t_idx])
        if t > duration:
            break

        frame_pitches = pitches[:, t_idx]
        frame_mags = magnitudes[:, t_idx]
        max_idx = np.argmax(frame_mags)
        max_mag = frame_mags[max_idx]

        if max_mag < energy_threshold:
            continue

        freq = float(frame_pitches[max_idx])
        if freq <= 0:
            continue

        midi = freq_to_midi(freq)
        if not (MIDI_MIN <= midi <= MIDI_MAX):
            continue

        if t - last_time < min_gap:
            continue

        notes.append({"time": round(t, 3), "note": midi, "duration": 0.15, "velocity": 100})
        last_time = t

    # Deduplicar muy cercanos
    filtered = []
    for n in notes:
        if filtered and abs(n["time"] - filtered[-1]["time"]) < 0.05:
            continue
        filtered.append(n)

    log(f"  {len(filtered)} notas")
    return filtered


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


# ─── Pipeline ────────────────────────────────────────────────────────────
def run_pipeline(url, custom_name=None):
    print("\n  🎸 Pipeline Acordazos")
    print("  ====================\n")

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Descargar
    result = download_audio(url, TEMP_DIR)
    audio_path, title, artist, duration = result

    safe = "".join(c for c in title if c.isalnum() or c in " _-").strip()[:40]
    song_name = custom_name or safe
    song_dir = SONGS_DIR / song_name
    song_dir.mkdir(parents=True, exist_ok=True)

    # 2. Separar stems
    stems = separate_stems(audio_path, TEMP_DIR)

    # 3. BPM
    bpm = detect_bpm(audio_path)

    # 4. Acordes del bajo
    chords = extract_chords(stems.get("bass"), bpm, duration) if "bass" in stems else []

    # 5. Notas de guitarra + piano
    guitar = stems.get("guitar") or stems.get("other")
    notes_guitar = extract_notes(guitar, bpm, duration)
    piano = stems.get("piano")
    notes_piano = extract_notes(piano, bpm, duration) if piano else []
    # Mezclar y deduplicar (ordenar por tiempo)
    notes = sorted(notes_guitar + notes_piano, key=lambda n: n["time"])
    # Si muy pocas, usar el mix completo como fallback
    if len(notes) < 30:
        log("Pocas notas detectadas, usando mix completo como fallback...")
        notes = extract_notes(audio_path, bpm, duration)

    # 6. Copiar audio
    wav_copy = song_dir / "audio.wav"
    shutil.copy2(str(audio_path), str(wav_copy))
    mp3_path = song_dir / "audio.mp3"

    subprocess.run([
        "ffmpeg", "-y", "-i", str(wav_copy),
        "-codec:a", "libmp3lame", "-qscale:a", "2",
        str(mp3_path),
    ], capture_output=True)
    wav_copy.unlink(missing_ok=True)

    # 7. Chart
    generate_chart(title, artist, bpm, duration, chords, notes, song_dir)

    # Cleanup
    shutil.rmtree(TEMP_DIR, ignore_errors=True)

    print(f"\n  ✅ Listo: songs/{song_name}/")
    print(f"     {len(chords)} acordes, {len(notes)} notas")
    print(f"     Chart: {song_dir / 'chart.json'}")
    print(f"     Audio: {mp3_path}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Acordazos — Preparar canción desde YouTube")
    parser.add_argument("url", help="URL de YouTube")
    parser.add_argument("--name", "-n", help="Nombre personalizado", default=None)
    args = parser.parse_args()
    run_pipeline(args.url, args.name)