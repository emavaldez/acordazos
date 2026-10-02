// Geometría del teclado en pantalla. Puede mostrar las 61 teclas o solo
// la porción que usa el tema (teclas y píldoras más grandes).

import { isBlack, KEYBOARD_MAX, KEYBOARD_MIN } from '../music/notes';

export interface KeyRect {
  note: number;
  x: number;
  w: number;
  isBlack: boolean;
}

const pc = (n: number) => ((n % 12) + 12) % 12;

/**
 * Calcula el rango visible. Arranca en Do o Fa y termina en Mi o Si para que
 * se lea como un pedazo real de teclado, con un mínimo de teclas blancas.
 */
export function fitRange(lowest: number, highest: number, full: boolean, minWhite = 15): [number, number] {
  if (full) return [KEYBOARD_MIN, KEYBOARD_MAX];

  let lo = Math.max(KEYBOARD_MIN, Math.min(lowest, highest) - 2);
  let hi = Math.min(KEYBOARD_MAX, Math.max(lowest, highest) + 2);

  while (lo > KEYBOARD_MIN && pc(lo) !== 0 && pc(lo) !== 5) lo--;
  while (hi < KEYBOARD_MAX && pc(hi) !== 11 && pc(hi) !== 4) hi++;

  const whites = () => {
    let c = 0;
    for (let n = lo; n <= hi; n++) if (!isBlack(n)) c++;
    return c;
  };

  let growUp = true;
  let guard = 0;
  while (whites() < minWhite && guard++ < 100) {
    const canUp = hi < KEYBOARD_MAX;
    const canDown = lo > KEYBOARD_MIN;
    if (!canUp && !canDown) break;
    if ((growUp && canUp) || !canDown) {
      hi++;
      while (hi < KEYBOARD_MAX && pc(hi) !== 11 && pc(hi) !== 4) hi++;
    } else {
      lo--;
      while (lo > KEYBOARD_MIN && pc(lo) !== 0 && pc(lo) !== 5) lo--;
    }
    growUp = !growUp;
  }
  return [lo, hi];
}

export class KeyboardLayout {
  readonly low: number;
  readonly high: number;
  readonly width: number;
  readonly whiteW: number;
  readonly blackW: number;
  readonly keys: KeyRect[] = [];
  private byNote = new Map<number, KeyRect>();

  constructor(low: number, high: number, width: number) {
    this.low = low;
    this.high = high;
    this.width = width;

    let whiteCount = 0;
    for (let n = low; n <= high; n++) if (!isBlack(n)) whiteCount++;
    this.whiteW = width / Math.max(1, whiteCount);
    this.blackW = this.whiteW * 0.6;

    let whiteIndex = 0;
    for (let n = low; n <= high; n++) {
      let rect: KeyRect;
      if (isBlack(n)) {
        const boundary = whiteIndex * this.whiteW;
        rect = { note: n, x: boundary - this.blackW / 2, w: this.blackW, isBlack: true };
      } else {
        rect = { note: n, x: whiteIndex * this.whiteW, w: this.whiteW, isBlack: false };
        whiteIndex++;
      }
      this.keys.push(rect);
      this.byNote.set(n, rect);
    }
  }

  get(note: number): KeyRect | undefined {
    return this.byNote.get(note);
  }

  contains(note: number): boolean {
    return note >= this.low && note <= this.high;
  }
}
