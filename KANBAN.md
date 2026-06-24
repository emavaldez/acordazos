# 🎸 Acordazos — Kanban de desarrollo

> Guitar Hero con teclado MIDI real. Bajás un tema de YouTube, se separan los tracks, se genera un nivel jugable.

---

## Sprint 1 — Pipeline de audio (backend CLI)

| US | Descripción | AC | QA |
|---|---|---|---|
| **US-10** | Descargar audio de YouTube | Script que recibe URL de YouTube y descarga el audio en WAV/MP3 | Descarga completa, archivo existe, duración correcta |
| **US-11** | Separar stems (bajo, batería, guitarra, voces) | Usar Demucs para separar el audio en pistas individuales | Archivos `bass.wav`, `drums.wav`, `guitar.wav`, `vocals.wav` generados |
| **US-12** | Detectar BPM de la canción | Usar `librosa` para calcular BPM del tema | BPM detectado con margen de error < 5% |
| **US-13** | Extraer progresión de acordes del bajo | Analizar `bass.wav` con chromagram + beat tracking para obtener acordes y tiempos | Array de `{acorde, beat, duracion}` válido |
| **US-14** | Extraer notas de punteo de la guitarra | Analizar `guitar.wav` para detectar notas individuales (frecuencias dominantes por beat) | Array de `{nota, beat, duracion}` sin duplicados excesivos |
| **US-15** | Generar chart JSON unificado | Combinar BPM, acordes, punteos, metadatos en un archivo JSON | JSON válido, con campos `bpm`, `chords[]`, `notes[]`, `duration`, `title` |
| **US-16** | Pipeline completa un solo comando | Script `npm run prepare <youtube-url>` que corre toda la cadena y deja el chart listo | Chart JSON generado, stems guardados, todo automático |

---

## Sprint 2 — Game engine (frontend web)

| US | Descripción | AC | QA |
|---|---|---|---|
| **US-20** | Proyecto Vite + TypeScript + Canvas | Proyecto que builda y corre `npm run dev` mostrando algo | Pantalla negra o fondo visible, sin errores de consola |
| **US-21** | Lectura de chart JSON | Loader que parsea el chart y lo deja disponible en memoria | Chart cargado, propiedades accesibles, error si falta |
| **US-22** | Conexión MIDI vía WebMIDI API | Detecta el Yamaha E333, lista sus inputs/outputs, captura Note On/Off | Consola muestra "Yamaha E333 connected", eventos Note On con número de nota y velocity |
| **US-23** | Carril horizontal de notas | Canvas con una línea horizontal que representa las teclas del piano. Las notas caen de derecha a izquierda (tipo Rock Band horizontal) | Se renderiza un carril con 2-3 octavas marcadas, las notas aparecen y se mueven |
| **US-24** | Sincronización nota-ritmo | Las notas viajan desde el extremo derecho hasta la "zona de impacto" a la izquierda, sincronizadas con el BPM del chart | Notas llegan exactamente en el beat que indica el chart |
| **US-25** | Hit detection tipo Guitar Hero | Ventana de tolerancia configurable (ej: ±100ms). Detecta si el jugador tocó la nota correcta en el momento correcto | Notas "perfect", "good", "miss" según la precisión |
| **US-26** | Playback de audio del tema | El tema completo suena de fondo mientras se juega, independientemente de lo que toque el jugador | Audio sincronizado con las notas del chart |
| **US-27** | Puntaje lineal | Cada nota bien tocada suma puntos fijos (ej: perfect=100, good=50, miss=0) | Acumulador visible, puntaje sube al tocar bien |
| **US-28** | Modos de juego toggle | Botón/switch para elegir: "Acordes", "Notas sueltas", "Ambos" | En modo Acordes solo aparecen acordes, en Notas solo punteos, en Ambos todo |
| **US-29** | Pantalla de resultados | Al terminar la canción, muestra puntaje total, aciertos, fallos | Datos correctos respecto a lo que se jugó |
| **US-30** | Selector de canciones | Menú que lista los charts disponibles en `charts/` y permite elegir uno | Lista los .json, al seleccionar carga y empieza el juego |

---

## Sprint 3 — UX / Polish

| US | Descripción | AC | QA |
|---|---|---|---|
| **US-31** | Visual feedback al tocar | La tecla en el carril se ilumina/colorea cuando el jugador presiona la nota correcta | La nota cambia de color visiblemente |
| **US-32** | Mensaje de error si no hay MIDI | Si no se detecta teclado MIDI, muestra pantalla de error | Al abrir sin MIDI conectado, muestra aviso claro |
| **US-33** | Responsive / pantalla completa | El juego se adapta al tamaño de la ventana / pantalla completa | Se ve bien en 1920x1080 y en ventanas más chicas |
| **US-34** | Delay/latency compensation | Slider de ajuste de latencia (ms) para sincronizar audio con MIDI | Al mover el slider, las notas se adelantan/atrasan visualmente |
| **US-35** | Teclado en pantalla | Render animado del teclado del Yamaha E333 (61 teclas) con teclas que se iluminan al tocar | Teclado visible abajo del carril, teclas se encienden en tiempo real |

---

## Sprint 4 — Extras

| US | Descripción | Prioridad |
|---|---|---|
| **US-40** | Modo práctica (velocidad reducida) | Baja |
| **US-41** | Historias de puntaje local | Baja |
| **US-42** | Efectos visuales (partículas, trails) | Baja |
| **US-43** | Loop de un segmento (practicar parte difícil) | Media |
| **US-44** | Guardado de progreso / perfil de jugador | Baja |

---

## Stack técnico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 20+ |
| Frontend | Vite + TypeScript + Canvas API |
| MIDI | WebMIDI API (Chrome/Edge) |
| Audio descarga | yt-dlp |
| Separación stems | Demucs (PyTorch) |
| Análisis musical | librosa (BPM, chromagram, pitch detection) |
| MIDI notas | mido (para debug / export) |
| Repo | GitHub: emavaldez/acordazos |

---

## Glosario

- **Chart**: Archivo JSON con toda la info de la canción para el juego
- **Carril**: La línea horizontal donde las notas viajan hacia la zona de impacto
- **Zona de impacto**: Zona a la izquierda del carril donde hay que tocar la nota
- **Nota**: Una tecla individual del piano
- **Acorde**: Múltiples teclas presionadas simultáneamente
- **Stem**: Pista de audio separada (bajo, guitarra, batería, voces)
- **Beat**: Unidad de tiempo musical
- **BPM**: Beats per minute