import './style.css';
import { Game } from './game/Game';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    document.body.innerHTML = '<h1>Error: No se encontró el canvas</h1>';
    return;
  }

  const game = new Game(canvas);
  await game.init();

  // Esperar interacción del usuario para iniciar AudioContext
  document.addEventListener('click', () => {
    game.showMenu();
  }, { once: true });

  // Si hay MIDI conectado, mostrar menú directamente
  setTimeout(() => {
    game.showMenu();
  }, 500);
}

main().catch(console.error);