#!/usr/bin/env python3
"""
Procesa el PDF de partituras con Audiveris y genera charts JSON para el juego.
Uso: python3 scripts/process_pdf.py <pdf_path> [--pages 1-20] [--bpm 120]
"""
import sys
import os
import re
import json
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# Nota: Audiveris está en /Applications/Audiveris.app/Contents/MacOS/Audiveris
AUDIVERIS = "/Applications/Audiveris.app/Contents/MacOS/Audiveris"

# Mapeo nota -> semitonos desde C
NOTE_OFFSETS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

# Mapeo acordes -> notas MIDI (root + intervals)
CHORD_INTERVALS = {
    '': [0, 4, 7],        # Major
    'm': [0, 3, 7],       # Minor
    '7': [0, 4, 7, 10],   # Dominant 7th
    'm7': [0, 3, 7, 10],  # Minor 7th
    'maj7': [0, 4, 7, 11], # Major 7th
    'dim': [0, 3, 6],     # Diminished
    'aug': [0, 4, 8],     # Augmented
    'sus4': [0, 5, 7],    # Sus4
    'sus2': [0, 2, 7],    # Sus2
    '6': [0, 4, 7, 9],    # 6th
    'm6': [0, 3, 7, 9],   # Minor 6th
    '9': [0, 4, 7, 10, 14], # 9th
    'm9': [0, 3, 7, 10, 14],
    '7M': [0, 4, 7, 11],  # 7th major (notación latina)
    'm7M': [0, 3, 7, 11],
}

def note_to_midi(step, octave, alter=0):
    """Convierte nota musical a número MIDI"""
    base = NOTE_OFFSETS.get(step, 0)
    return (octave + 1) * 12 + base + alter

def chord_name_to_notes(chord_name, octave=4):
    """Convierte nombre de acorde (ej: Gm, F7, C#) a notas MIDI"""
    # Parsear: root [b/#] [quality] [/bass]
    match = re.match(r'^([A-G])([#b]?)(.*)$', chord_name.strip())
    if not match:
        return []
    
    root, accidental, quality = match.groups()
    root_val = NOTE_OFFSETS.get(root, 0)
    if accidental == '#':
        root_val += 1
    elif accidental == 'b':
        root_val -= 1
    
    # Limpiar quality
    quality = quality.strip()
    # Remover /bass
    quality = quality.split('/')[0].strip()
    
    # Buscar el intervalo
    intervals = CHORD_INTERVALS.get(quality, CHORD_INTERVALS[''])
    
    # Generar notas
    base_midi = (octave + 1) * 12 + root_val
    return [base_midi + i for i in intervals]

def decode_pdf_text(text):
    """Decodifica el texto del PDF (fuente con mapeo U+F0xx)"""
    result = []
    for c in text:
        cp = ord(c)
        if 0xF000 <= cp <= 0xF0FF:
            result.append(chr(cp - 0xF000))
        elif cp < 32 and c not in '\n\r\t':
            continue
        else:
            result.append(c)
    return ''.join(result)

def extract_song_info(doc, page_idx):
    """Extrae título, artista, género de una página del PDF"""
    text = doc[page_idx].get_text()
    decoded = decode_pdf_text(text)
    lines = [l.strip() for l in decoded.split('\n') if l.strip()]
    
    for j, line in enumerate(lines):
        if line == 'Cumbieishon' and j >= 1 and j < len(lines) - 1:
            # El patrón es: Título, Artista, Cumbieishon, Género
            title = lines[j-2].strip() if j >= 2 else 'Desconocido'
            artist = lines[j-1].strip()
            genre = lines[j+1].strip() if j+1 < len(lines) else ''
            
            # Buscar instrumento
            instr = ''
            for l in lines[j+1:j+4]:
                if l.startswith('(') and l.endswith(')'):
                    instr = l
                    break
            
            # Número del tema
            num_match = re.search(r'(\d+)\s*$', decoded)
            num = num_match.group(1) if num_match else ''
            
            if genre.isdigit():
                genre = ''
            
            return {
                'title': title,
                'artist': artist,
                'genre': genre,
                'instrument': instr,
                'num': num
            }
    return None

