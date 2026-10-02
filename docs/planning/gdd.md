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
6. Recibir feedback: justo (ámbar), bien (lila), pifiada (×)
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

| Dificultad | Justo | Bien |
|---|---|---|
| Fácil | ±100 ms | ±220 ms |
| Normal | ±80 ms | ±180 ms |
| Difícil | ±60 ms | ±140 ms |

Fuera de la ventana: pifiada (corta la racha). Teclas de más no castigan.

### Scoring

- Justo = 100, Bien = 50, por el multiplicador.
- Multiplicador x1 → x4: sube cada 10 aciertos seguidos.
- Notas largas: 100 puntos por segundo sostenido (por el multiplicador). Soltar antes corta la suma, no es pifiada.
- Estrellas por % de notas acertadas: 95 / 85 / 70 / 50.
- Récord local por tema, modo y dificultad.

### Difficulty Levels

- **Fácil**: melodía en negras (una nota por golpe, la más aguda), acordes solo con el bajo.
- **Normal**: melodía en corcheas, acordes de hasta 3 notas.
- **Difícil**: todo el chart.
- En las tres se conservan las síncopas aisladas para no dejar huecos en la frase.

### Tempo

- 40 % a 150 % desde el menú, o con − / + y las teclas [ ] durante el tema. El audio sigue al tempo.

### Práctica

- Las notas se frenan en la línea hasta que tocás todas las del golpe. Sin puntaje ni pifiadas; al final muestra notas, tiempo y cuántas veces esperó.

### Latency Compensation

- Ajuste de −250 a +350 ms. Positivo = tu toque se toma como más temprano.
- Al terminar un tema se muestra el desvío promedio y un botón para compensarlo.

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

### Art Style — "Neón de bailanta"

- Noche violeta (#140827) con pared de LEDs de fondo; fucsia (#ff3fa0) para acordes, cian (#2ee6ff) para melodía, ámbar (#ffc23a) para la marquesina y los aciertos.
- Notas que caen verticalmente sobre el teclado (estilo piano roll), con el largo real de la nota y su nombre (Do Re Mi / C D E).
- Tecla negra = tono más oscuro de la misma parte, con borde brillante.
- Línea de impacto como marquesina de bombitas; las bombitas sobre la tecla se encienden al acertar.
- Teclado ajustado al rango del tema (o las 61 teclas), con mini-mapa del E333 en el HUD.
- Tipografías: Bungee (carteles, puntaje) y Archivo de Omnibus-Type (interfaz), empaquetadas con @fontsource.

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

- 74 tests pasando (4 archivos)
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
- Loop de sección A/B (el modo práctica existe, pero sin loop)
- Export/import de charts manuales
- Mobile nativo (solo web)
- VR/AR

---

## Assumptions and Dependencies

- El jugador tiene un teclado MIDI con conexion USB
- Navegador con soporte WebMIDI (Chrome, Edge)
- Python 3.10+ con Demucs y librosa para pipeline
- Node.js 20+ para desarrollo
