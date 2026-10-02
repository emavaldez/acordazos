// Utilidades musicales: nombres de notas, teclas negras, rango del teclado.

/** Yamaha E333: 61 teclas, C2 (36) a C7 (96). */
export const KEYBOARD_MIN = 36;
export const KEYBOARD_MAX = 96;
export const MIDDLE_C = 60;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export function isBlack(note: number): boolean {
  return BLACK_PCS.has(((note % 12) + 12) % 12);
}

export type NoteNaming = 'solfege' | 'letters' | 'none';

const SOLFEGE = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(note: number, naming: NoteNaming): string {
  if (naming === 'none') return '';
  const pc = ((note % 12) + 12) % 12;
  return naming === 'solfege' ? SOLFEGE[pc] : LETTERS[pc];
}

/** Lleva una nota al rango del teclado moviéndola por octavas. */
export function foldIntoRange(note: number, min = KEYBOARD_MIN, max = KEYBOARD_MAX): number {
  let n = note;
  while (n < min) n += 12;
  while (n > max) n -= 12;
  return n;
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
