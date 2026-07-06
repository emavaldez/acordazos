// Tests for ScoreManager — scoring and combo tracking
import { describe, it, expect, beforeEach } from 'vitest';
import { ScoreManager } from '../game/Score.js';

describe('ScoreManager', () => {
  let score: ScoreManager;

  beforeEach(() => {
    score = new ScoreManager(100);
  });

  describe('constructor', () => {
    it('initializes with correct state', () => {
      expect(score.state.score).toBe(0);
      expect(score.state.combo).toBe(0);
      expect(score.state.maxCombo).toBe(0);
      expect(score.state.perfects).toBe(0);
      expect(score.state.goods).toBe(0);
      expect(score.state.misses).toBe(0);
      expect(score.state.totalNotes).toBe(100);
      expect(score.state.status).toBe('menu');
    });
  });

  describe('evaluate', () => {
    it('returns perfect when delta <= 80ms', () => {
      const result = score.evaluate(1.0, 1.0); // 0ms delta
      expect(result.rating).toBe('perfect');
      expect(result.points).toBe(100);
      expect(score.state.perfects).toBe(1);
      expect(score.state.score).toBe(100);
      expect(score.state.combo).toBe(1);
    });

    it('returns perfect when delta is 50ms', () => {
      const result = score.evaluate(1.0, 1.05); // 50ms delta
      expect(result.rating).toBe('perfect');
      expect(result.points).toBe(100);
    });

    it('returns good when delta is 120ms (outside perfect, inside good)', () => {
      const result = score.evaluate(1.0, 1.12); // 120ms delta
      expect(result.rating).toBe('good');
      expect(result.points).toBe(50);
      expect(score.state.goods).toBe(1);
      expect(score.state.score).toBe(50);
      expect(score.state.combo).toBe(1);
    });

    it('returns miss when delta exceeds 180ms', () => {
      const result = score.evaluate(1.0, 1.3); // 300ms delta
      expect(result.rating).toBe('miss');
      expect(result.points).toBe(0);
      expect(score.state.misses).toBe(1);
      expect(score.state.score).toBe(0);
      expect(score.state.combo).toBe(0);
    });

    it('handles negative delta (playing early)', () => {
      const result = score.evaluate(1.0, 0.95); // 50ms before
      expect(result.rating).toBe('perfect');
    });

    it('tracks combo across multiple hits', () => {
      score.evaluate(1.0, 1.0); // perfect, combo=1
      score.evaluate(2.0, 2.0); // perfect, combo=2
      score.evaluate(3.0, 3.0); // perfect, combo=3
      expect(score.state.combo).toBe(3);
      expect(score.state.maxCombo).toBe(3);
    });

    it('resets combo on miss', () => {
      score.evaluate(1.0, 1.0); // perfect, combo=1
      score.evaluate(2.0, 2.0); // perfect, combo=2
      score.evaluate(3.0, 3.5); // miss, combo=0
      expect(score.state.combo).toBe(0);
      expect(score.state.maxCombo).toBe(2); // max stays at 2
    });

    it('updates maxCombo when combo exceeds it', () => {
      score.evaluate(1.0, 1.0); // combo=1
      score.evaluate(2.0, 2.0); // combo=2
      score.evaluate(3.0, 3.0); // combo=3
      score.evaluate(4.0, 4.0); // combo=4
      expect(score.state.maxCombo).toBe(4);
    });
  });

  describe('registerMiss', () => {
    it('increments misses and resets combo', () => {
      score.evaluate(1.0, 1.0); // combo=1
      score.registerMiss();
      expect(score.state.misses).toBe(1);
      expect(score.state.combo).toBe(0);
    });

    it('does not change score', () => {
      score.evaluate(1.0, 1.0); // score=100
      score.registerMiss();
      expect(score.state.score).toBe(100);
    });
  });

  describe('reset', () => {
    it('resets all counters to 0', () => {
      score.evaluate(1.0, 1.0); // score=100, combo=1, perfects=1
      score.evaluate(2.0, 2.0); // score=200, combo=2, perfects=2
      score.reset();
      expect(score.state.score).toBe(0);
      expect(score.state.combo).toBe(0);
      expect(score.state.maxCombo).toBe(0);
      expect(score.state.perfects).toBe(0);
      expect(score.state.goods).toBe(0);
      expect(score.state.misses).toBe(0);
    });

    it('preserves totalNotes', () => {
      score.reset();
      expect(score.state.totalNotes).toBe(100);
    });
  });

  describe('scoring math', () => {
    it('perfect = 100 points', () => {
      score.evaluate(1.0, 1.0);
      expect(score.state.score).toBe(100);
    });

    it('good = 50 points', () => {
      score.evaluate(1.0, 1.1); // 100ms = good
      expect(score.state.score).toBe(50);
    });

    it('miss = 0 points', () => {
      score.evaluate(1.0, 1.5); // 500ms = miss
      expect(score.state.score).toBe(0);
    });

    it('mixed sequence scores correctly', () => {
      score.evaluate(1.0, 1.0);    // perfect: 100
      score.evaluate(2.0, 2.1);    // good: 50
      score.evaluate(3.0, 3.5);    // miss: 0
      score.evaluate(4.0, 4.0);    // perfect: 100
      expect(score.state.score).toBe(250);
      expect(score.state.perfects).toBe(2);
      expect(score.state.goods).toBe(1);
      expect(score.state.misses).toBe(1);
    });
  });
});
