// Arma la lista de notas jugables a partir de un chart, según modo y dificultad.
// Todo puro (sin DOM) para poder testearlo.

import type { ChartData, Difficulty, GameMode, Part, PlayNote } from '../types';
import { foldIntoRange, KEYBOARD_MIN } from '../music/notes';

export interface ArrangementOptions {
  mode: GameMode;
  difficulty: Difficulty;
}

export interface Arrangement {
  notes: PlayNote[];
  /** Nota más grave y más aguda (para ajustar el teclado en pantalla) */
  lowest: number;
  highest: number;
  /** Duración de un pulso en segundos */
  beat: number;
  /** Fin de la última nota */
  endTime: number;
  /** Si en modo "las dos" los acordes se bajaron una octava */
  chordsShifted: boolean;
}

/** Una nota es "larga" (hay que sostenerla) si dura más que una negra con algo de margen. */
export function isLongDuration(duration: number, beat: number): boolean {
  return duration >= beat * 1.25;
}

const SAME_TIME = 0.02;

interface RawNote {
  part: Part;
  note: number;
  time: number;
  duration: number;
}

function beatOf(chart: ChartData): number {
  const bpm = chart.bpm > 20 && chart.bpm < 400 ? chart.bpm : 120;
  return 60 / bpm;
}

/** Agrupa eventos que suenan juntos (mismo instante). */
function groupByTime<T extends { time: number }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].time - it.time) < SAME_TIME) last.push(it);
    else groups.push([it]);
  }
  return groups;
}

function onGrid(time: number, grid: number): boolean {
  const k = time / grid;
  return Math.abs(k - Math.round(k)) * grid < SAME_TIME;
}

/**
 * Simplifica la melodía para Fácil / Normal sin romper las frases:
 * se queda con la nota de arriba de cada instante y prioriza los tiempos fuertes.
 */
export function thinMelody(notes: ChartData['notes'], beat: number, difficulty: Difficulty): ChartData['notes'] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || b.note - a.note);
  if (difficulty === 'hard' || sorted.length === 0) return sorted;

  // Una sola nota por instante: la más aguda (la que lleva la melodía)
  const tops = groupByTime(sorted).map(g => g.reduce((a, b) => (b.note > a.note ? b : a)));
  const grid = difficulty === 'normal' ? beat / 2 : beat;

  // ¿El chart está cuantizado a semicorcheas? Si sí, usamos la grilla musical.
  const aligned = tops.filter(n => onGrid(n.time, beat / 4)).length / tops.length >= 0.8;

  const kept: ChartData['notes'] = [];
  let lastKept = -Infinity;
  if (aligned) {
    for (let i = 0; i < tops.length; i++) {
      const n = tops[i];
      if (onGrid(n.time, grid)) {
        kept.push(n);
        lastKept = n.time;
        continue;
      }
      // Notas sincopadas: se quedan si están aisladas
      let nextOnGrid = Infinity;
      for (let j = i + 1; j < tops.length; j++) {
        if (onGrid(tops[j].time, grid)) { nextOnGrid = tops[j].time; break; }
      }
      if (n.time - lastKept >= grid * 0.99 && nextOnGrid - n.time >= grid * 0.99) {
        kept.push(n);
        lastKept = n.time;
      }
    }
  } else {
    for (const n of tops) {
      if (n.time - lastKept >= grid * 0.95) {
        kept.push(n);
        lastKept = n.time;
      }
    }
  }
  return kept;
}

/** Fácil: solo el bajo del acorde. Normal: hasta 3 notas. Difícil: completo. */
export function simplifyChord(notes: number[], difficulty: Difficulty): number[] {
  const uniq = [...new Set(notes)].sort((a, b) => a - b);
  if (difficulty === 'hard') return uniq;
  if (difficulty === 'normal') return uniq.slice(0, 3);
  return uniq.slice(0, 1);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function buildArrangement(chart: ChartData, opts: ArrangementOptions): Arrangement {
  const beat = beatOf(chart);
  const wantMelody = opts.mode === 'notes' || opts.mode === 'both';
  const wantChords = opts.mode === 'chords' || opts.mode === 'both';

  const raw: RawNote[] = [];

  if (wantMelody) {
    for (const n of thinMelody(chart.notes ?? [], beat, opts.difficulty)) {
      raw.push({ part: 'melody', note: foldIntoRange(n.note), time: n.time, duration: Math.max(0.05, n.duration) });
    }
  }

  let chordsShifted = false;
  if (wantChords) {
    const chordNotes: RawNote[] = [];
    const chords = [...(chart.chords ?? [])].sort((a, b) => a.time - b.time);
    for (const c of chords) {
      for (const n of simplifyChord(c.notes, opts.difficulty)) {
        chordNotes.push({ part: 'chords', note: foldIntoRange(n), time: c.time, duration: Math.max(0.05, c.duration) });
      }
    }
    // Con las dos manos: si los acordes caen en el registro de la melodía,
    // se bajan una octava para que la izquierda tenga su zona.
    if (opts.mode === 'both' && chordNotes.length && raw.length) {
      const melodyMid = median(raw.map(n => n.note));
      const chordMid = median(chordNotes.map(n => n.note));
      if (chordMid > melodyMid - 9) {
        chordsShifted = true;
        for (const n of chordNotes) n.note = n.note - 12 >= KEYBOARD_MIN ? n.note - 12 : n.note;
      }
    }
    raw.push(...chordNotes);
  }

  // Sin duplicados: misma tecla en el mismo instante cuenta una sola vez (gana la melodía)
  raw.sort((a, b) => a.note - b.note || a.time - b.time || (a.part === 'melody' ? -1 : 1));
  const deduped: RawNote[] = [];
  for (const n of raw) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.note === n.note && Math.abs(prev.time - n.time) < SAME_TIME) continue;
    deduped.push(n);
  }

  // Notas seguidas en la misma tecla: la anterior se corta antes de la siguiente
  for (let i = 0; i < deduped.length - 1; i++) {
    const a = deduped[i];
    const b = deduped[i + 1];
    if (a.note !== b.note) continue;
    const gap = 0.04;
    if (a.time + a.duration > b.time - gap) {
      a.duration = Math.max(0.05, b.time - a.time - gap);
    }
  }

  deduped.sort((a, b) => a.time - b.time || a.note - b.note);
  const notes: PlayNote[] = deduped.map((n, id) => ({
    id,
    part: n.part,
    note: n.note,
    time: n.time,
    duration: n.duration,
    isLong: isLongDuration(n.duration, beat),
  }));

  let lowest = Infinity;
  let highest = -Infinity;
  let endTime = 0;
  for (const n of notes) {
    lowest = Math.min(lowest, n.note);
    highest = Math.max(highest, n.note);
    endTime = Math.max(endTime, n.time + n.duration);
  }
  if (!notes.length) {
    lowest = 60;
    highest = 72;
  }

  return { notes, lowest, highest, beat, endTime, chordsShifted };
}

/** Eventos para la pista de fondo (sin filtrar por dificultad, en su altura original). */
export interface BackingEvent {
  part: Part;
  note: number;
  time: number;
  duration: number;
}

export function buildBacking(chart: ChartData): BackingEvent[] {
  const ev: BackingEvent[] = [];
  for (const n of chart.notes ?? []) ev.push({ part: 'melody', note: n.note, time: n.time, duration: n.duration });
  for (const c of chart.chords ?? []) {
    for (const n of new Set(c.notes)) ev.push({ part: 'chords', note: n, time: c.time, duration: c.duration });
  }
  return ev.sort((a, b) => a.time - b.time);
}
