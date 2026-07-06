// Tests for HitDetection — Guitar Hero style hit detection
import { describe, it, expect, beforeEach } from 'vitest';
import { HitDetector } from '../game/HitDetection.js';

describe('HitDetector', () => {
  let detector: HitDetector;

  beforeEach(() => {
    detector = new HitDetector(80, 180); // perfect=80ms, good=180ms
  });

  describe('constructor', () => {
    it('creates with default windows', () => {
      const d = new HitDetector();
      // Default: perfect=80, good=180
      const result = d.detect(60, 1.0, [{ note: 60, time: 1.0, duration: 0.25, hit: false }]);
      expect(result?.rating).toBe('perfect');
    });

    it('creates with custom windows', () => {
      const d = new HitDetector(50, 100);
      // 60ms delta: perfect for default but good for custom (50ms perfect)
      const result = d.detect(60, 1.0, [{ note: 60, time: 1.06, duration: 0.25, hit: false }]);
      expect(result?.rating).toBe('good'); // 60ms > 50ms perfect, < 100ms good
    });
  });

  describe('detect', () => {
    it('returns perfect when delta <= perfectWindow', () => {
      const expected = [{ note: 60, time: 1.0, duration: 0.25, hit: false }];
      const result = detector.detect(60, 1.0, expected); // delta = 0ms
      expect(result).not.toBeNull();
      expect(result!.rating).toBe('perfect');
      expect(result!.delta).toBe(0);
    });

    it('returns perfect when delta is within perfectWindow (50ms)', () => {
      const expected = [{ note: 60, time: 1.0, duration: 0.25, hit: false }];
      // 50ms off = 0.05s
      const result = detector.detect(60, 1.05, expected);
      expect(result!.rating).toBe('perfect');
    });

    it('returns good when delta is within goodWindow but outside perfectWindow', () => {
      const expected = [{ note: 60, time: 1.0, duration: 0.25, hit: false }];
      // 120ms off = 0.12s — outside perfect (80ms) but inside good (180ms)
      const result = detector.detect(60, 1.12, expected);
      expect(result!.rating).toBe('good');
    });

    it('returns null when delta exceeds goodWindow', () => {
      const expected = [{ note: 60, time: 1.0, duration: 0.25, hit: false }];
      // 200ms off = 0.2s — outside good (180ms)
      const result = detector.detect(60, 1.2, expected);
      expect(result).toBeNull();
    });

    it('skips already hit notes', () => {
      const expected = [
        { note: 60, time: 1.0, duration: 0.25, hit: true },
        { note: 60, time: 1.05, duration: 0.25, hit: false },
      ];
      const result = detector.detect(60, 1.0, expected);
      // First note is hit=true, should match second at 1.05 (50ms away)
      expect(result).not.toBeNull();
      expect(result!.expectedTime).toBe(1.05);
    });

    it('skips notes with different note number', () => {
      const expected = [
        { note: 62, time: 1.0, duration: 0.25, hit: false },
        { note: 64, time: 1.0, duration: 0.25, hit: false },
      ];
      const result = detector.detect(60, 1.0, expected);
      expect(result).toBeNull();
    });

    it('returns the closest match when multiple candidates exist', () => {
      const expected = [
        { note: 60, time: 1.0, duration: 0.25, hit: false },
        { note: 60, time: 1.1, duration: 0.25, hit: false },
      ];
      // Playing at 1.05 — closer to 1.0 (50ms) than 1.1 (50ms)... same
      // Actually 1.05 is 50ms from 1.0 and 50ms from 1.1 — equal
      // Let's use 1.02 — 20ms from 1.0, 80ms from 1.1
      const result = detector.detect(60, 1.02, expected);
      expect(result!.expectedTime).toBe(1.0);
    });

    it('handles negative delta (playing before expected time)', () => {
      const expected = [{ note: 60, time: 1.0, duration: 0.25, hit: false }];
      // Play at 0.95 — 50ms before
      const result = detector.detect(60, 0.95, expected);
      expect(result!.rating).toBe('perfect');
    });

    it('returns null for empty expected notes', () => {
      const result = detector.detect(60, 1.0, []);
      expect(result).toBeNull();
    });
  });

  describe('isExpired', () => {
    it('returns true when note passed the good window', () => {
      // expected at 1.0, current at 1.3 — 300ms past, > 180ms good window
      expect(detector.isExpired(1.0, 1.3)).toBe(true);
    });

    it('returns false when note is still within window', () => {
      // expected at 1.0, current at 1.1 — 100ms past, < 180ms good window
      expect(detector.isExpired(1.0, 1.1)).toBe(false);
    });

    it('returns false when note hasnt happened yet', () => {
      // expected at 1.0, current at 0.9 — 100ms before
      expect(detector.isExpired(1.0, 0.9)).toBe(false);
    });
  });
});
