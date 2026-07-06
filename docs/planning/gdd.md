# Acordazos - Game Design Document

**Author:** Emmanuel Valdez
**Game Type:** Rhythm Game (Guitar Hero con teclado MIDI)
**Target Platform:** Web (Vite/TypeScript, WebMIDI, Web Audio API)

---

## Executive Summary

### Core Concept

Acordazos es un juego de ritmo tipo Guitar Hero donde el instrumento es un teclado MIDI real. Bajas un tema de YouTube, el pipeline separa los stems (bajo, bateria, guitarra, voces), detecta BPM, extrae acordes del bajo y notas del punteo de la guitarra, y genera un chart jugable. Las notas caen horizontalmente hacia una zona de impacto y el jugador las toca en el teclado MIDI sincronizado con el tema.

### Target Audience

- Musicos que tocan teclado/piano y quieren practicar con canciones reales
- Fans de Guitar Hero/Rock Band que quieren un instrumento real
- Publico hispanohablante (cumbia, rock nacional)

### Unique Selling Points (USPs)

- Usa un teclado MIDI real como controlador (no plastic guitars)
- Pipeline automatico: YouTube -> stems -> chart jugable
- 112 canciones del PDF cumbieishon ya procesadas
- Sintesis de audio con Web Audio API para canciones sin MP3
- Multiples modos: acordes, notas sueltas, o ambos

---

## Core Gameplay

### Game Pillars

1. **Midi real**: El input es un teclado MIDI fisico. Si cortas el MIDI, el juego no tiene sentido — no es Guitar Hero sin guitarra.
2. **Pipeline automatico**: Cualquier cancion de YouTube se convierte en nivel jugable sin trabajo manual. Si cortas el pipeline, hay que transcribir a mano.
3. **Sincronizacion**: Las notas llegan a la zona de impacto exactamente en el beat del tema. Si cortas la sincronizacion, el juego no se siente como ritmo.

### Core Gameplay Loop

1. Seleccionar cancion del menu
2. Elegir modo (acordes, notas, ambos) y dificultad
3. Ajustar velocidad y latencia si hace falta
4. Empezar: tema suena, notas caen horizontalmente
5. Tocar cada nota en el teclado MIDI cuando llega a la zona de impacto
6. Recibir feedback: perfect (verde), good (amarillo), miss (rojo)
7. Combo se acumula con hits consecutivos, se resetea en miss
8. Al terminar: pantalla de resultados con puntaje, estrellas, accuracy

### Win/Loss Conditions

- No hay win/loss formal. El objetivo es maximizar puntaje y accuracy.
- 5 estrellas = 95%+ accuracy, 4 = 80%+, 3 = 65%+, 2 = 40%+, 1 = menos

---

## Game Mechanics

### Primary Mechanics

- **Tocar nota**: Presionar tecla MIDI cuando la nota llega a la zona de impacto
- **Sostener nota**: Mantener tecla presionada por la duracion de la nota
- **Acorde**: Presionar multiples teclas simultaneamente
- **Compensar latencia**: Ajustar offset de ms para sincronizar con el audio

### Controls and Input

- Teclado MIDI (input principal): Note On/Off via WebMIDI API
- Mouse (UI): seleccionar cancion, modo, dificultad, velocidad
- Teclado PC (fallback): si no hay MIDI conectado

---

## Rhythm Game Specific Elements

### Note Charts

- Formato: JSON con campos bpm, duration, notes[], chords[]
- Notas: { time, note (MIDI 36-96), duration, velocity }
- Acordes: { time, notes[], duration }
- Charts generados por pipeline automatico (Demucs + librosa + Audiveris)

### Hit Windows

- **Perfect**: ±80ms del beat esperado (100 puntos)
- **Good**: ±180ms del beat esperado (50 puntos)
- **Miss**: fuera de ventana (0 puntos, reset combo)

### Scoring

