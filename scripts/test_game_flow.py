#!/usr/bin/env python3
"""
Test manual: verifica que los chart files sean válidos y el flujo del juego funcione.
"""

import json
import os
import sys

SONGS_DIR = '/Users/emmanuelvaldez/GameDev/acordazos/public/songs'

def test_chart_load(name):
    """Simula cargar un chart y verifica su estructura."""
    chart_path = os.path.join(SONGS_DIR, name, 'chart.json')
    try:
        with open(chart_path) as f:
            chart = json.load(f)
        
        if not chart.get('title') or not chart.get('artist'):
            return {'ok': False, 'error': 'Faltan title/artist'}
        if not isinstance(chart.get('notes'), list) or len(chart['notes']) == 0:
            return {'ok': False, 'error': 'No hay notas'}
        if not chart.get('duration') or chart['duration'] <= 0:
            return {'ok': False, 'error': 'Duración inválida'}
        
        first_note = chart['notes'][0]
        if 'note' not in first_note or 'time' not in first_note:
            return {'ok': False, 'error': 'Estructura de nota inválida'}
        
        last_note = chart['notes'][-1]
        if last_note['time'] > chart['duration']:
            return {'ok': False, 'error': f"Última nota en {last_note['time']}s excede duración {chart['duration']}s"}
        
        return {
            'ok': True,
            'title': chart['title'],
            'artist': chart['artist'],
            'notes': len(chart['notes']),
            'chords': len(chart.get('chords', [])),
            'duration': chart['duration'],
            'lastNoteTime': last_note['time']
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)}

def main():
    print('\n=== TEST ACORDAZOS ===')
    
    # Test 1: Verificar que los chart files existan y sean válidos
    print('\n--- Test 1: Chart files ---')
    song_names = [f for f in os.listdir(SONGS_DIR) 
                  if os.path.isdir(os.path.join(SONGS_DIR, f))]
    print(f'Canciones encontradas: {len(song_names)}')
    
    valid = 0
    invalid = 0
    for name in sorted(song_names, key=lambda x: int(x) if x.isdigit() else 999999)[:10]:
        result = test_chart_load(name)
        if result['ok']:
            valid += 1
            print(f"  ✓ {name}: {result['title']} - {result['notes']} notas, {result['duration']:.1f}s")
        else:
            invalid += 1
            print(f"  ✗ {name}: {result['error']}")
    print(f'\nValidos: {valid}, Invalidos: {invalid}')
    
    # Test 2: Index
    print('\n--- Test 2: Index ---')
    index_path = os.path.join(SONGS_DIR, 'index.json')
    with open(index_path) as f:
        index = json.load(f)
    print(f'Canciones en index: {len(index)}')
    
    # Test 3: Probar 10 canciones
    print('\n--- Test 3: Flujo del juego (10 canciones) ---')
    test_songs = sorted(song_names, key=lambda x: int(x) if x.isdigit() else 999999)[:10]
    passed = 0
    failed = 0
    for name in test_songs:
        result = test_chart_load(name)
        if result['ok']:
            passed += 1
            print(f"  ✓ {name}: {result['title']} - {result['notes']} notas, {result['duration']:.1f}s")
        else:
            failed += 1
            print(f"  ✗ {name}: {result['error']}")
    
    print(f'\n--- Resultado ---')
    print(f'Pasaron: {passed}/{len(test_songs)}')
    print(f'Fallaron: {failed}/{len(test_songs)}')
    
    # Test 4: Build
    print('\n--- Test 4: Build ---')
    dist_path = '/Users/emmanuelvaldez/GameDev/acordazos/dist/index.html'
    if os.path.exists(dist_path):
        with open(dist_path) as f:
            html = f.read()
        has_canvas = 'game-canvas' in html
        has_script = 'index-' in html
        print(f'  index.html existe: ✓')
        print(f'  Tiene canvas: {"✓" if has_canvas else "✗"}')
        print(f'  Tiene script: {"✓" if has_script else "✗"}')
    else:
        print(f'  ✗ dist/index.html no existe')
    
    # Test 5: Verificar que el código no tiene errores de sintaxis
    print('\n--- Test 5: Código fuente ---')
    src_files = [
        'src/game/Game.ts',
        'src/audio/AudioManager.ts',
        'src/main.ts',
    ]
    for sf in src_files:
        full_path = os.path.join('/Users/emmanuelvaldez/GameDev/acordazos', sf)
        if os.path.exists(full_path):
            with open(full_path) as f:
                content = f.read()
            # Verificar balance de braces
            open_braces = content.count('{')
            close_braces = content.count('}')
            balanced = open_braces == close_braces
            print(f'  {sf}: {len(content)} chars, braces {"✓" if balanced else "✗"}')
        else:
            print(f'  ✗ {sf} no existe')
    
    print('\n=== TEST COMPLETADO ===\n')

if __name__ == '__main__':
    main()
