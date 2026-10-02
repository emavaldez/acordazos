import { describe, it, expect } from 'vitest';
import { buildArrangement, thinMelody, simplifyChord, isLongDuration, buildBacking } from '../game/Arrangement';
import { fitRange, KeyboardLayout } from '../game/KeyboardLayout';
import { ScoreManager } from '../game/Score';
import { noteName, foldIntoRange, isBlack } from '../music/notes';
import { testChart } from '../game/Chart';
import type { ChartData } from '../types';

const sixteenths = (count: number, start = 0, note = 72) =>
  Array.from({ length: count }, (_, i) => ({ time: start + i * 0.125, note: note + (i % 5), duration: 0.125, velocity: 100 }));

describe('thinMelody', () => {
  it('hard keeps every note', () => {
    const notes = sixteenths(16);
    expect(thinMelody(notes, 0.5, 'hard')).toHaveLength(16);
  });

  it('normal keeps the eighth-note grid (downbeats included)', () => {
    const kept = thinMelody(sixteenths(16), 0.5, 'normal');
    expect(kept.map(n => n.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  });

  it('easy keeps only the beats', () => {
    const kept = thinMelody(sixteenths(16), 0.5, 'easy');
    expect(kept.map(n => n.time)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('keeps an isolated syncopated note instead of leaving a hole', () => {
    const notes = [
      { time: 0, note: 72, duration: 0.5, velocity: 100 },
      { time: 0.375, note: 74, duration: 0.5, velocity: 100 }, // síncopa sola
      { time: 1.0, note: 76, duration: 0.5, velocity: 100 },
    ];
    const kept = thinMelody(notes, 0.5, 'easy');
    expect(kept.map(n => n.time)).toEqual([0, 1.0]);
    const keptNormal = thinMelody(notes, 0.5, 'normal');
    expect(keptNormal.map(n => n.time)).toEqual([0, 0.375, 1.0]);
  });

  it('collapses simultaneous notes to the top one on easier levels', () => {
    const notes = [
      { time: 0, note: 64, duration: 0.5, velocity: 100 },
      { time: 0, note: 76, duration: 0.5, velocity: 100 },
    ];
    expect(thinMelody(notes, 0.5, 'normal').map(n => n.note)).toEqual([76]);
    expect(thinMelody(notes, 0.5, 'hard')).toHaveLength(2);
  });
});

describe('simplifyChord', () => {
  it('easy = bass only, normal = up to three notes, hard = full', () => {
    expect(simplifyChord([67, 71, 74, 77], 'easy')).toEqual([67]);
    expect(simplifyChord([67, 71, 74, 77], 'normal')).toEqual([67, 71, 74]);
    expect(simplifyChord([77, 67, 71, 74, 67], 'hard')).toEqual([67, 71, 74, 77]);
  });
});

describe('buildArrangement', () => {
  it('melody mode only contains melody notes', () => {
    const a = buildArrangement(testChart, { mode: 'notes', difficulty: 'hard' });
    expect(a.notes.every(n => n.part === 'melody')).toBe(true);
    expect(a.notes.length).toBe(testChart.notes.length);
  });

  it('chords mode counts every key of every chord', () => {
    const a = buildArrangement(testChart, { mode: 'chords', difficulty: 'hard' });
    const expected = testChart.chords.reduce((s, c) => s + new Set(c.notes).size, 0);
    expect(a.notes.length).toBe(expected);
    expect(a.notes.every(n => n.part === 'chords')).toBe(true);
  });

  it('notes come out sorted by time with unique ids', () => {
    const a = buildArrangement(testChart, { mode: 'both', difficulty: 'normal' });
    for (let i = 1; i < a.notes.length; i++) expect(a.notes[i].time).toBeGreaterThanOrEqual(a.notes[i - 1].time);
    expect(new Set(a.notes.map(n => n.id)).size).toBe(a.notes.length);
  });

  it('both mode moves chords an octave down when they overlap the melody', () => {
    const a = buildArrangement(testChart, { mode: 'both', difficulty: 'hard' });
    expect(a.chordsShifted).toBe(true);
    const chordTop = Math.max(...a.notes.filter(n => n.part === 'chords').map(n => n.note));
    const chordOriginalTop = Math.max(...testChart.chords.flatMap(c => c.notes));
    expect(chordTop).toBe(chordOriginalTop - 12);
  });

  it('folds out-of-range notes into the 61-key range', () => {
    const chart: ChartData = {
      ...testChart,
      notes: [{ time: 0, note: 103, duration: 0.5, velocity: 100 }, { time: 1, note: 30, duration: 0.5, velocity: 100 }],
      chords: [],
    };
    const a = buildArrangement(chart, { mode: 'notes', difficulty: 'hard' });
    expect(a.notes.map(n => n.note)).toEqual([91, 42]);
  });

  it('trims a note that would overlap the next one on the same key', () => {
    const chart: ChartData = {
      ...testChart,
      notes: [{ time: 0, note: 72, duration: 2, velocity: 100 }, { time: 1, note: 72, duration: 0.5, velocity: 100 }],
      chords: [],
    };
    const a = buildArrangement(chart, { mode: 'notes', difficulty: 'hard' });
    expect(a.notes[0].time + a.notes[0].duration).toBeLessThan(1);
  });

  it('marks long notes', () => {
    expect(isLongDuration(1.0, 0.5)).toBe(true);
    expect(isLongDuration(0.5, 0.5)).toBe(false);
    const a = buildArrangement(testChart, { mode: 'notes', difficulty: 'hard' });
    expect(a.notes.some(n => n.isLong)).toBe(true);
    expect(a.notes.some(n => !n.isLong)).toBe(true);
  });

  it('backing keeps the whole song regardless of difficulty', () => {
    const b = buildBacking(testChart);
    expect(b.filter(e => e.part === 'melody')).toHaveLength(testChart.notes.length);
  });
});

describe('fitRange / KeyboardLayout', () => {
  it('full keyboard is 61 keys', () => {
    const [lo, hi] = fitRange(60, 72, true);
    expect(new KeyboardLayout(lo, hi, 1000).keys).toHaveLength(61);
  });

  it('zoomed range covers the song, starts on Do/Fa and has at least 15 white keys', () => {
    const [lo, hi] = fitRange(67, 79, false);
    expect(lo).toBeLessThanOrEqual(65);
    expect(hi).toBeGreaterThanOrEqual(81);
    expect([0, 5]).toContain(lo % 12);
    const layout = new KeyboardLayout(lo, hi, 1000);
    expect(layout.keys.filter(k => !k.isBlack).length).toBeGreaterThanOrEqual(15);
  });

  it('never leaves the physical keyboard', () => {
    const [lo, hi] = fitRange(36, 96, false);
    expect(lo).toBe(36);
    expect(hi).toBe(96);
  });

  it('white keys tile the full width', () => {
    const layout = new KeyboardLayout(48, 71, 1400);
    const whites = layout.keys.filter(k => !k.isBlack);
    const last = whites[whites.length - 1];
    expect(last.x + last.w).toBeCloseTo(1400);
    expect(layout.get(49)?.isBlack).toBe(true);
  });
});

describe('ScoreManager extras', () => {
  it('multiplier climbs every 10 hits and caps at x4', () => {
    const s = new ScoreManager(100);
    for (let i = 0; i < 9; i++) s.evaluate(i, i);
    expect(s.multiplier).toBe(1);
    s.evaluate(9, 9);
    expect(s.multiplier).toBe(2);
    for (let i = 10; i < 60; i++) s.evaluate(i, i);
    expect(s.multiplier).toBe(4);
  });

  it('sustain adds points over time', () => {
    const s = new ScoreManager(10);
    s.addSustain(0.5);
    s.addSustain(0.5);
    expect(s.state.score).toBe(100);
    expect(s.sustainHeld).toBeCloseTo(1);
  });

  it('reports timing bias once there is enough data', () => {
    const s = new ScoreManager(10);
    for (let i = 0; i < 7; i++) s.evaluate(i, i + 0.04);
    expect(s.timingBias).toBeNull();
    s.evaluate(8, 8.04);
    expect(s.timingBias).toBeCloseTo(40, 0);
  });
});

describe('note helpers', () => {
  it('names notes in solfège and letters', () => {
    expect(noteName(60, 'solfege')).toBe('Do');
    expect(noteName(61, 'solfege')).toBe('Do♯');
    expect(noteName(67, 'letters')).toBe('G');
    expect(noteName(67, 'none')).toBe('');
  });

  it('folds and classifies', () => {
    expect(foldIntoRange(100)).toBe(88);
    expect(isBlack(66)).toBe(true);
    expect(isBlack(64)).toBe(false);
  });
});

describe('normalizeTitle', () => {
  it('keeps good titles', async () => {
    const { normalizeTitle } = await import('../game/SongLoader');
    expect(normalizeTitle('carinito', 'Carinito', 'Los hijos del sol')).toEqual({ title: 'Carinito', artist: 'Los hijos del sol' });
  });

  it('uses the other field when the OCR title is junk', async () => {
    const { normalizeTitle } = await import('../game/SongLoader');
    expect(normalizeTitle('dm', 'Dm', 'Los duenos del pabellon')).toEqual({ title: 'Los duenos del pabellon', artist: '' });
    expect(normalizeTitle('2', '2', 'Fuga villera No.2')).toEqual({ title: 'Fuga villera No.2 (2)', artist: '' });
  });
});
