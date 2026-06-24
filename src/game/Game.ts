import type { ChartData, GameMode } from '../types';
import { testChart } from './Chart';
import { MIDIManager } from '../midi/MIDIManager';
import { AudioManager } from '../audio/AudioManager';
import { NoteRenderer } from './NoteRenderer';
import { ScoreManager } from './Score';
import { HitDetector } from './HitDetection';

interface HitFeedback {
  time: number; // performance.now() cuando ocurrió
  rating: string;
}

/**
 * Game loop principal.
 * Conecta MIDI input, renderiza notas en Canvas, detecta hits.
 */
export class Game {
  private renderer: NoteRenderer;
  private midi: MIDIManager;
  private audio: AudioManager;
  private score: ScoreManager;
  private hitDetector: HitDetector;
  private mode: GameMode = 'both';

  private chart: ChartData = testChart;
  private gameTime: number = 0;
  private lastFrameTime: number = 0;
  private animFrameId: number = 0;
  private running: boolean = false;
  private midiConnected: boolean = false;

  // Sistema de tracking de notas esperadas (las que están en ventana de hit)
  private expectedNotes: Map<string, { note: number; time: number; duration: number; hit: boolean }[]> = new Map();
  // Notas agrupadas por modo
  private activeNotes: Set<number> = new Set(); // teclas presionadas actualmente
  private hitFeedbacks: HitFeedback[] = [];

  constructor(_canvas: HTMLCanvasElement) {
    this.renderer = new NoteRenderer(_canvas);
    this.midi = new MIDIManager();
    this.audio = new AudioManager();
    this.score = new ScoreManager(0);
    this.hitDetector = new HitDetector();

    this.setupMIDI();
    this.setupResize();
  }

  private setupMIDI(): void {
    this.midi.onNote((note, _velocity) => {
      if (!this.running) return;
      this.activeNotes.add(note);
      this.processHit(note);
    });

    this.midi.onNoteRelease((note) => {
      this.activeNotes.delete(note);
    });
  }

