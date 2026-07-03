import './style.css';
import { Game } from './game/Game';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    document.body.innerHTML = '<h1>Error: No se encontró el canvas</h1>';
    return;
  }

  const game = new Game(canvas);

  // Log visible en pantalla para debug
  const debugLog = document.createElement('div');
  debugLog.id = 'debug-log';
  debugLog.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.8);color:#0f0;font:11px monospace;padding:4px 8px;z-index:9999;max-height:120px;overflow:auto;pointer-events:none;';
  document.body.appendChild(debugLog);

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const addLog = (msg: string) => {
    debugLog.innerHTML += msg + '<br>';
    debugLog.scrollTop = debugLog.scrollHeight;
  };
  console.log = (...a: any[]) => { origLog(...a); addLog(a.map(x => typeof x === 'object' ? JSON.stringify(x).substring(0, 200) : String(x)).join(' ')); };
  console.error = (...a: any[]) => { origErr(...a); addLog('❌ ' + a.map(x => String(x)).join(' ')); };
  console.warn = (...a: any[]) => { origWarn(...a); addLog('⚠️ ' + a.map(x => String(x)).join(' ')); };

  console.log('Iniciando Acordazos...');

  // Inicializar MIDI, audio y cargar canciones
  await game.init();
  console.log('Init completo, mostrando menú');

  // Mostrar menú
  game.showMenu();
}

main().catch(e => {
  console.error('Error fatal:', e);
  document.body.innerHTML = '<h1 style="color:red">Error: ' + e.message + '</h1><pre>' + e.stack + '</pre>';
});
