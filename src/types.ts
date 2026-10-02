// Tipos compartidos del juego Acordazos

export interface NoteEvent {
  /** Tiempo en segundos desde el inicio */
  time: number;
  /** MIDI note number (0-127). Piano 61 teclas: 36-96 (C2-C7) */
  note: number;
  /** Duración en segundos */
  duration: number;
  /** Velocity (0-127) */
  velocity: number;
}

export interface ChordEvent {
  /** Tiempo en segundos desde el inicio */
  time: number;
  /** MIDI note numbers que componen el acorde */
  notes: number[];
  /** Duración en segundos */
  duration: number;
}

export interface ChartData {
  title: string;
  artist: string;
  bpm: number;
  duration: number; // segundos
  /** Path al archivo de audio (mezcla completa). Vacío = se sintetiza. */
  audioFile: string;
  /** Melodía (punteo) */
  notes: NoteEvent[];
  /** Acordes */
  chords: ChordEvent[];
}

/** Qué parte toca el jugador. 'notes' = melodía. */
export type GameMode = 'chords' | 'notes' | 'both';

export type Difficulty = 'easy' | 'normal' | 'hard';

export type HitRating = 'perfect' | 'good' | 'miss' | 'none';

export type Part = 'melody' | 'chords';

export interface HitResult {
  rating: HitRating;
  /** Diferencia absoluta en ms entre el tiempo esperado y el real */
  delta: number;
  note: number;
  expectedTime: number;
  actualTime: number;
}

export interface GameState {
  status: 'menu' | 'playing' | 'paused' | 'results';
  score: number;
  combo: number;
  maxCombo: number;
  perfects: number;
  goods: number;
  misses: number;
  totalNotes: number;
}

/** Una nota jugable, ya filtrada por modo y dificultad. */
export interface PlayNote {
  id: number;
  part: Part;
  note: number;
  /** Segundos de canción */
  time: number;
  duration: number;
  /** Nota larga: hay que mantenerla apretada para sumar */
  isLong: boolean;
}

/** Resumen liviano de una canción (para el menú, sin bajar el chart). */
export interface SongMeta {
  name: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  melodyCount: number;
  chordCount: number;
  /** Notas de melodía por segundo — sirve para estimar intensidad */
  density: number;
}
