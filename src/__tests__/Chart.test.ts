// Tests for Chart — chart data validation and structure
import { describe, it, expect } from 'vitest';
import { testChart } from '../game/Chart.js';
import type { ChartData } from '../types';

describe('Chart data', () => {
  describe('testChart structure', () => {
    it('has required top-level fields', () => {
      expect(testChart.title).toBeDefined();
      expect(testChart.artist).toBeDefined();
      expect(testChart.bpm).toBeGreaterThan(0);
      expect(testChart.duration).toBeGreaterThan(0);
      expect(testChart.notes).toBeDefined();
      expect(testChart.chords).toBeDefined();
    });

    it('has notes array', () => {
      expect(Array.isArray(testChart.notes)).toBe(true);
      expect(testChart.notes.length).toBeGreaterThan(0);
    });

    it('has chords array', () => {
      expect(Array.isArray(testChart.chords)).toBe(true);
      expect(testChart.chords.length).toBeGreaterThan(0);
    });
  });

  describe('note events', () => {
    it('each note has required fields', () => {
      for (const note of testChart.notes) {
        expect(note.time).toBeGreaterThanOrEqual(0);
        expect(note.note).toBeGreaterThanOrEqual(0);
        expect(note.note).toBeLessThanOrEqual(127);
        expect(note.duration).toBeGreaterThan(0);
        expect(note.velocity).toBeGreaterThan(0);
      }
    });

    it('notes are sorted by time', () => {
      for (let i = 1; i < testChart.notes.length; i++) {
        expect(testChart.notes[i].time).toBeGreaterThanOrEqual(testChart.notes[i - 1].time);
      }
    });

    it('all notes are within chart duration', () => {
      for (const note of testChart.notes) {
        expect(note.time).toBeLessThanOrEqual(testChart.duration);
      }
    });

    it('notes use valid MIDI range (36-96 for 61-key piano)', () => {
      for (const note of testChart.notes) {
        expect(note.note).toBeGreaterThanOrEqual(36);
        expect(note.note).toBeLessThanOrEqual(96);
      }
    });
  });

  describe('chord events', () => {
    it('each chord has required fields', () => {
      for (const chord of testChart.chords) {
        expect(chord.time).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(chord.notes)).toBe(true);
        expect(chord.notes.length).toBeGreaterThanOrEqual(2);
        expect(chord.duration).toBeGreaterThan(0);
      }
    });

    it('chords are sorted by time', () => {
      for (let i = 1; i < testChart.chords.length; i++) {
        expect(testChart.chords[i].time).toBeGreaterThanOrEqual(testChart.chords[i - 1].time);
      }
    });

    it('chord notes are valid MIDI numbers', () => {
      for (const chord of testChart.chords) {
        for (const note of chord.notes) {
          expect(note).toBeGreaterThanOrEqual(0);
          expect(note).toBeLessThanOrEqual(127);
        }
      }
    });

    it('all chords are within chart duration', () => {
      for (const chord of testChart.chords) {
        expect(chord.time).toBeLessThanOrEqual(testChart.duration);
      }
    });
  });

  describe('chart consistency', () => {
    it('BPM is reasonable (40-300)', () => {
      expect(testChart.bpm).toBeGreaterThanOrEqual(40);
      expect(testChart.bpm).toBeLessThanOrEqual(300);
    });

    it('duration is positive', () => {
      expect(testChart.duration).toBeGreaterThan(0);
    });

    it('has at least 10 notes for a playable chart', () => {
      expect(testChart.notes.length).toBeGreaterThanOrEqual(10);
    });
  });
});

describe('Chart validation helpers', () => {
  // Helper function that could be used by SongLoader
  function validateChart(chart: ChartData): string[] {
    const errors: string[] = [];
    if (!chart.title) errors.push('Missing title');
    if (!chart.bpm || chart.bpm <= 0) errors.push('Invalid BPM');
    if (!chart.duration || chart.duration <= 0) errors.push('Invalid duration');
    if (!chart.notes || chart.notes.length === 0) errors.push('No notes');
    if (!chart.chords || chart.chords.length === 0) errors.push('No chords');
    for (const note of chart.notes || []) {
      if (note.note < 0 || note.note > 127) errors.push(`Invalid note: ${note.note}`);
      if (note.time < 0) errors.push(`Negative note time: ${note.time}`);
    }
    return errors;
  }

  it('validates a correct chart', () => {
    const errors = validateChart(testChart);
    expect(errors).toHaveLength(0);
  });

  it('catches missing title', () => {
    const badChart = { ...testChart, title: '' };
    expect(validateChart(badChart)).toContain('Missing title');
  });

  it('catches invalid BPM', () => {
    const badChart = { ...testChart, bpm: 0 };
    expect(validateChart(badChart)).toContain('Invalid BPM');
  });

  it('catches no notes', () => {
    const badChart = { ...testChart, notes: [] };
    expect(validateChart(badChart)).toContain('No notes');
  });
});
