#!/usr/bin/env python3
"""
Procesa todas las páginas pares del PDF con Audiveris.
Extrae notas de pentagramas y acordes del texto.
Genera un chart.json por canción en public/songs/.
"""
import sys, os, re, json, subprocess, tempfile, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

PDF_PATH = "/Users/emmanuelvaldez/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/A46A6BDD-B7EA-474A-BCC7-BB77374C5A46/cumbieishon.pdf"
AUDIVERIS = "/Applications/Audiveris.app/Contents/MacOS/Audiveris"
OUTPUT_DIR = "/Users/emmanuelvaldez/GameDev/acordazos/public/songs"

NOTE_OFFSETS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

CHORD_INTERVALS = {
    '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10],
    'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11], 'dim': [0, 3, 6],
    'aug': [0, 4, 8], 'sus4': [0, 5, 7], 'sus2': [0, 2, 7],
    '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '9': [0, 4, 7, 10, 14],
    'm9': [0, 3, 7, 10, 14], '7M': [0, 4, 7, 11], 'm7M': [0, 3, 7, 11],
}

def note_to_midi(step, octave, alter=0):
    return (octave + 1) * 12 + NOTE_OFFSETS.get(step, 0) + alter

def chord_name_to_notes(chord_name, octave=4):
    match = re.match(r'^([A-G])([#b]?)(.*)$', chord_name.strip())
    if not match:
        return []
    root, accidental, quality = match.groups()
    root_val = NOTE_OFFSETS.get(root, 0)
    if accidental == '#': root_val += 1
    elif accidental == 'b': root_val -= 1
    quality = quality.strip().split('/')[0].strip()
    intervals = CHORD_INTERVALS.get(quality, CHORD_INTERVALS[''])
    base_midi = (octave + 1) * 12 + root_val
    return [base_midi + i for i in intervals]

def decode_pdf_text(text):
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
    text = doc[page_idx].get_text()
    decoded = decode_pdf_text(text)
    lines = [l.strip() for l in decoded.split('\n') if l.strip()]
    for j, line in enumerate(lines):
        if line == 'Cumbieishon' and j >= 2 and j < len(lines) - 1:
            title = lines[j-2].strip()
            artist = lines[j-1].strip()
            genre = lines[j+1].strip() if j+1 < len(lines) else ''
            if genre.isdigit():
                genre = ''
            num_match = re.search(r'(\d+)\s*$', decoded)
            num = num_match.group(1) if num_match else ''
            return {'title': title, 'artist': artist, 'genre': genre, 'num': num}
    return None

def extract_chords(doc, page_idx):
    text = doc[page_idx].get_text()
    decoded = decode_pdf_text(text)
    chord_pattern = re.compile(r'\b([A-G][#b]?(?:m7|maj7|m|M|7|dim|aug|sus4|sus2|6|m6|9|m9|7M|m7M)?)\b')
    chords = []
    for line in decoded.split('\n'):
        stripped = line.strip()
        if not stripped or len(stripped) > 30:
            continue
        if any(w in stripped for w in ['Intro', 'Estrofa', 'Estrib', 'Instr', 'Cumbieishon', 'CUMBIA', 'CUARTETO', 'HUAYNO', 'ROCK', 'pachanga', 'VILLERA', 'SANTAFE', 'AMAZONICA', 'COLOMBIANA', 'MEXICANA', 'PASO']):
            continue
        for m in chord_pattern.findall(stripped):
            if m and m[0] in 'ABCDEFG':
                chords.append(m)
    return chords

def render_page(doc, page_idx, dpi=300):
    import pymupdf
    page = doc[page_idx]
    pix = page.get_pixmap(dpi=dpi)
    return pix

