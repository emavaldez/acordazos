# Acordazos - Architecture Document

**Engine:** Vite + TypeScript + Canvas 2D
**Platform:** Web (navegador con WebMIDI support)

---

## Engine Selection

**Vite + TypeScript puro + Canvas 2D.** No usa React ni framework de UI. El rendering es procedural en Canvas.

**Rationale:**
- Rhythm game necesita 60fps consistente. Canvas 2D es suficiente para notas que caen.
- WebMIDI API es nativo del navegador, no necesita libreria.
- Web Audio API para playback y sintesis, tambien nativo.
- Sin dependencias runtime = carga rapida, sin overhead.

---

## Project Structure

```
acordazos/
├── src/
│   ├── game/
│   │   ├── Game.ts            # Orquestador: fases, reloj, entrada, práctica, sostenidos
│   │   ├── Arrangement.ts     # Chart → notas jugables (modo, dificultad, rango, notas largas)
│   │   ├── KeyboardLayout.ts  # Geometría del teclado y rango ajustado al tema
│   │   ├── NoteRenderer.ts    # Canvas: pared LED, píldoras, marquesina, teclado, efectos
│   │   ├── HitDetection.ts    # Ventanas de acierto
│   │   ├── Score.ts           # Puntaje, multiplicador, sostenidos, tendencia de tiempo
│   │   ├── SongLoader.ts      # Índice de temas + charts (con caché)
│   │   └── Chart.ts           # Chart de prueba
│   ├── audio/AudioManager.ts  # Scheduler con lookahead, synth, clics de cuenta, MP3 opcional
│   ├── midi/MIDIManager.ts    # WebMIDI: todas las entradas, reconexión en caliente
│   ├── music/notes.ts         # Nombres de notas, teclas negras, rango del E333
│   ├── ui/
│   │   ├── UIManager.ts       # Menú, ajustes, HUD, pausa, resultados, avisos (HTML)
│   │   └── Settings.ts        # Ajustes y récords en localStorage
│   ├── theme.ts               # Paleta "Neón de bailanta" (espejo de las variables CSS)
│   ├── __tests__/             # vitest
│   ├── types.ts
│   ├── style.css
│   └── main.ts
├── scripts/
│   ├── build_song_index.mjs   # public/songs/index.json con metadatos (npm run songs:index)
│   └── process_pdf.py …       # Pipeline de partituras (Audiveris)
├── public/songs/<tema>/chart.json
└── docs/planning/
```

---

## Core Systems

### Game (game/Game.ts)

- Fases: `menu → playing ⇄ paused → resuming → playing → results`.
- El reloj de canción avanza con el delta real × tempo. El audio se agenda contra ese reloj, así que tempo, pausa y modo práctica nunca se desfasan.
- Modo práctica: cuando la próxima nota pendiente llega a la línea, el reloj se frena hasta que se tocan todas las teclas de ese golpe.
- Entrada: cada Note On busca la nota pendiente más vieja de esa tecla dentro de la ventana (evita que un toque tarde le robe la nota a la siguiente repetida). Note Off corta los sostenidos.
- La compensación de latencia corre el tiempo del toque; los resultados sugieren un valor con el desvío promedio.

### Arrangement (game/Arrangement.ts)

- Fácil/Normal simplifican la melodía por grilla musical (negras / corcheas, respetando síncopas aisladas) y los acordes (bajo solo / hasta 3 notas).
- Notas fuera de las 61 teclas se pliegan por octavas. En "Las dos", si los acordes caen sobre la melodía se bajan una octava (mano izquierda).
- Notas repetidas en la misma tecla se recortan para no superponerse. `isLong` = más larga que una negra y cuarto: se sostiene.

### NoteRenderer (game/NoteRenderer.ts)

- Canvas con devicePixelRatio. La pista arranca debajo del HUD (`LANE_TOP` = `--hud-h`).
- Píldoras con largo real; cabeza sólida con el nombre de la nota; las largas tienen cuerpo translúcido con hilo central.
- Guías por tecla, líneas de pulso y compás, marquesina de bombitas como línea de impacto, teclado con nombres y tecla guía iluminada.

### Audio (audio/AudioManager.ts)

- Agenda ~180 ms por delante del reloj del juego (lookahead), con `outputLatency` compensada.
- Melodía: lead cuadrada + sierra filtrada con vibrato. Acordes: colchón de triangular. Cuenta de entrada con clics.
- Si el chart trae `audioFile`, reproduce el MP3 con `playbackRate = tempo` y lo resincroniza.

---

## Data Architecture

### Tipos principales (types.ts)

- `NoteEvent`: time, note (MIDI 0-127), duration, velocity
- `ChordEvent`: time, notes[], duration
- `ChartData`: title, artist, bpm, duration, audioFile, notes[], chords[]
- `GameMode`: 'chords' | 'notes' | 'both'
- `Difficulty`: 'easy' | 'normal' | 'hard'
- `HitResult`: rating, delta, note, expectedTime, actualTime
- `GameState`: status, score, combo, maxCombo, perfects, goods, misses, totalNotes

### Chart Format

JSON con estructura:
```json
{
  "title": "Song Name",
  "artist": "Artist",
  "bpm": 120,
  "duration": 180,
  "audioFile": "path/to/audio.mp3",
  "notes": [{"time": 0, "note": 60, "duration": 0.25, "velocity": 100}],
  "chords": [{"time": 0, "notes": [60, 64, 67], "duration": 1.0}]
}
```

### Pipeline de Audio

```
YouTube URL
  -> yt-dlp (descarga audio WAV/MP3)
  -> Demucs (separa stems: bass, drums, guitar, vocals)
  -> librosa (detecta BPM)
  -> chromagram + beat tracking (extrae acordes del bajo)
  -> frequency detection (extrae notas de la guitarra)
  -> chart JSON unificado
```

---

## Testing Strategy

- **Framework:** vitest
- **Coverage:** 74 tests, 4 archivos
- **Areas cubiertas:**
  - HitDetection: ventanas perfect/good/miss, skip hit notes, expired
  - Score: evaluate, combo, miss, reset, multiplicador, sostenidos, tendencia de tiempo
  - Chart: estructura, validacion, consistencia
  - Arrangement / KeyboardLayout / notas / títulos: dificultad, rango, octavas, recortes

---

## Naming Conventions

- **Files:** PascalCase para clases (Game.ts, HitDetection.ts), camelCase para funciones
- **Classes:** PascalCase (Game, HitDetector, ScoreManager, UIManager)
- **Methods:** camelCase (detect, evaluate, showMenu)
- **Types:** PascalCase (NoteEvent, ChartData, GameState)
- **Enums/Unions:** string literals ('perfect', 'good', 'miss')

---

## Performance Budgets

- Game loop: 60fps (16.67ms por frame)
- MIDI latency: < 10ms (WebMIDI nativo)
- Audio sync: < 50ms con compensacion
- Chart load: < 1s
- Tests: < 1s

---

## Known Technical Debt

1. **Game.ts**: concentra reloj, entrada y práctica. Si crece, extraer InputHandler.
2. **NoteRenderer.ts**: un solo archivo de dibujo (~650 líneas); se podría separar teclado y efectos.
3. **Sin CI/CD**: No hay GitHub Actions.
4. **Sin coverage report**: vitest no tiene coverage configurado.
5. **Pipeline Python separado**: scripts/ no esta integrado con el build de Vite.