def extract_chords_from_page(doc, page_idx):
    """Extrae acordes del texto de una página"""
    text = doc[page_idx].get_text()
    decoded = decode_pdf_text(text)
    
    # Buscar nombres de acordes: patrón A-G + [#b] + [m,7,maj7,dim,etc]
    # También filtrar palabras que no son acordes
    chord_pattern = re.compile(r'\b([A-G][#b]?(?:m7|maj7|m|M|7|dim|aug|sus4|sus2|6|m6|9|m9|7M|m7M)?)\b')
    
    chords = []
    lines = decoded.split('\n')
    for line in lines:
        # Filtrar líneas que son claramente texto (Intro, Estrofa, etc.)
        stripped = line.strip()
        if not stripped or len(stripped) > 30:
            continue
        if any(w in stripped for w in ['Intro', 'Estrofa', 'Estrib', 'Instr', 'Cumbieishon', 'CUMBIA', 'CUARTETO', 'HUAYNO', 'ROCK', 'pachanga']):
            continue
        
        matches = chord_pattern.findall(stripped)
        for m in matches:
            # Validar que es un acorde real (no una letra suelta)
            if len(m) >= 1 and m[0] in 'ABCDEFG':
                # Filtrar falsos positivos comunes
                if m in ['A', 'E'] and len(m) == 1:
                    # Podría ser acorde o letra, lo incluimos
                    pass
                chords.append(m)
    
    return chords

def render_page_to_png(doc, page_idx, output_path, dpi=300):
    """Renderiza una página del PDF como PNG"""
    import pymupdf
    page = doc[page_idx]
    pix = page.get_pixmap(dpi=dpi)
    pix.save(output_path)
    return pix.width, pix.height

