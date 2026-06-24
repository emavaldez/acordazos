// Test chart hardcodeado — "Para Elisa" simplificada
// BPM 120, duración ~30 segundos
import type { ChartData } from '../types';

export const testChart: ChartData = {
  title: 'Test Song',
  artist: 'Acordazos Demo',
  bpm: 120,
  duration: 28,
  audioFile: '', // sin audio por ahora
  notes: [
    // Melodía simple (punteo)
    { time: 0, note: 76, duration: 0.25, velocity: 100 },  // E5
    { time: 0.25, note: 76, duration: 0.25, velocity: 100 },
    { time: 0.5, note: 75, duration: 0.125, velocity: 100 }, // D#5
    { time: 0.625, note: 76, duration: 0.125, velocity: 100 },
    { time: 0.75, note: 75, duration: 0.125, velocity: 100 },
    { time: 0.875, note: 76, duration: 0.125, velocity: 100 },
    { time: 1.0, note: 71, duration: 0.25, velocity: 100 }, // B4
    { time: 1.25, note: 74, duration: 0.25, velocity: 100 }, // D5
    { time: 1.5, note: 72, duration: 0.25, velocity: 100 }, // C5
    { time: 1.75, note: 69, duration: 0.5, velocity: 100 }, // A4

    { time: 2.0, note: 76, duration: 0.25, velocity: 100 },
    { time: 2.25, note: 76, duration: 0.25, velocity: 100 },
    { time: 2.5, note: 75, duration: 0.125, velocity: 100 },
    { time: 2.625, note: 76, duration: 0.125, velocity: 100 },
    { time: 2.75, note: 75, duration: 0.125, velocity: 100 },
    { time: 2.875, note: 76, duration: 0.125, velocity: 100 },
    { time: 3.0, note: 71, duration: 0.25, velocity: 100 },
    { time: 3.25, note: 74, duration: 0.25, velocity: 100 },
    { time: 3.5, note: 72, duration: 0.25, velocity: 100 },
    { time: 3.75, note: 71, duration: 0.5, velocity: 100 },

    // Segunda parte
    { time: 4.0, note: 64, duration: 0.5, velocity: 100 }, // E4
    { time: 4.5, note: 67, duration: 0.5, velocity: 100 }, // G4
    { time: 5.0, note: 72, duration: 0.5, velocity: 100 }, // C5
    { time: 5.5, note: 71, duration: 0.5, velocity: 100 }, // B4
    { time: 6.0, note: 69, duration: 1.0, velocity: 100 }, // A4
    { time: 7.0, note: 67, duration: 0.5, velocity: 100 }, // G4
    { time: 7.5, note: 69, duration: 0.5, velocity: 100 }, // A4
    { time: 8.0, note: 71, duration: 0.5, velocity: 100 }, // B4
    { time: 8.5, note: 69, duration: 0.25, velocity: 100 }, // A4
    { time: 8.75, note: 67, duration: 0.25, velocity: 100 }, // G4
    { time: 9.0, note: 72, duration: 1.5, velocity: 100 }, // C5

    // Más melodía
    { time: 10.5, note: 76, duration: 0.25, velocity: 100 },
    { time: 10.75, note: 76, duration: 0.25, velocity: 100 },
    { time: 11.0, note: 75, duration: 0.125, velocity: 100 },
    { time: 11.125, note: 76, duration: 0.125, velocity: 100 },
    { time: 11.25, note: 75, duration: 0.125, velocity: 100 },
    { time: 11.375, note: 76, duration: 0.125, velocity: 100 },
    { time: 11.5, note: 71, duration: 0.25, velocity: 100 },
    { time: 11.75, note: 74, duration: 0.25, velocity: 100 },
    { time: 12.0, note: 72, duration: 0.25, velocity: 100 },
    { time: 12.25, note: 69, duration: 0.5, velocity: 100 },

    { time: 12.75, note: 76, duration: 0.25, velocity: 100 },
    { time: 13.0, note: 76, duration: 0.25, velocity: 100 },
    { time: 13.25, note: 75, duration: 0.125, velocity: 100 },
    { time: 13.375, note: 76, duration: 0.125, velocity: 100 },
    { time: 13.5, note: 75, duration: 0.125, velocity: 100 },
    { time: 13.625, note: 76, duration: 0.125, velocity: 100 },
    { time: 13.75, note: 71, duration: 0.25, velocity: 100 },
    { time: 14.0, note: 74, duration: 0.25, velocity: 100 },
    { time: 14.25, note: 72, duration: 0.25, velocity: 100 },
    { time: 14.5, note: 71, duration: 0.5, velocity: 100 },

    // Final
    { time: 15.0, note: 64, duration: 0.5, velocity: 100 },
    { time: 15.5, note: 67, duration: 0.5, velocity: 100 },
    { time: 16.0, note: 72, duration: 0.5, velocity: 100 },
    { time: 16.5, note: 71, duration: 0.5, velocity: 100 },
    { time: 17.0, note: 69, duration: 0.5, velocity: 100 },
    { time: 17.5, note: 67, duration: 0.5, velocity: 100 },
    { time: 18.0, note: 72, duration: 0.5, velocity: 100 },
    { time: 18.5, note: 71, duration: 0.5, velocity: 100 },
    { time: 19.0, note: 69, duration: 0.75, velocity: 100 },
    { time: 19.75, note: 67, duration: 0.25, velocity: 100 },
    { time: 20.0, note: 64, duration: 1.0, velocity: 100 },

    // Últimos compases
    { time: 21.0, note: 72, duration: 0.25, velocity: 100 },
    { time: 21.25, note: 69, duration: 0.25, velocity: 100 },
    { time: 21.5, note: 71, duration: 0.25, velocity: 100 },
    { time: 21.75, note: 67, duration: 0.25, velocity: 100 },
    { time: 22.0, note: 76, duration: 0.5, velocity: 100 },
    { time: 22.5, note: 75, duration: 0.5, velocity: 100 },
    { time: 23.0, note: 76, duration: 0.5, velocity: 100 },
    { time: 23.5, note: 72, duration: 1.0, velocity: 100 },
    { time: 24.5, note: 69, duration: 1.0, velocity: 100 },
    { time: 25.5, note: 76, duration: 2.0, velocity: 100 },
  ],
  chords: [
    { time: 0, notes: [64, 67, 71], duration: 1.0 },   // Cm (C minor) E4 G4 B4
    { time: 1.0, notes: [69, 72, 76], duration: 1.0 },  // Am (A minor) A4 C5 E5
    { time: 2.0, notes: [64, 67, 71], duration: 1.0 },
    { time: 3.0, notes: [69, 72, 76], duration: 1.0 },
    { time: 4.0, notes: [60, 64, 67], duration: 2.0 },  // C major
    { time: 6.0, notes: [69, 72, 76], duration: 1.0 },  // Am
    { time: 7.0, notes: [67, 71, 74], duration: 1.0 },  // G major
    { time: 8.0, notes: [69, 72, 76], duration: 2.0 },
    { time: 10.0, notes: [64, 67, 71], duration: 1.0 },
    { time: 11.0, notes: [69, 72, 76], duration: 1.0 },
    { time: 12.0, notes: [64, 67, 71], duration: 1.0 },
    { time: 13.0, notes: [69, 72, 76], duration: 1.0 },
    { time: 14.0, notes: [60, 64, 67], duration: 2.0 },
    { time: 16.0, notes: [69, 72, 76], duration: 1.0 },
    { time: 17.0, notes: [67, 71, 74], duration: 1.0 },
    { time: 18.0, notes: [69, 72, 76], duration: 2.0 },
    { time: 20.0, notes: [64, 67, 71], duration: 2.0 },
    { time: 22.0, notes: [69, 72, 76], duration: 1.0 },
    { time: 23.0, notes: [64, 67, 71], duration: 2.0 },
    { time: 25.0, notes: [69, 72, 76], duration: 2.5 },
  ],
};