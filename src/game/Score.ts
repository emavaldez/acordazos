import type { GameState } from '../types';

export class ScoreManager {
  public state: GameState;

  private perfectWindow: number = 80; // ms
  private goodWindow: number = 180; // ms
  private perfectPoints: number = 100;
  private goodPoints: number = 50;

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

  /** Evalúa si el tiempo real está dentro de la ventana de acierto */
  evaluate(expectedTime: number, actualTime: number): { rating: 'perfect' | 'good' | 'miss'; points: number } {
    const delta = Math.abs(actualTime - expectedTime) * 1000; // convertir a ms

    if (delta <= this.perfectWindow) {
      this.state.combo++;
      if (this.state.combo > this.state.maxCombo) {
        this.state.maxCombo = this.state.combo;
      }
      this.state.perfects++;
      this.state.score += this.perfectPoints;
      return { rating: 'perfect', points: this.perfectPoints };
    }

    if (delta <= this.goodWindow) {
      this.state.combo++;
      if (this.state.combo > this.state.maxCombo) {
        this.state.maxCombo = this.state.combo;
      }
      this.state.goods++;
      this.state.score += this.goodPoints;
      return { rating: 'good', points: this.goodPoints };
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

  reset(): void {
    this.state.score = 0;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.perfects = 0;
    this.state.goods = 0;
    this.state.misses = 0;
  }
}