- Perfect = 100 puntos
- Good = 50 puntos
- Miss = 0 puntos
- Combo: se acumula con hits consecutivos
- Max combo: se trackea por cancion

### Difficulty Levels

- **Facil**: notas espaciadas, solo acordes basicos, ventana ampliada
- **Normal**: notas normales, acordes + punteos, ventana estandar
- **Dificil**: notas densas, punteos rapidos, ventana reducida

### Speed Control

- 0.5x: notas viajan a mitad de velocidad (principiantes)
- 1x: velocidad normal
- 2x: doble velocidad (avanzado)

### Latency Compensation

- Offset ajustable de -500ms a +500ms en pasos de 50ms
- Negativo: notas llegan antes (compensa audio que tarda)
- Positivo: notas llegan despues (compensa MIDI que tarda)

---

## Progression and Balance

### Player Progression

- No hay progression entre canciones. Cada cancion es independiente.
- El jugador progresa subiendo dificultad y velocidad.

### Difficulty Curve

- Facil: canciones simples, notas espaciadas
- Normal: canciones normales, mix de acordes y punteos
- Dificil: canciones complejas, punteos rapidos

### Economy and Resources

- No hay economia ni recursos. Puntaje es la unica moneda.

---

## Art and Audio Direction

### Art Style

- Estetica synthwave/neon: fondo oscuro, notas con glow, teclas iluminadas
- Carril horizontal con notas que viajan de derecha a izquierda
- Teclado piano renderizado al pie del carril con glow en teclas activas
- Particulas de hit en la zona de impacto

### Audio and Music

- Playback del tema completo durante el juego
- Sintesis de audio con Web Audio API (oscillators) para canciones sin MP3
- Feedback sonoro de hits (opcional)

---

## Technical Specifications

### Performance Requirements

- 60fps en game loop (Canvas rendering)
- Latencia MIDI < 10ms (WebMIDI API nativo)
- Audio sync < 50ms con compensacion de latencia
- Carga de chart < 1s

### Platform-Specific Details

- Web (navegador moderno con WebMIDI support: Chrome, Edge)
- TypeScript + Vite
- WebMIDI API para input
- Web Audio API para playback y sintesis
- Canvas 2D para rendering

### Asset Requirements

- Charts JSON (generados por pipeline)
- Audio MP3/WAV (descargado de YouTube)
- Sin sprites ni assets graficos (todo Canvas procedural)

---

## Development Epics

### Epic 1: Pipeline de Audio (backend CLI)
- Descargar audio de YouTube
- Separar stems con Demucs
- Detectar BPM con librosa
- Extraer acordes y notas
- Generar chart JSON

### Epic 2: Game Engine (frontend)
- Proyecto Vite + TypeScript + Canvas
- Lectura de chart JSON
- Conexion MIDI via WebMIDI
- Carril horizontal de notas
- Sincronizacion nota-ritmo
- Hit detection
- Playback de audio
- Puntaje
- Modos de juego
- Pantalla de resultados
- Selector de canciones

### Epic 3: UX / Polish
- Visual feedback al tocar
- Mensaje de error si no hay MIDI
- Responsive / pantalla completa
- Delay/latency compensation

---

## Success Metrics

### Technical Metrics

- 49 tests pasando (3 archivos)
- 0 tests failing
- Build sin errores TypeScript
- 112 canciones procesadas

### Gameplay Metrics

- Pipeline automatico funciona end-to-end
- MIDI input con latencia < 10ms
- Sincronizacion nota-ritmo correcta
- Feedback visual claro (perfect/good/miss)

---

## Out of Scope

- Multijugador online
- Leaderboards
- Modo practica con seccion A/B
- Export/import de charts manuales
- Mobile nativo (solo web)
- VR/AR

---

## Assumptions and Dependencies

- El jugador tiene un teclado MIDI con conexion USB
- Navegador con soporte WebMIDI (Chrome, Edge)
- Python 3.10+ con Demucs y librosa para pipeline
- Node.js 20+ para desarrollo
