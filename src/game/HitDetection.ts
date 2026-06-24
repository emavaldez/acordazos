import type { HitResult } from '../types';

/**
 * Maneja la detección de hits estilo Guitar Hero.
 * Ventana de tolerancia configurable.
 */
export class HitDetector {
  /** Ventana total ± en ms para considerar un hit */
  private perfectWindow: number;
  private goodWindow: number;

  constructor(perfectWindow = 80, goodWindow = 180) {
    this.perfectWindow = perfectWindow;
    this.goodWindow = goodWindow;
  }

  /**
   * Dada una nota MIDI tocada en tiempo `actualTime`,
   * busca en el array de eventos activos si hay match.
   * Retorna el mejor hit encontrado o null.
   */
  detect(
    note: number,
    actualTime: number,
    expectedNotes: { note: number; time: number; duration: number; hit: boolean }[]
  ): HitResult | null {
    let best: HitResult | null = null;
    let bestDelta = Infinity;

    for (const expected of expectedNotes) {
      if (expected.hit) continue;
      if (expected.note !== note) continue;

      const delta = Math.abs(actualTime - expected.time) * 1000; // ms

      if (delta <= this.goodWindow && delta < bestDelta) {
        bestDelta = delta;
        let rating: 'perfect' | 'good' | 'miss';
        if (delta <= this.perfectWindow) {
          rating = 'perfect';
        } else {
          rating = 'good';
        }
        best = {
          rating,
          delta,
          note: expected.note,
          expectedTime: expected.time,
          actualTime,
        };
      }
    }

    return best;
  }

  /**
   * Verifica si una nota esperada ya pasó la ventana de tolerancia
   * (debe marcarse como miss)
   */
  isExpired(expectedTime: number, currentTime: number): boolean {
    return (currentTime - expectedTime) * 1000 > this.goodWindow;
  }
}