def run_audiveris(png_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    cmd = [AUDIVERIS, '-batch', '-transcribe', '-export', '-output', output_dir, png_path]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    base = Path(png_path).stem
    mxl = os.path.join(output_dir, f"{base}.mxl")
    if not os.path.exists(mxl):
        mxls = list(Path(output_dir).glob("*.mxl"))
        if mxls:
            mxl = str(mxls[0])
        else:
            return None
    return mxl

def parse_mxl(mxl_path):
    if not mxl_path or not os.path.exists(mxl_path):
        return {'notes': [], 'duration': 0}
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            with zipfile.ZipFile(mxl_path, 'r') as z:
                z.extractall(tmpdir)
            xml_files = list(Path(tmpdir).glob("*.xml"))
            if not xml_files:
                return {'notes': [], 'duration': 0}
            tree = ET.parse(str(xml_files[0]))
        root = tree.getroot()
    except Exception as e:
        print(f"    Error XML: {e}")
        return {'notes': [], 'duration': 0}

    divisions = 4
    d = root.find('.//divisions')
    if d is not None:
        divisions = int(d.text)

    bpm = 120
    spd = (60.0 / bpm) / divisions
    notes = []
    current_time = 0.0

    for measure in root.findall('.//measure'):
        mt = 0.0
        for elem in measure:
            if elem.tag == 'note':
                is_chord = elem.find('chord') is not None
                rest = elem.find('rest')
                pitch = elem.find('pitch')
                dur_elem = elem.find('duration')
                dur_val = int(dur_elem.text) if dur_elem is not None else divisions
                if rest is not None:
                    if not is_chord:
                        mt += dur_val * spd
                    continue
                if pitch is not None:
                    step_e = pitch.find('step')
                    oct_e = pitch.find('octave')
                    alt_e = pitch.find('alter')
                    step = step_e.text if step_e is not None else 'C'
                    octave = int(oct_e.text) if oct_e is not None else 4
                    alter = int(alt_e.text) if alt_e is not None else 0
                    midi = note_to_midi(step, octave, alter)
                    notes.append({
                        'midi': midi,
                        'time': current_time + mt,
                        'duration': dur_val * spd,
                    })
                    if not is_chord:
                        mt += dur_val * spd
            elif elem.tag == 'backup':
                de = elem.find('duration')
                if de is not None:
                    mt -= int(de.text) * spd
            elif elem.tag == 'forward':
                de = elem.find('duration')
                if de is not None:
                    mt += int(de.text) * spd
        current_time += mt

    return {'notes': notes, 'duration': current_time}

def main():
    import pymupdf
    doc = pymupdf.open(PDF_PATH)
    
    # Páginas pares desde la 10 (0-indexed: impares desde 9)
    even_pages = [i for i in range(9, len(doc)) if (i + 1) % 2 == 0]
    print(f"Procesando {len(even_pages)} páginas pares (10-{even_pages[-1]+1})")
    
    results = []
    
    for idx, page_idx in enumerate(even_pages):
        page_num = page_idx + 1
        print(f"\n[{idx+1}/{len(even_pages)}] Página {page_num}...")
        
        # Info de la canción
        info = extract_song_info(doc, page_idx)
        if not info:
            print(f"  Sin info de canción, saltando")
            continue
        
        # Sanitizar nombre
        safe = re.sub(r'[^a-zA-Z0-9_-]', '_', info['title'].lower())[:50]
        chart_path = os.path.join(OUTPUT_DIR, safe, 'chart.json')
        
        if os.path.exists(chart_path):
            print(f"  {info['title']} - {info['artist']} -> YA EXISTE")
            results.append({'page': page_num, 'title': info['title'], 'status': 'exists'})
            continue
        
        print(f"  {info['title']} - {info['artist']}")
        
        # Acordes del texto
        chords_text = extract_chords(doc, page_idx)
        
        # Renderizar y correr Audiveris
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            tmp_png = tmp.name
        
        try:
            pix = render_page(doc, page_idx, dpi=300)
            pix.save(tmp_png)
            
            audiveris_out = os.path.join(tempfile.gettempdir(), f'aud_p{page_num}')
            # Limpiar output anterior
            import shutil
            if os.path.exists(audiveris_out):
                shutil.rmtree(audiveris_out)
            
            mxl_path = run_audiveris(tmp_png, audiveris_out)
            
            if mxl_path:
                mxl_data = parse_mxl(mxl_path)
                print(f"  Audiveris: {len(mxl_data['notes'])} notas, {len(chords_text)} acordes")
            else:
                mxl_data = {'notes': [], 'duration': 0}
                print(f"  Audiveris: no detectó pentagrama. {len(chords_text)} acordes del texto")
        except Exception as e:
            print(f"  ERROR: {e}")
            mxl_data = {'notes': [], 'duration': 0}
        finally:
            if os.path.exists(tmp_png):
                os.unlink(tmp_png)
        
        # Construir chart
        notes_out = [{
            'time': n['time'],
            'note': n['midi'],
            'duration': n['duration'],
            'velocity': 100
        } for n in mxl_data['notes']]
        
        total_dur = mxl_data['duration'] if mxl_data['duration'] > 5 else 30
        
        chord_events = []
        if chords_text:
            interval = total_dur / max(len(chords_text), 1)
            for i, cn in enumerate(chords_text):
                cn_notes = chord_name_to_notes(cn, octave=4)
                if cn_notes:
                    chord_events.append({
                        'time': i * interval,
                        'notes': cn_notes,
                        'duration': interval
                    })
        
        chart = {
            'title': info['title'],
            'artist': info['artist'],
            'bpm': 120,
            'duration': total_dur,
            'audioFile': '',
            'notes': notes_out,
            'chords': chord_events
        }
        
        os.makedirs(os.path.join(OUTPUT_DIR, safe), exist_ok=True)
        with open(chart_path, 'w', encoding='utf-8') as f:
            json.dump(chart, f, indent=2, ensure_ascii=False)
        
        status = 'ok' if notes_out else 'chords_only'
        print(f"  Guardado: {chart_path}")
        results.append({
            'page': page_num, 'title': info['title'], 'artist': info['artist'],
            'notes': len(notes_out), 'chords': len(chord_events), 'status': status
        })
    
    # Actualizar índice
    all_songs = sorted([d for d in os.listdir(OUTPUT_DIR) 
                        if os.path.isdir(os.path.join(OUTPUT_DIR, d)) and not d.startswith('.')])
    with open(os.path.join(OUTPUT_DIR, 'index.json'), 'w') as f:
        json.dump({'songs': all_songs}, f, indent=2)
    
    # Resumen
    print(f"\n{'='*60}")
    print(f"PROCESO COMPLETADO")
    print(f"{'='*60}")
    ok = sum(1 for r in results if r['status'] == 'ok')
    co = sum(1 for r in results if r['status'] == 'chords_only')
    ex = sum(1 for r in results if r['status'] == 'exists')
    print(f"Con notas+acordes: {ok}")
    print(f"Solo acordes: {co}")
    print(f"Ya existían: {ex}")
    print(f"Total: {len(results)}")
    print(f"Índice actualizado: {len(all_songs)} canciones")

if __name__ == '__main__':
    main()
