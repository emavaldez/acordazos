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

  async init(): Promise<void> {
    this.midiConnected = await this.midi.init();
    await this.audio.init();
    await this.loadSongList();
    if (this.songs.length > 0) {
      await this.selectSong(this.songs[0].name);
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
    await this.audio.load(audioUrl);

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

  async start(): Promise<void> {
    if (!this.chart || this.running) return;

    this.gameTime = 0;
    this.score.reset();
    this.buildExpectedNotes();
    this.hitFeedbacks = [];
    this.running = true;
    this.lastFrameTime = performance.now();

    // Iniciar audio (necesita gesto del usuario)
    await this.audio.resumeContext();
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

          <button id="btn-start" class="game-btn start-btn">▶ EMPEZAR</button>

          <div class="youtube-section">
            <label class="section-label">🎬 PREPARAR DESDE YOUTUBE</label>
            <div class="youtube-row">
              <input type="text" id="yt-url" class="yt-input" placeholder="https://youtube.com/watch?v=..." />
              <button id="btn-yt-prepare" class="yt-btn">Preparar</button>
            </div>
            <div id="yt-status" class="yt-status"></div>
          </div>
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
        this.showMenu();
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
      div.remove();
      this.start();
    });

    // YouTube URL
    document.getElementById('btn-yt-prepare')?.addEventListener('click', async () => {
      const input = document.getElementById('yt-url') as HTMLInputElement;
      const status = document.getElementById('yt-status');
      if (!input || !status) return;
      const url = input.value.trim();
      if (!url) { status.textContent = '⚠️ Ingresá una URL de YouTube'; return; }

      const name = url.includes('v=') ? url.split('v=')[1].split('&')[0] : 'song';
      const apiUrl = 'http://157.151.235.227/api/prepare';

      status.textContent = '⏳ Descargando y analizando en el servidor (puede tardar varios minutos)...';
      status.className = 'yt-status loading';

      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const result = await resp.json();
        if (result.success) {
          status.textContent = `✅ ${result.song} preparada! Redirigiendo...`;
          status.className = 'yt-status success';
          // Esperar unos segundos y redirigir a la VM para jugar
          setTimeout(() => {
            window.location.href = 'http://157.151.235.227';
          }, 1500);
        } else {
          status.textContent = `❌ Error: ${result.error}`;
          status.className = 'yt-status error';
        }
      } catch (e: any) {
        status.innerHTML = `
          ⚡ No se pudo conectar al servidor. Corré en la terminal:<br>
          <code style="background:#0a0a1a;padding:6px 10px;border-radius:4px;display:inline-block;margin-top:6px;font-size:12px;">
          npm run prepare-song "${url}" -- --name "${name}"
          </code><br>
          <span style="font-size:11px;color:#888;">Después andá a http://157.151.235.227 y recargá</span>
        `;
        status.className = 'yt-status';
      }
    });
  }

  private formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}