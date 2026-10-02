// Ajustes y récords guardados en el navegador.

import type { Difficulty, GameMode } from '../types';
import type { NoteNaming } from '../music/notes';

export type FallSpeed = 'slow' | 'medium' | 'fast';

export interface Settings {
  mode: GameMode;
  difficulty: Difficulty;
  /** 0.4 a 1.5 */
  tempo: number;
  practice: boolean;
  fallSpeed: FallSpeed;
  naming: NoteNaming;
  keyboard: 'fit' | 'full';
  backing: 'all' | 'others';
  /** Compensación de latencia (ms). Positivo = tu toque se toma como más temprano. */
  latencyMs: number;
  volume: number;
  lastSong: string | null;
}

export const FALL_SECONDS: Record<FallSpeed, number> = { slow: 3.2, medium: 2.4, fast: 1.7 };

const DEFAULTS: Settings = {
  mode: 'notes',
  difficulty: 'normal',
  tempo: 1,
  practice: false,
  fallSpeed: 'medium',
  naming: 'solfege',
  keyboard: 'fit',
  backing: 'all',
  latencyMs: 0,
  volume: 0.7,
  lastSong: null,
};

const SETTINGS_KEY = 'acordazos.settings.v2';
const RECORDS_KEY = 'acordazos.records.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* modo privado o almacenamiento bloqueado: seguimos sin guardar */
  }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  const s = { ...DEFAULTS, ...saved };
  s.tempo = Math.max(0.4, Math.min(1.5, Number(s.tempo) || 1));
  s.latencyMs = Math.max(-250, Math.min(350, Number(s.latencyMs) || 0));
  s.volume = Math.max(0, Math.min(1, Number(s.volume)));
  return s;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export interface RecordEntry {
  score: number;
  stars: number;
  accuracy: number;
  date: string;
}

type RecordBook = Record<string, RecordEntry>;

const recordKey = (song: string, mode: GameMode, difficulty: Difficulty) => `${song}|${mode}|${difficulty}`;

export function getRecord(song: string, mode: GameMode, difficulty: Difficulty): RecordEntry | null {
  return read<RecordBook>(RECORDS_KEY)?.[recordKey(song, mode, difficulty)] ?? null;
}

/** Guarda si es mejor que el anterior. Devuelve true si es récord nuevo. */
export function submitRecord(song: string, mode: GameMode, difficulty: Difficulty, entry: RecordEntry): boolean {
  const book = read<RecordBook>(RECORDS_KEY) ?? {};
  const k = recordKey(song, mode, difficulty);
  const prev = book[k];
  if (prev && prev.score >= entry.score) return false;
  book[k] = entry;
  write(RECORDS_KEY, book);
  return true;
}

/** Mejores estrellas de un tema en cualquier modo/dificultad (para la lista). */
export function bestStars(song: string): number {
  const book = read<RecordBook>(RECORDS_KEY);
  if (!book) return 0;
  let best = 0;
  for (const [k, v] of Object.entries(book)) if (k.startsWith(`${song}|`)) best = Math.max(best, v.stars);
  return best;
}
