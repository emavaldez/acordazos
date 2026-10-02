import type { Difficulty, GameState } from '../types';

/** Ventanas de acierto (ms) por dificultad. */
export const HIT_WINDOWS: Record<Difficulty, { perfect: number; good: number }> = {
  easy: { perfect: 100, good: 220 },
  normal: { perfect: 80, good: 180 },
  hard: { perfect: 60, good: 140 },
};

/** Puntos por segundo de nota larga sostenida (antes del multiplicador). */
const SUSTAIN_POINTS_PER_SEC = 100;

export class ScoreManager {
  public state: GameState;

  private perfectWindow: number = 80; // ms
  private goodWindow: number = 180; // ms
  private perfectPoints: number = 100;
  private goodPoints: number = 50;

  /** Segundos sostenidos vs. segundos posibles de notas largas */
  sustainHeld = 0;
  sustainTotal = 0;
  private sustainCarry = 0;

  /** Tendencia de tiempo: suma de desvíos con signo (ms). Positivo = tarde. */
  private timingSum = 0;
  private timingCount = 0;

  constructor(totalNotes: number) {
    this.state = {
      status: 'menu',
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfects: 0,
      goods: 0,
      misses: 0,
      totalNotes,
    };
  }

  setWindows(perfectMs: number, goodMs: number): void {
    this.perfectWindow = perfectMs;
    this.goodWindow = goodMs;
  }

  /** x1 a x4: sube cada 10 aciertos seguidos */
  get multiplier(): number {
    return Math.min(4, 1 + Math.floor(this.state.combo / 10));
  }

  /** Promedio de desvío en ms (positivo = tocás tarde). null si hay pocos datos. */
  get timingBias(): number | null {
    return this.timingCount >= 8 ? this.timingSum / this.timingCount : null;
  }

  /** Evalúa si el tiempo real está dentro de la ventana de acierto */
  evaluate(expectedTime: number, actualTime: number): { rating: 'perfect' | 'good' | 'miss'; points: number } {
    const signed = (actualTime - expectedTime) * 1000;
    const delta = Math.abs(signed); // ms

    if (delta <= this.goodWindow) {
      this.state.combo++;
      if (this.state.combo > this.state.maxCombo) this.state.maxCombo = this.state.combo;
      this.timingSum += signed;
      this.timingCount++;

      const perfect = delta <= this.perfectWindow;
      const base = perfect ? this.perfectPoints : this.goodPoints;
      const points = base * this.multiplier;
      if (perfect) this.state.perfects++;
      else this.state.goods++;
      this.state.score += points;
      return { rating: perfect ? 'perfect' : 'good', points };
    }

    // Miss
    this.state.combo = 0;
    this.state.misses++;
    return { rating: 'miss', points: 0 };
  }

  /** Marca una nota como no tocada (miss por timeout) */
  registerMiss(): void {
    this.state.combo = 0;
    this.state.misses++;
  }

  /** Suma puntos por mantener una nota larga durante `seconds` (de canción). */
  addSustain(seconds: number): number {
    if (seconds <= 0) return 0;
    this.sustainHeld += seconds;
    this.sustainCarry += seconds * SUSTAIN_POINTS_PER_SEC * this.multiplier;
    const whole = Math.floor(this.sustainCarry);
    this.sustainCarry -= whole;
    this.state.score += whole;
    return whole;
  }

  reset(): void {
    this.state.score = 0;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.perfects = 0;
    this.state.goods = 0;
    this.state.misses = 0;
    this.sustainHeld = 0;
    this.sustainCarry = 0;
    this.timingSum = 0;
    this.timingCount = 0;
  }
}
