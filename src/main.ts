import '@fontsource/bungee';
import '@fontsource/bungee-inline';
import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import { Game } from './game/Game';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) {
    document.body.textContent = 'Falta el canvas del juego en index.html.';
    return;
  }

  // Las tipografías se dibujan en el canvas: esperamos a que estén listas
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('20px Bungee'),
        document.fonts.load('700 14px "Archivo Variable"'),
        document.fonts.load('600 14px "Archivo Variable"'),
      ]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch {
    /* seguimos con las de sistema */
  }

  if (new URLSearchParams(location.search).has('debug')) mountDebugLog();

  const game = new Game(canvas, ui);
  if (import.meta.env.DEV) {
    (window as unknown as { __acordazos: unknown }).__acordazos = {
      game,
      noteOn: (n: number, v = 100) => game.midiManager.emitNoteOn(n, v),
      noteOff: (n: number) => game.midiManager.emitNoteOff(n),
    };
  }
  await game.init();
}

/** Log en pantalla para diagnosticar en equipos sin consola a mano (?debug). */
function mountDebugLog() {
  const box = document.createElement('div');
  box.className = 'debug-log';
  document.body.appendChild(box);
  const add = (prefix: string, args: unknown[]) => {
    const line = document.createElement('div');
    line.textContent = prefix + args.map(a => (typeof a === 'object' ? JSON.stringify(a)?.slice(0, 200) : String(a))).join(' ');
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  };
  for (const [k, prefix] of [['log', ''], ['warn', '⚠ '], ['error', '✕ ']] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => { orig(...a); add(prefix, a); };
  }
}

main().catch(e => {
  console.error('Error fatal:', e);
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `No pudo arrancar el juego.\n\n${e?.message ?? e}`;
  document.body.appendChild(pre);
});