def run_audiveris(image_path, output_dir):
    """Ejecuta Audiveris en modo batch sobre una imagen"""
    os.makedirs(output_dir, exist_ok=True)
    cmd = [
        AUDIVERIS,
        '-batch', '-transcribe', '-export',
        '-output', output_dir,
        image_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    
    # Buscar el archivo .mxl generado
    base_name = Path(image_path).stem
    mxl_path = os.path.join(output_dir, f"{base_name}.mxl")
    
    if not os.path.exists(mxl_path):
        # Buscar cualquier .mxl
        mxl_files = list(Path(output_dir).glob("*.mxl"))
        if mxl_files:
            mxl_path = str(mxl_files[0])
        else:
            return None
    
    return mxl_path

def parse_musicxml(mxl_path):
    """Parsea MusicXML (.mxl) y extrae notas con timing"""
    if not mxl_path or not os.path.exists(mxl_path):
        return {'notes': [], 'divisions': 4, 'bpm': 120, 'duration': 0}
    
    try:
        # Descomprimir .mxl (es un ZIP)
        with tempfile.TemporaryDirectory() as tmpdir:
            with zipfile.ZipFile(mxl_path, 'r') as z:
                z.extractall(tmpdir)
            
            # Encontrar el .xml
            xml_files = list(Path(tmpdir).glob("*.xml"))
            if not xml_files:
                return {'notes': [], 'divisions': 4, 'bpm': 120, 'duration': 0}
            
            xml_path = str(xml_files[0])
            
            # Parsear DENTRO del contexto del tmpdir (antes de que se borre)
            tree = ET.parse(xml_path)
        
        root = tree.getroot()
    except Exception as e:
        print(f"    Error parseando XML: {e}")
        return {'notes': [], 'divisions': 4, 'bpm': 120, 'duration': 0}
    
    # Extraer divisions (divisions per quarter note)
    divisions = 4
    divisions_elem = root.find('.//divisions')
    if divisions_elem is not None:
        divisions = int(divisions_elem.text)
    
    # BPM default
    bpm = 120
    # Audiveris a veces no detecta tempo, usamos 120 como default para cumbia
    
    notes = []
    current_time = 0.0  # en segundos
    seconds_per_division = (60.0 / bpm) / divisions
    
    # Iterar sobre measures y notes
    for measure in root.findall('.//measure'):
        measure_time = 0.0  # tiempo acumulado dentro del compás
        
        for elem in measure:
            if elem.tag == 'note':
                # ¿Es un chord (nota simultánea)?
                is_chord = elem.find('chord') is not None
                
                # ¿Es un rest?
                rest = elem.find('rest')
                
                # Pitch
                pitch = elem.find('pitch')
                duration_elem = elem.find('duration')
                type_elem = elem.find('type')
                
                dur_val = int(duration_elem.text) if duration_elem is not None else divisions
                
                if rest is not None:
                    # Es un silencio, avanzar tiempo
                    if not is_chord:
                        measure_time += dur_val * seconds_per_division
                    continue
                
                if pitch is not None:
                    step_elem = pitch.find('step')
                    octave_elem = pitch.find('octave')
                    alter_elem = pitch.find('alter')
                    
                    step = step_elem.text if step_elem is not None else 'C'
                    octave = int(octave_elem.text) if octave_elem is not None else 4
                    alter = int(alter_elem.text) if alter_elem is not None else 0
                    
                    midi_note = note_to_midi(step, octave, alter)
                    note_duration = dur_val * seconds_per_division
                    
                    # Si es chord, no avanzar el tiempo (es simultánea)
                    note_time = current_time + measure_time
                    
                    notes.append({
                        'midi': midi_note,
                        'time': note_time,
                        'duration': note_duration,
                        'step': step,
                        'octave': octave,
                        'alter': alter,
                        'type': type_elem.text if type_elem is not None else 'quarter'
                    })
                    
                    if not is_chord:
                        measure_time += dur_val * seconds_per_division
            
            elif elem.tag == 'backup':
                dur_elem = elem.find('duration')
                if dur_elem is not None:
                    measure_time -= int(dur_elem.text) * seconds_per_division
            
            elif elem.tag == 'forward':
                dur_elem = elem.find('duration')
                if dur_elem is not None:
                    measure_time += int(dur_elem.text) * seconds_per_division
        
        current_time += measure_time
    
    # Calcular duración total
    total_duration = current_time
    
    return {
        'notes': notes,
        'divisions': divisions,
        'bpm': bpm,
        'duration': total_duration
    }

def build_chart(song_info, mxl_data, chords_text, all_pages_mxl=None):
    """Construye el ChartData JSON para el juego"""
    
    # Combinar notas de todas las páginas si hay múltiples
    all_notes = []
    if all_pages_mxl:
        time_offset = 0.0
        for page_data in all_pages_mxl:
            for note in page_data['notes']:
                all_notes.append({
                    'time': note['time'] + time_offset,
                    'note': note['midi'],
                    'duration': note['duration'],
                    'velocity': 100
                })
            time_offset += page_data['duration'] + 0.5  # pequeño gap entre páginas
        total_duration = time_offset
    else:
        all_notes = [{
            'time': n['time'],
            'note': n['midi'],
            'duration': n['duration'],
            'velocity': 100
        } for n in mxl_data['notes']]
        total_duration = mxl_data['duration']
    
    # Convertir acordes de texto a eventos
    chord_events = []
    if chords_text:
        # Distribuir acordes a lo largo de la canción
        chord_interval = total_duration / max(len(chords_text), 1)
        for i, chord_name in enumerate(chords_text):
            notes = chord_name_to_notes(chord_name, octave=4)
            if notes:
                chord_events.append({
                    'time': i * chord_interval,
                    'notes': notes,
                    'duration': chord_interval
                })
    
    # Asegurar duración mínima
    if total_duration < 5:
        total_duration = 10
    
    return {
        'title': song_info['title'] if song_info else 'Unknown',
        'artist': song_info['artist'] if song_info else 'Unknown',
        'bpm': mxl_data['bpm'],
        'duration': total_duration,
        'audioFile': '',  # Sin audio (es de partitura)
        'notes': all_notes,
        'chords': chord_events
    }

def detect_pentagram_pages(doc, start_idx, end_idx):
    """Detecta qué páginas tienen pentagramas usando OpenCV"""
    import cv2
    import numpy as np
    
    pentagram_pages = []
    for i in range(start_idx, min(end_idx, len(doc))):
        page = doc[i]
        pix = page.get_pixmap(dpi=100)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        
        _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)
        kernel_len = pix.width // 3
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_len, 1))
        horizontal_lines = cv2.erode(binary, horizontal_kernel, iterations=1)
        horizontal_lines = cv2.dilate(horizontal_lines, horizontal_kernel, iterations=1)
        
        contours, _ = cv2.findContours(horizontal_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        long_lines = [c for c in contours if cv2.boundingRect(c)[2] > pix.width * 0.3]
        
        if len(long_lines) >= 5:
            pentagram_pages.append(i)
    
    return pentagram_pages

def get_song_pages(doc, song_idx, all_songs):
    """Determina qué páginas con pentagrama pertenecen a una canción.
    Solo procesa la página donde está el título (que tiene el pentagrama)."""
    if song_idx >= len(all_songs):
        return []
    
    title_page = all_songs[song_idx]['page'] - 1  # 0-indexed
    
    # La página del título puede tener el pentagrama, o la siguiente
    # Verificar la página del título y la siguiente
    pages_to_check = [title_page]
    if title_page + 1 < len(doc):
        pages_to_check.append(title_page + 1)
    
    # Filtrar solo las que tienen pentagrama
    pentagram_pages = detect_pentagram_pages(doc, title_page, min(title_page + 2, len(doc)))
    
    return pentagram_pages if pentagram_pages else [title_page]

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/process_pdf.py <pdf_path> [--pages 1-20] [--bpm 120] [--output-dir public/songs]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = 'public/songs'
    bpm_override = None
    pages_filter = None
    
    # Parsear argumentos
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--output-dir' and i + 1 < len(sys.argv):
            output_dir = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--bpm' and i + 1 < len(sys.argv):
            bpm_override = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--pages' and i + 1 < len(sys.argv):
            pages_filter = sys.argv[i + 1]
            i += 2
        else:
            i += 1
    
    import pymupdf
    doc = pymupdf.open(pdf_path)
    print(f"PDF: {pdf_path} ({len(doc)} páginas)")
    
    # Extraer índice de canciones
    all_songs = []
    seen = set()
    for i in range(len(doc)):
        info = extract_song_info(doc, i)
        if info and info['title'] and len(info['title']) > 1:
            key = info['title'] + '_' + info['num']
            if key not in seen:
                info['page'] = i + 1
                all_songs.append(info)
                seen.add(key)
    
    print(f"Canciones encontradas: {len(all_songs)}")
    
    # Filtrar páginas si se especificó
    if pages_filter:
        # Parsear "1-20" o "14,15,16"
        if '-' in pages_filter:
            parts = pages_filter.split('-')
            page_range = range(int(parts[0]) - 1, int(parts[1]))
            all_songs = [s for s in all_songs if s['page'] - 1 in page_range]
        else:
            page_nums = [int(p) - 1 for p in pages_filter.split(',')]
            all_songs = [s for s in all_songs if s['page'] - 1 in page_nums]
    
    print(f"Canciones a procesar: {len(all_songs)}")
    
    # Procesar cada canción
    for song_idx, song in enumerate(all_songs):
        title = song['title']
        # Sanitizar nombre para directorio
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', title.lower())[:50]
        song_dir = os.path.join(output_dir, safe_name)
        chart_path = os.path.join(song_dir, 'chart.json')
        
        # Si ya existe, saltar
        if os.path.exists(chart_path):
            print(f"[{song_idx+1}/{len(all_songs)}] {title} - YA EXISTE, saltando")
            continue
        
        print(f"[{song_idx+1}/{len(all_songs)}] {title} - {song['artist']} (pág {song['page']})")
        
        # Determinar páginas de esta canción
        song_pages = get_song_pages(doc, song_idx, all_songs)
        if not song_pages:
            print(f"  No se encontraron páginas con contenido")
            continue
        
        print(f"  Páginas: {[p+1 for p in song_pages]}")
        
        # Procesar cada página con Audiveris
        all_pages_data = []
        all_chords = []
        
        for page_idx in song_pages:
            # Renderizar página
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp_png = tmp.name
            
            try:
                render_page_to_png(doc, page_idx, tmp_png, dpi=300)
                
                # Extraer acordes del texto
                chords = extract_chords_from_page(doc, page_idx)
                all_chords.extend(chords)
                
                # Ejecutar Audiveris
                audiveris_out = os.path.join(tempfile.gettempdir(), f'audiveris_{page_idx}')
                mxl_path = run_audiveris(tmp_png, audiveris_out)
                
                if mxl_path:
                    # Parsear MusicXML
                    page_data = parse_musicxml(mxl_path)
                    all_pages_data.append(page_data)
                    print(f"  Pág {page_idx+1}: {len(page_data['notes'])} notas, {len(chords)} acordes")
                else:
                    print(f"  Pág {page_idx+1}: Audiveris no detectó pentagrama")
                    # Usar solo los acordes del texto
            except Exception as e:
                print(f"  Pág {page_idx+1}: ERROR - {e}")
            finally:
                if os.path.exists(tmp_png):
                    os.unlink(tmp_png)
        
        # Construir chart
        if all_pages_data:
            mxl_data = all_pages_data[0]
            if bpm_override:
                mxl_data['bpm'] = bpm_override
                # Recalcular timing con el nuevo BPM
                for pd in all_pages_data:
                    old_bpm = pd['bpm']
                    ratio = old_bpm / bpm_override if bpm_override else 1
                    pd['bpm'] = bpm_override
            
            chart = build_chart(song, mxl_data, all_chords, all_pages_data)
            
            # Guardar
            os.makedirs(song_dir, exist_ok=True)
            with open(chart_path, 'w', encoding='utf-8') as f:
                json.dump(chart, f, indent=2, ensure_ascii=False)
            
            print(f"  ✅ Chart guardado: {chart_path} ({len(chart['notes'])} notas, {len(chart['chords'])} acordes)")
        else:
            # Si no hay notas del pentagrama, crear chart con solo acordes
            if all_chords:
                chart = build_chart(song, {'notes': [], 'divisions': 4, 'bpm': bpm_override or 120, 'duration': 30}, all_chords)
                os.makedirs(song_dir, exist_ok=True)
                with open(chart_path, 'w', encoding='utf-8') as f:
                    json.dump(chart, f, indent=2, ensure_ascii=False)
                print(f"  ✅ Chart (solo acordes): {chart_path} ({len(chart['chords'])} acordes)")
            else:
                print(f"  ❌ No se pudo extraer nada")
    
    # Generar índice
    index_path = os.path.join(output_dir, 'index.json')
    song_dirs = []
    for song in all_songs:
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', song['title'].lower())[:50]
        song_dirs.append(safe_name)
    
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump({'songs': song_dirs}, f, indent=2)
    
    print(f"\nÍndice guardado: {index_path}")
    print(f"Total canciones procesadas: {len(all_songs)}")

if __name__ == '__main__':
    main()
