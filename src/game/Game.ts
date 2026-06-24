import type { ChartData, GameMode } from '../types';
import { MIDIManager } from '../midi/MIDIManager';
import { AudioManager } from '../audio/AudioManager';
import { NoteRenderer } from './NoteRenderer';
import { ScoreManager } from './Score';
import { HitDetector } from './HitDetection';
import { SongLoader } from './SongLoader';

interface HitFeedback {
  time: number;
  rating: string;
}

interface SongEntry {
  name: string;
  chart: ChartData;
}

export class Game {
  private renderer: NoteRenderer;
  private midi: MIDIManager;
  private audio: AudioManager;
  private score: ScoreManager;
  private hitDetector: HitDetector;
  private mode: GameMode = 'both';

  private currentSong: string = 'test-song';
  private chart: ChartData | null = null;
  private songs: SongEntry[] = [];

  private gameTime: number = 0;
  private lastFrameTime: number = 0;
  private animFrameId: number = 0;
  private running: boolean = false;
  private midiConnected: boolean = false;

  private expectedNotes: Map<string, { note: number; time: number; duration: number; hit: boolean }[]> = new Map();
  private activeNotes: Set<number> = new Set();
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
    this.midi.onNote((note) => {
      if (!this.running) return;
      this.activeNotes.add(note);
      this.processHit(note);
    });
    this.midi.onNoteRelease((note) => {
      this.activeNotes.delete(note);
    });
  }

  private setupResize(): void {
    window.addEventListener('resize', () => this.renderer.resize());
  }

  setMode(mode: GameMode): void { this.mode = mode; }
  getMode(): GameMode { return this.mode; }

  async init(): Promise<void> {
    this.midiConnected = await this.midi.init();
    await this.audio.init();
    await this.loadSongList();
    // Cargar la primera canción disponible
    if (this.songs.length > 0) {
      await this.selectSong(this.songs[0].name);
    }
  }

  private async loadSongList(): Promise<void> {
    const discovered = await SongLoader.discoverSongs();
    this.songs = discovered.filter(s => s.chart !== null) as SongEntry[];
    console.log(`🎸 ${this.songs.length} canciones disponibles`);
  }

  async selectSong(songName: string): Promise<void> {
    const chart = await SongLoader.loadChart(songName);
    if (!chart) {
      console.warn(`No se pudo cargar: ${songName}`);
      return;
    }
    this.currentSong = songName;
    this.chart = chart;

    // Cargar audio
    const audioUrl = SongLoader.getAudioUrl(songName, chart);
    const loaded = await this.audio.load(audioUrl);
    console.log(`🎵 Audio ${loaded ? 'cargado' : 'no disponible'}: ${audioUrl}`);

    // Resetear score
    const totalNotes = chart.notes.length + chart.chords.length;
    this.score = new ScoreManager(totalNotes);
  }

  private buildExpectedNotes(): void {
    if (!this.chart) return;
    this.expectedNotes.clear();

    const addNote = (note: number, time: number, duration: number) => {
      const key = `${note}`;
      if (!this.expectedNotes.has(key)) {
        this.expectedNotes.set(key, []);
      }
      this.expectedNotes.get(key)!.push({ note, time, duration, hit: false });
    };

    if (this.mode === 'notes' || this.mode === 'both') {
      for (const n of this.chart.notes) addNote(n.note, n.time, n.duration);
    }
    if (this.mode === 'chords' || this.mode === 'both') {
      for (const c of this.chart.chords) {
        for (const n of c.notes) addNote(n, c.time, c.duration);
      }
    }
  }

  private processHit(note: number): void {
    const expectedList = this.expectedNotes.get(`${note}`);
    if (!expectedList) return;

    const result = this.hitDetector.detect(note, this.gameTime, expectedList);
    if (result) {
      const found = expectedList.find(
        e => e.note === result.note && Math.abs(e.time - result.expectedTime) < 0.01 && !e.hit
      );
      if (found) found.hit = true;

      const evalResult = this.score.evaluate(result.expectedTime, result.actualTime);
      this.hitFeedbacks.push({ time: performance.now() / 1000, rating: evalResult.rating });
    }
  }

  private checkExpiredNotes(): void {
    for (const [, expectedList] of this.expectedNotes) {
      for (const expected of expectedList) {
        if (expected.hit) continue;
        if (this.hitDetector.isExpired(expected.time, this.gameTime)) {
          expected.hit = true;
          this.score.registerMiss();
          this.hitFeedbacks.push({ time: performance.now() / 1000, rating: 'miss' });
        }
      }
    }
  }

  start(): void {
    if (!this.chart || this.running) return;
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

  pause(): void {
    this.running = false;
    this.audio.pause();
    cancelAnimationFrame(this.animFrameId);
  }

  private loop = (): void => {
    if (!this.running || !this.chart) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    this.gameTime += delta;

    this.checkExpiredNotes();

    this.renderer.render(
      this.chart, this.gameTime, this.score.state,
      this.mode, this.activeNotes, this.hitFeedbacks,
    );

    if (this.gameTime >= this.chart.duration + 2) {
      this.running = false;
      this.audio.pause();
      this.showResults();
      return;
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private showResults(): void {
    const s = this.score.state;
    const accuracy = s.totalNotes > 0
      ? (((s.perfects + s.goods) / s.totalNotes) * 100).toFixed(1) : '0.0';

    const div = document.createElement('div');
    div.innerHTML = `
      <div id="results-overlay">
        <div class="results-card">
          <h1>🎸 Resultados</h1>
          <h2>${this.chart?.title || ''}</h2>
          <div class="results-stats">
            <div class="stat"><span class="stat-value">${s.score}</span><span class="stat-label">Puntaje</span></div>
            <div class="stat perfect"><span class="stat-value">${s.perfects}</span><span class="stat-label">Perfectos</span></div>
            <div class="stat good"><span class="stat-value">${s.goods}</span><span class="stat-label">Bien</span></div>
            <div class="stat miss"><span class="stat-value">${s.misses}</span><span class="stat-label">Fallos</span></div>
            <div class="stat"><span class="stat-value">🔥 ${s.maxCombo}</span><span class="stat-label">Máximo combo</span></div>
            <div class="stat"><span class="stat-value">${accuracy}%</span><span class="stat-label">Precisión</span></div>
          </div>
          <button id="btn-menu" class="game-btn">Volver al menú</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    document.getElementById('btn-menu')?.addEventListener('click', () => {
      div.remove();
      this.showMenu();
    });
  }

  showMenu(): void {
    const midiStatus = this.midiConnected
      ? `✅ ${this.midi.getDeviceName() || 'Teclado MIDI conectado'}`
      : '⚠️ Sin teclado MIDI';

    const songListHTML = this.songs
      .map(s => `
        <div class="song-entry ${s.name === this.currentSong ? 'active' : ''}"
             data-song="${s.name}">
          <span class="song-title">${s.chart.title}</span>
          <span class="song-meta">${s.chart.artist} · ${this.formatDuration(s.chart.duration)} · 🎸${s.chart.chords.length} 🎵${s.chart.notes.length}</span>
        </div>
      `).join('');

    const div = document.createElement('div');
    div.innerHTML = `
      <div id="menu-overlay">
        <div class="menu-card menu-wide">
          <h1>🎸 Acordazos</h1>
          <p class="subtitle">Guitar Hero con teclado MIDI real</p>
          <div class="midi-status">${midiStatus}</div>
          <div class="song-list">${songListHTML}</div>
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
    document.body.appendChild(div);

    // Song selection
    div.querySelectorAll('.song-entry').forEach(el => {
      el.addEventListener('click', async () => {
        const name = (el as HTMLElement).dataset.song!;
        div.querySelectorAll('.song-entry').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        await this.selectSong(name);
      });
    });

    // Mode buttons
    div.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.setMode(mode);
        div.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
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