import './style.css';
import { Game } from './game/Game';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    document.body.innerHTML = '<h1>Error: No se encontró el canvas</h1>';
    return;
  }

  const game = new Game(canvas);

  // Inicializar MIDI, audio y cargar canciones
  await game.init();

  // Mostrar menú
  game.showMenu();
}

main().catch(console.error);