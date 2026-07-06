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
│   ├── game/                # Logica del juego
│   │   ├── Game.ts          # Game loop, orquestador principal
│   │   ├── NoteRenderer.ts  # Rendering Canvas (carril, notas, teclado, HUD)
│   │   ├── HitDetection.ts  # Hit detection con ventanas de tolerancia
│   │   ├── Score.ts         # Scoring y combo tracking
│   │   ├── SongLoader.ts    # Carga de charts JSON desde disco
│   │   └── Chart.ts         # Chart hardcodeado de test
│   ├── midi/                # MIDI input
│   │   └── MIDIManager.ts   # WebMIDI API wrapper
│   ├── audio/               # Audio output
│   │   └── AudioManager.ts  # Web Audio API, playback + sintesis
│   ├── ui/                  # UI overlays
│   │   └── UIManager.ts    # Menu, results, MIDI error (HTML overlays)
│   ├── __tests__/           # Tests (vitest)
│   │   ├── HitDetection.test.ts
│   │   ├── Score.test.ts
│   │   └── Chart.test.ts
│   ├── types.ts             # Tipos compartidos
│   ├── style.css            # Estilos de UI overlays
│   └── main.ts              # Bootstrap
├── scripts/                 # Pipeline de audio (Python)
│   └── prepare_song.py      # YouTube -> stems -> chart JSON
├── charts/                  # Charts JSON generados
├── KANBAN.md                # Sprint tracking (legacy)
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Core Systems

### Game (game/Game.ts)

Orquestador principal. Maneja:
- Game loop (requestAnimationFrame)
- Estado: menu, playing, paused, results
- Coordinacion entre MIDI input, hit detection, scoring, rendering, audio
- Carga de canciones
- Compensacion de latencia

**Refactor realizado:** UIManager extraido a modulo separado (menu, results, MIDI error).

### NoteRenderer (game/NoteRenderer.ts)

Rendering procedural en Canvas 2D:
- Fondo con gradiente animado
- Carril de notas (horizontal, derecha a izquierda)
- Notas con glow y colores por rating
- Teclado piano al pie con glow en teclas activas
- HUD: puntaje, combo, accuracy
- Particulas de hit
- Vignette de bordes

### HitDetection (game/HitDetection.ts)

- Ventana de tolerancia configurable (perfect=80ms, good=180ms)
- detect(): busca el match mas cercano en el array de notas esperadas
- isExpired(): verifica si una nota ya paso la ventana
- Skips notas ya hit y notas con diferente numero

### Score (game/Score.ts)

- evaluate(): clasifica hit (perfect/good/miss) y suma puntos
- Combo tracking con maxCombo
- registerMiss() para notas expiradas
- reset() entre canciones

### MIDI (midi/MIDIManager.ts)

- WebMIDI API wrapper
- init(): solicita acceso a MIDI
- onNote/onNoteRelease: callbacks para Note On/Off
- getDeviceName(): nombre del dispositivo conectado

### Audio (audio/AudioManager.ts)

- Web Audio API
- Playback de MP3/WAV
- Sintesis con oscillators para canciones sin audio
- init(), play(), pause(), stop()

### UI (ui/UIManager.ts)

- HTML overlays para menu, results, MIDI error
- Callbacks para comunicacion con Game
- Sin estado propio (stateless, recibe todo por parametros)

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
- **Coverage:** 49 tests, 3 archivos
- **Areas cubiertas:**
  - HitDetection: ventanas perfect/good/miss, skip hit notes, expired (14 tests)
  - Score: evaluate, combo, miss, reset, scoring math (17 tests)
  - Chart: estructura, validacion, consistencia (18 tests)

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

1. **Game.ts (470 lineas)**: UIManager extraido. Futuro: extraer GameLoop, InputHandler.
2. **NoteRenderer.ts (500+ lineas)**: Rendering logic mezclada con game logic. Considerar separar.
3. **Sin CI/CD**: No hay GitHub Actions.
4. **Sin coverage report**: vitest no tiene coverage configurado.
5. **Pipeline Python separado**: scripts/ no esta integrado con el build de Vite.