  private setupResize(): void {
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });
  }

  /** Cambiar modo de juego */
  setMode(mode: GameMode): void {
    this.mode = mode;
  }

  getMode(): GameMode {
    return this.mode;
  }

  /** Inicializa todo (MIDI, audio, canvas) */
  async init(): Promise<void> {
    this.midiConnected = await this.midi.init();
    console.log(`MIDI ${this.midiConnected ? 'conectado' : 'no disponible'}`);

    await this.audio.init();

    const totalNotes = this.chart.notes.length + this.chart.chords.length;
    this.score = new ScoreManager(totalNotes);
    this.buildExpectedNotes();
  }

  /** Construye el array de notas esperadas para hit detection */
  private buildExpectedNotes(): void {
    this.expectedNotes.clear();

    const addNote = (note: number, time: number, duration: number) => {
      const key = `${note}`;
      if (!this.expectedNotes.has(key)) {
        this.expectedNotes.set(key, []);
      }
      this.expectedNotes.get(key)!.push({
        note,
        time,
        duration,
        hit: false,
      });
    };

    if (this.mode === 'notes' || this.mode === 'both') {
      for (const n of this.chart.notes) {
        addNote(n.note, n.time, n.duration);
      }
    }
    if (this.mode === 'chords' || this.mode === 'both') {
      for (const c of this.chart.chords) {
        for (const n of c.notes) {
          addNote(n, c.time, c.duration);
        }
      }
    }
  }

  /** Procesa un hit de una tecla MIDI */
  private processHit(note: number): void {
    const key = `${note}`;
    const expectedList = this.expectedNotes.get(key);
    if (!expectedList) return;

    const result = this.hitDetector.detect(note, this.gameTime, expectedList);
    if (result) {
      // Marcar la nota como tocada
      const found = expectedList.find(
        e => e.note === result.note && Math.abs(e.time - result.expectedTime) < 0.01 && !e.hit
      );
      if (found) {
        found.hit = true;
      }

      const evalResult = this.score.evaluate(result.expectedTime, result.actualTime);
      this.hitFeedbacks.push({
        time: performance.now() / 1000,
        rating: evalResult.rating,
      });

      // Feedback visual simple: cambiar color de la nota
      console.log(`🎵 ${evalResult.rating.toUpperCase()} - Nota ${note} (${result.delta.toFixed(0)}ms)`);
    }
  }

  /** Verifica notas que expiraron (se pasaron de la ventana de hit) */
  private checkExpiredNotes(): void {
    for (const [, expectedList] of this.expectedNotes) {
      for (const expected of expectedList) {
        if (expected.hit) continue;
        if (this.hitDetector.isExpired(expected.time, this.gameTime)) {
          expected.hit = true;
          this.score.registerMiss();
          this.hitFeedbacks.push({
            time: performance.now() / 1000,
            rating: 'miss',
          });
          console.log(`❌ MISS - Nota ${expected.note} (no tocada a tiempo)`);
        }
      }
    }
  }

  /** Inicia el juego */
  start(): void {
    if (this.running) return;

    this.gameTime = 0;
    this.score.reset();
    this.buildExpectedNotes();
    this.hitFeedbacks = [];
    this.running = true;
    this.lastFrameTime = performance.now();

    this.audio.resumeContext();
    this.audio.play();

    this.loop();
  }

  /** Pausa */
  pause(): void {
    this.running = false;
    this.audio.pause();
    cancelAnimationFrame(this.animFrameId);
  }

  /** Loop principal */
  private loop = (): void => {
    if (!this.running) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    // Avanzar tiempo del juego
    this.gameTime += delta;

    // Verificar notas expiradas
    this.checkExpiredNotes();

    // Renderizar
    this.renderer.render(
      this.chart,
      this.gameTime,
      this.score.state,
      this.mode,
      this.activeNotes,
      this.hitFeedbacks,
    );

    // Verificar si terminó
    if (this.gameTime >= this.chart.duration + 2) {
      this.running = false;
      this.audio.pause();
      this.showResults();
      return;
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  /** Muestra pantalla de resultados */
  private showResults(): void {
    const s = this.score.state;
    const accuracy = s.totalNotes > 0
      ? (((s.perfects + s.goods) / s.totalNotes) * 100).toFixed(1)
      : '0.0';

    const resultsHTML = `
      <div id="results-overlay">
        <div class="results-card">
          <h1>🎸 Resultados</h1>
          <h2>${this.chart.title} - ${this.chart.artist}</h2>
          <div class="results-stats">
            <div class="stat">
              <span class="stat-value">${s.score}</span>
              <span class="stat-label">Puntaje</span>
            </div>
            <div class="stat perfect">
              <span class="stat-value">${s.perfects}</span>
              <span class="stat-label">Perfectos</span>
            </div>
            <div class="stat good">
              <span class="stat-value">${s.goods}</span>
              <span class="stat-label">Bien</span>
            </div>
            <div class="stat miss">
              <span class="stat-value">${s.misses}</span>
              <span class="stat-label">Fallos</span>
            </div>
            <div class="stat">
              <span class="stat-value">🔥 ${s.maxCombo}</span>
              <span class="stat-label">Máximo combo</span>
            </div>
            <div class="stat">
              <span class="stat-value">${accuracy}%</span>
              <span class="stat-label">Precisión</span>
            </div>
          </div>
          <button id="btn-menu" class="game-btn">Volver al menú</button>
        </div>
      </div>
    `;

    // Insertar overlay de resultados
    const div = document.createElement('div');
    div.innerHTML = resultsHTML;
    document.body.appendChild(div);

    document.getElementById('btn-menu')?.addEventListener('click', () => {
      div.remove();
      this.showMenu();
    });
  }

  /** Pantalla de menú / selector */
  showMenu(): void {
    const midiStatus = this.midiConnected
      ? `✅ ${this.midi.getDeviceName() || 'Teclado MIDI conectado'}`
      : '⚠️ Sin teclado MIDI';

    const menuHTML = `
      <div id="menu-overlay">
        <div class="menu-card">
          <h1>🎸 Acordazos</h1>
          <p class="subtitle">Guitar Hero con teclado MIDI real</p>
          <div class="midi-status">${midiStatus}</div>
          <div class="song-info">
            <span>${this.chart.title}</span>
            <span class="song-artist">${this.chart.artist}</span>
            <span class="song-duration">${this.formatDuration(this.chart.duration)}</span>
          </div>
          <div class="mode-selector">
            <label>Modo de juego:</label>
            <div class="mode-buttons">
              <button class="mode-btn ${this.mode === 'chords' ? 'active' : ''}" data-mode="chords">🎸 Acordes</button>
              <button class="mode-btn ${this.mode === 'notes' ? 'active' : ''}" data-mode="notes">🎵 Notas</button>
              <button class="mode-btn ${this.mode === 'both' ? 'active' : ''}" data-mode="both">🎸🎵 Ambos</button>
            </div>
          </div>
          <button id="btn-start" class="game-btn start-btn">▶ EMPEZAR</button>
          <p class="hint">Conectá tu Yamaha E333 por USB y presioná START</p>
        </div>
      </div>
    `;

    const existing = document.getElementById('menu-overlay');
    existing?.remove();

    const div = document.createElement('div');
    div.innerHTML = menuHTML;
    document.body.appendChild(div);

    // Event listeners
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.setMode(mode);
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('btn-start')?.addEventListener('click', () => {
      div.remove();
      this.start();
    });
  }

  private formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}