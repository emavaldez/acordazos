// Paleta "Neón de bailanta": noche violeta, LED fucsia y cian, bombitas ámbar.
// Los mismos valores viven como variables CSS en style.css.

import type { Part } from './types';

export const theme = {
  night: '#140827',
  nightDeep: '#0c0418',
  lane: 'rgba(10, 4, 22, 0.78)',
  ink: '#f7eeff',
  inkMuted: '#a592c2',
  amber: '#ffc23a',
  amberHot: '#fff1c4',
  lilac: '#b9a2ff',
  missRed: '#ff5d5d',
  missGray: '#3d3150',
  ledDot: '#d8c8ff',
  part: {
    melody: { white: '#2ee6ff', black: '#1594b4', light: '#b8f6ff', glow: '46, 230, 255' },
    chords: { white: '#ff3fa0', black: '#b1226e', light: '#ffc0df', glow: '255, 63, 160' },
  } satisfies Record<Part, { white: string; black: string; light: string; glow: string }>,
  font: {
    display: 'Bungee, "Arial Black", sans-serif',
    ui: '"Archivo Variable", Archivo, "Helvetica Neue", Arial, sans-serif',
  },
} as const;

export const partLabel: Record<Part, string> = {
  melody: 'Melodía',
  chords: 'Acordes',
};
