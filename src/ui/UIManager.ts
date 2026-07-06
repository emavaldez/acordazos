// UIManager — Handles all HTML overlay UI (menu, results, MIDI error)
// Extracted from Game.ts to separate game logic from UI rendering.

import type { GameMode, Difficulty, GameState } from '../types';
import type { ChartData } from '../types';

export interface SongEntry {
  name: string;
  chart: ChartData;
}

export interface UICallbacks {
  onSelectSong: (name: string) => Promise<void>;
  onSetMode: (mode: GameMode) => void;
  onSetDifficulty: (d: Difficulty) => void;
  onSetSpeed: (speed: number) => void;
  onSetLatency: (ms: number) => void;
  onStart: () => void;
  onRetryMIDI: () => Promise<void>;
  onBackToMenu: () => void;
}

export class UIManager {
  private callbacks: UICallbacks;
  private currentOverlay: HTMLElement | null = null;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;
  }

  removeOverlay(): void {
    if (this.currentOverlay) {
      this.currentOverlay.remove();
      this.currentOverlay = null;
    }
  }

  showMIDIError(): void {
    this.removeOverlay();
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="midi-error-overlay">
        <div class="midi-error-card">
          <h1>⚠️ Sin teclado MIDI</h1>
          <p>No se detectó un teclado MIDI conectado.</p>
          <p class="midi-error-help">Conectá tu teclado MIDI y recargá la página.</p>
          <p class="midi-error-help">Si ya lo conectaste, abrí la consola del navegador (F12) para ver si hay errores.</p>
          <p class="midi-error-note">Podés igual jugar con el teclado de la computadora como fallback.</p>
          <button id="btn-continue-no-midi" class="game-btn">Jugar sin MIDI</button>
          <button id="btn-retry-midi" class="game-btn">Reintentar</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    this.currentOverlay = div;

    document.getElementById('btn-continue-no-midi')?.addEventListener('click', () => {
      this.removeOverlay();
      // Show menu will be called by the game
    });
    document.getElementById('btn-retry-midi')?.addEventListener('click', async () => {
      this.removeOverlay();
      await this.callbacks.onRetryMIDI();
    });
  }

  showMenu(opts: {
    midiConnected: boolean;
    midiDeviceName: string;
    audioLoaded: boolean;
    audioDuration: string;
    songs: SongEntry[];
    currentSong: string;
    mode: GameMode;
    difficulty: Difficulty;
    speed: number;
    latencyOffset: number;
  }): void {
    this.removeOverlay();

    const midiStatus = opts.midiConnected
      ? `✅ ${opts.midiDeviceName || 'Teclado MIDI conectado'}`
      : '⚠️ Sin teclado MIDI';

    const audioStatus = opts.audioLoaded
      ? `🔊 Audio cargado (${opts.audioDuration})`
      : '🔇 Sin audio';

    const songListHTML = opts.songs.length > 0
      ? opts.songs.map(s => `
        <div class="song-entry ${s.name === opts.currentSong ? 'active' : ''}"
             data-song="${s.name}">
          <span class="song-title">${s.chart.title}</span>
          <span class="song-meta">${s.chart.artist} · ${this.formatDuration(s.chart.duration)} · 🎸${s.chart.chords.length} 🎵${s.chart.notes.length}</span>
        </div>
      `).join('')
      : '<div class="song-entry disabled">🎵 No hay canciones. Prepará una con YouTube abajo.</div>';

    const div = document.createElement('div');
    div.innerHTML = `
      <div id="menu-overlay">
        <div class="menu-card">
          <h1>🎸 Acordazos</h1>
          <p class="subtitle">Guitar Hero con teclado MIDI real</p>
          <div class="midi-status">${midiStatus}</div>
          <div class="midi-status audio-status">${audioStatus}</div>

          <label class="section-label">CANCIONES</label>
          <div class="song-list">${songListHTML}</div>

          <div class="mode-selector">
            <label>Modo:</label>
            <div class="mode-buttons">
              <button class="mode-btn ${opts.mode === 'chords' ? 'active' : ''}" data-mode="chords">🎸 Acordes</button>
              <button class="mode-btn ${opts.mode === 'notes' ? 'active' : ''}" data-mode="notes">🎵 Notas</button>
              <button class="mode-btn ${opts.mode === 'both' ? 'active' : ''}" data-mode="both">🎸🎵 Ambos</button>
            </div>
          </div>

          <div class="difficulty-control">
            <label>Dificultad:</label>
            <div class="difficulty-buttons">
              <button id="diff-easy" class="diff-btn ${opts.difficulty === 'easy' ? 'active' : ''}">🟢 Fácil</button>
              <button id="diff-normal" class="diff-btn ${opts.difficulty === 'normal' ? 'active' : ''}">🟡 Normal</button>
              <button id="diff-hard" class="diff-btn ${opts.difficulty === 'hard' ? 'active' : ''}">🔴 Difícil</button>
            </div>
          </div>

          <div class="speed-control">
            <label>Velocidad: <span id="speed-label">${opts.speed.toFixed(1)}x</span></label>
            <div class="speed-buttons">
              <button id="speed-half" class="speed-btn">0.5x</button>
              <button id="speed-normal" class="speed-btn active">1x</button>
              <button id="speed-double" class="speed-btn">2x</button>
            </div>
          </div>

          <div class="latency-control">
            <label>Latencia: <span id="latency-label">${opts.latencyOffset}ms</span></label>
            <div class="latency-buttons">
              <button id="latency-down" class="latency-btn">-50ms</button>
              <button id="latency-reset" class="latency-btn">0ms</button>
              <button id="latency-up" class="latency-btn">+50ms</button>
            </div>
            <small class="latency-help">Negativo = notas llegan antes · Positivo = notas llegan después</small>
          </div>

          <button id="btn-start" class="game-btn start-btn">▶ EMPEZAR</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    this.currentOverlay = div;

    // Song selection
    div.querySelectorAll('.song-entry').forEach(el => {
      el.addEventListener('click', async () => {
        const name = (el as HTMLElement).dataset.song;
        if (!name) return;
        await this.callbacks.onSelectSong(name);
      });
    });

    // Mode buttons
    div.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.callbacks.onSetMode(mode);
        div.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Speed buttons
    document.getElementById('speed-half')?.addEventListener('click', () => this.callbacks.onSetSpeed(0.5));
    document.getElementById('speed-normal')?.addEventListener('click', () => this.callbacks.onSetSpeed(1));
    document.getElementById('speed-double')?.addEventListener('click', () => this.callbacks.onSetSpeed(2));

    // Latency buttons
    let currentLatency = opts.latencyOffset;
    const updateLatencyLabel = () => {
      const label = document.getElementById('latency-label');
      if (label) label.textContent = `${currentLatency}ms`;
    };
    document.getElementById('latency-down')?.addEventListener('click', () => { currentLatency -= 50; this.callbacks.onSetLatency(currentLatency); updateLatencyLabel(); });
    document.getElementById('latency-reset')?.addEventListener('click', () => { currentLatency = 0; this.callbacks.onSetLatency(0); updateLatencyLabel(); });
    document.getElementById('latency-up')?.addEventListener('click', () => { currentLatency += 50; this.callbacks.onSetLatency(currentLatency); updateLatencyLabel(); });

    // Difficulty buttons
    const setDiff = (d: Difficulty) => {
      this.callbacks.onSetDifficulty(d);
      div.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`diff-${d}`)?.classList.add('active');
    };
    document.getElementById('diff-easy')?.addEventListener('click', () => setDiff('easy'));
    document.getElementById('diff-normal')?.addEventListener('click', () => setDiff('normal'));
    document.getElementById('diff-hard')?.addEventListener('click', () => setDiff('hard'));

    // Start button
    document.getElementById('btn-start')?.addEventListener('click', () => {
      this.removeOverlay();
      this.callbacks.onStart();
    });
  }

  showResults(state: GameState, chartTitle: string): void {
    this.removeOverlay();

    const accuracy = state.totalNotes > 0
      ? (((state.perfects + state.goods) / state.totalNotes) * 100).toFixed(1) : '0.0';

    const pct = parseFloat(accuracy);
    const stars = pct >= 95 ? 5 : pct >= 80 ? 4 : pct >= 65 ? 3 : pct >= 40 ? 2 : 1;
    const starsHTML = Array.from({ length: 5 }, (_, i) =>
      `<span class="${i < stars ? 'star-on' : 'star-off'}">★</span>`
    ).join('');
    const ratingLabel = stars >= 4 ? '🎸 INCREÍBLE!' : stars >= 3 ? '👍 BIEN!' : stars >= 2 ? '💪 OK' : '😅 PRACTICÁ MÁS';

    const div = document.createElement('div');
    div.innerHTML = `
      <div id="results-overlay">
        <div class="results-card">
          <h1>🎸 ${ratingLabel}</h1>
          <h2>${chartTitle}</h2>
          <div class="results-stars">${starsHTML}</div>
          <div class="results-stats">
            <div class="stat"><span class="stat-value">${state.score}</span><span class="stat-label">Puntaje</span></div>
            <div class="stat perfect"><span class="stat-value">${state.perfects}</span><span class="stat-label">Perfectos</span></div>
            <div class="stat good"><span class="stat-value">${state.goods}</span><span class="stat-label">Bien</span></div>
            <div class="stat miss"><span class="stat-value">${state.misses}</span><span class="stat-label">Fallos</span></div>
            <div class="stat"><span class="stat-value">🔥 ${state.maxCombo}</span><span class="stat-label">Máximo combo</span></div>
            <div class="stat"><span class="stat-value">${accuracy}%</span><span class="stat-label">Precisión</span></div>
          </div>
          <button id="btn-menu" class="game-btn">Volver al menú</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    this.currentOverlay = div;

    document.getElementById('btn-menu')?.addEventListener('click', () => {
      this.removeOverlay();
      this.callbacks.onBackToMenu();
    });
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
