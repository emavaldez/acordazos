import type { ChartData, GameMode, Difficulty } from '../types';
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
  private difficulty: Difficulty = 'normal';
  private speed: number = 1; // 0.5 = mitad de velocidad, 1 = normal, 2 = doble
  private latencyOffset: number = 0; // ms de compensacion de latencia (positivo = adelantar notas)

  private currentSong: string = '';
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
  setDifficulty(d: Difficulty): void { this.difficulty = d; }
  getDifficulty(): Difficulty { return this.difficulty; }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(3, speed));
    // Cambiar el scroll time en el renderer
    this.renderer.setScrollTime(5 / this.speed);
  }
  getSpeed(): number { return this.speed; }

  setLatencyOffset(ms: number): void {
    this.latencyOffset = Math.max(-500, Math.min(500, ms));
  }
  getLatencyOffset(): number { return this.latencyOffset; }

  async init(): Promise<void> {
    try { this.midiConnected = await this.midi.init(); } catch { this.midiConnected = false; }
    try { await this.audio.init(); } catch { console.warn('AudioContext no disponible'); }
    await this.loadSongList();
    if (this.songs.length > 0) {
      await this.selectSong(this.songs[0].name);
    }
    if (!this.midiConnected) {
      this.showMIDIError();
    }
  }

  private async loadSongList(): Promise<void> {
    const discovered = await SongLoader.discoverSongs();
    this.songs = discovered.filter(s => s.chart !== null) as SongEntry[];
  }

  async selectSong(songName: string): Promise<void> {
    const chart = await SongLoader.loadChart(songName);
    if (!chart) {
      console.warn(`No se pudo cargar: ${songName}`);
      return;
    }
    this.currentSong = songName;
    this.chart = chart;

    const audioUrl = SongLoader.getAudioUrl(songName, chart);
    try { await this.audio.load(audioUrl, chart); } catch { console.warn('Audio load falló'); }

    const totalNotes = this.filterByDifficulty(chart.notes).length + this.filterChordsByDifficulty(chart.chords).length;
    this.score = new ScoreManager(totalNotes);
  }

  private buildExpectedNotes(): void {
    if (!this.chart) return;
    this.expectedNotes.clear();

    // Filtrar por dificultad
    const notes = this.filterByDifficulty(this.chart.notes);
    const chords = this.filterChordsByDifficulty(this.chart.chords);

    const addNote = (note: number, time: number, duration: number) => {
      const key = `${note}`;
      if (!this.expectedNotes.has(key)) {
        this.expectedNotes.set(key, []);
      }
      this.expectedNotes.get(key)!.push({ note, time, duration, hit: false });
    };

    if (this.mode === 'notes' || this.mode === 'both') {
      for (const n of notes) addNote(n.note, n.time, n.duration);
    }
    if (this.mode === 'chords' || this.mode === 'both') {
      for (const c of chords) {
        for (const n of c.notes) addNote(n, c.time, c.duration);
      }
    }
  }

  /** Filtra notas según dificultad */
  private filterByDifficulty(notes: ChartData['notes']): ChartData['notes'] {
    if (!notes.length) return [];
    if (this.difficulty === 'hard') return notes;
    if (this.difficulty === 'normal') {
      // Cada 2da nota
      return notes.filter((_, i) => i % 2 === 0);
    }
    // Easy: cada 4ta nota, filtrando las de menor energía
    return notes.filter((_, i) => i % 4 === 0);
  }

  /** Filtra acordes según dificultad */
  private filterChordsByDifficulty(chords: ChartData['chords']): ChartData['chords'] {
    if (!chords.length) return [];
    if (this.difficulty === 'hard') return chords;
    if (this.difficulty === 'normal') {
      // Cada 2do acorde
      return chords.filter((_, i) => i % 2 === 0);
    }
    // Easy: cada 4to acorde
    return chords.filter((_, i) => i % 4 === 0);
  }

  private processHit(note: number): void {
    const expectedList = this.expectedNotes.get(`${note}`);
    if (!expectedList) return;

    // Aplicar compensacion de latencia: ajustar el tiempo real
    const adjustedTime = this.gameTime + (this.latencyOffset / 1000);
    const result = this.hitDetector.detect(note, adjustedTime, expectedList);
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

  async start(): Promise<void> {
    if (!this.chart || this.running) return;

    // Detener cualquier audio anterior
    this.audio.stop();

    this.gameTime = 0;
    this.score.reset();
    this.buildExpectedNotes();
    this.hitFeedbacks = [];
    this.running = true;
    this.lastFrameTime = performance.now();

    // Iniciar el loop INMEDIATAMENTE — no esperar al audio
    this.loop();

    // Iniciar audio en background — si falla, igual juega
    try {
      await this.audio.init();
      await this.audio.resumeContext();
      await this.audio.play();
    } catch (e) {
      console.warn('Audio no disponible, jugando sin sonido:', e);
    }
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

    // Avanzar tiempo del juego (multiplicado por speed)
    this.gameTime += delta * this.speed;

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

    // Calcular estrellas (1-5)
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
          <h2>${this.chart?.title || ''}</h2>
          <div class="results-stars">${starsHTML}</div>
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

  private showMIDIError(): void {
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
    document.getElementById('btn-continue-no-midi')?.addEventListener('click', () => {
      div.remove();
      this.showMenu();
    });
    document.getElementById('btn-retry-midi')?.addEventListener('click', async () => {
      div.remove();
      try {
        this.midiConnected = await this.midi.init();
      } catch {
        this.midiConnected = false;
      }
      if (this.midiConnected) {
        this.showMenu();
      } else {
        this.showMIDIError();
      }
    });
  }

  showMenu(): void {
    // Limpiar overlays y contenedores anteriores
    document.getElementById('menu-container')?.remove();
    document.getElementById('results-overlay')?.parentElement?.remove();
    document.getElementById('midi-error-overlay')?.parentElement?.remove();

    const midiStatus = this.midiConnected
      ? `✅ ${this.midi.getDeviceName() || 'Teclado MIDI conectado'}`
      : '⚠️ Sin teclado MIDI';

    const audioStatus = this.audio.loaded
      ? `🔊 Audio cargado (${this.formatDuration(this.audio.getDuration())})`
      : '🔇 Sin audio';

    const songListHTML = this.songs.length > 0
      ? this.songs.map(s => `
        <div class="song-entry ${s.name === this.currentSong ? 'active' : ''}"
             data-song="${s.name}">
          <span class="song-title">${s.chart.title}</span>
          <span class="song-meta">${s.chart.artist} · ${this.formatDuration(s.chart.duration)} · 🎸${s.chart.chords.length} 🎵${s.chart.notes.length}</span>
        </div>
      `).join('')
      : '<div class="song-entry disabled">🎵 No hay canciones disponibles.</div>';

    const div = document.createElement('div');
    div.id = 'menu-container';
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
              <button class="mode-btn ${this.mode === 'chords' ? 'active' : ''}" data-mode="chords">🎸 Acordes</button>
              <button class="mode-btn ${this.mode === 'notes' ? 'active' : ''}" data-mode="notes">🎵 Notas</button>
              <button class="mode-btn ${this.mode === 'both' ? 'active' : ''}" data-mode="both">🎸🎵 Ambos</button>
            </div>
          </div>

          <div class="difficulty-control">
            <label>Dificultad:</label>
            <div class="difficulty-buttons">
              <button id="diff-easy" class="diff-btn ${this.difficulty === 'easy' ? 'active' : ''}">🟢 Fácil</button>
              <button id="diff-normal" class="diff-btn ${this.difficulty === 'normal' ? 'active' : ''}">🟡 Normal</button>
              <button id="diff-hard" class="diff-btn ${this.difficulty === 'hard' ? 'active' : ''}">🔴 Difícil</button>
            </div>
          </div>

          <div class="speed-control">
            <label>Velocidad: <span id="speed-label">${this.speed.toFixed(1)}x</span></label>
            <div class="speed-buttons">
              <button id="speed-half" class="speed-btn">0.5x</button>
              <button id="speed-normal" class="speed-btn active">1x</button>
              <button id="speed-double" class="speed-btn">2x</button>
            </div>
          </div>

          <div class="latency-control">
            <label>Latencia: <span id="latency-label">${this.latencyOffset}ms</span></label>
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

    // Song selection
    div.querySelectorAll('.song-entry').forEach(el => {
      el.addEventListener('click', async () => {
        const name = (el as HTMLElement).dataset.song;
        if (!name) return;
        div.querySelectorAll('.song-entry').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        await this.selectSong(name);
        // Actualizar estado del audio en el menú SIN recrear el div
        const audioStatus = div.querySelector('.audio-status');
        if (audioStatus && this.audio.loaded) {
          audioStatus.textContent = `🔊 Audio cargado (${this.formatDuration(this.audio.getDuration())})`;
        }
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

    // Speed buttons
    document.getElementById('speed-half')?.addEventListener('click', () => { this.setSpeed(0.5); div.remove(); this.showMenu(); });
    document.getElementById('speed-normal')?.addEventListener('click', () => { this.setSpeed(1); div.remove(); this.showMenu(); });
    document.getElementById('speed-double')?.addEventListener('click', () => { this.setSpeed(2); div.remove(); this.showMenu(); });

    // Latency buttons
    const updateLatencyLabel = () => {
      const label = document.getElementById('latency-label');
      if (label) label.textContent = `${this.latencyOffset}ms`;
    };
    document.getElementById('latency-down')?.addEventListener('click', () => { this.setLatencyOffset(this.latencyOffset - 50); updateLatencyLabel(); });
    document.getElementById('latency-reset')?.addEventListener('click', () => { this.setLatencyOffset(0); updateLatencyLabel(); });
    document.getElementById('latency-up')?.addEventListener('click', () => { this.setLatencyOffset(this.latencyOffset + 50); updateLatencyLabel(); });

    // Difficulty buttons
    const setDiff = (d: Difficulty) => {
      this.setDifficulty(d);
      div.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`diff-${d}`)?.classList.add('active');
      // Recalcular score con la nueva dificultad
      if (this.chart) {
        const totalNotes = this.filterByDifficulty(this.chart.notes).length + this.filterChordsByDifficulty(this.chart.chords).length;
        this.score = new ScoreManager(totalNotes);
      }
    };
    document.getElementById('diff-easy')?.addEventListener('click', () => setDiff('easy'));
    document.getElementById('diff-normal')?.addEventListener('click', () => setDiff('normal'));
    document.getElementById('diff-hard')?.addEventListener('click', () => setDiff('hard'));

    // Start button
    document.getElementById('btn-start')?.addEventListener('click', () => {
      document.getElementById('menu-container')?.remove();
      this.start().catch(e => {
        console.error('Error al iniciar:', e);
        this.showMenu();
      });
    });
  }

  private formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}