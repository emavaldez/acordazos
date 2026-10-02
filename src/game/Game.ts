import type { ChartData, Part, SongMeta } from '../types';
import { MIDIManager, type MIDIStatus } from '../midi/MIDIManager';
import { AudioManager } from '../audio/AudioManager';
import { NoteRenderer, type LiveNote, type Frame } from './NoteRenderer';
import { ScoreManager, HIT_WINDOWS } from './Score';
import { SongLoader } from './SongLoader';
import { buildArrangement, type Arrangement } from './Arrangement';
import { fitRange } from './KeyboardLayout';
import { UIManager } from '../ui/UIManager';
import { FALL_SECONDS, getRecord, loadSettings, saveSettings, submitRecord, type Settings } from '../ui/Settings';
import { theme } from '../theme';

type Phase = 'menu' | 'playing' | 'paused' | 'resuming' | 'results';

const COUNT_IN_BEATS = 4;
/** Notas tocadas a la vez dentro de este margen forman un mismo "golpe" (modo práctica). */
const GROUP_EPS = 0.03;

export class Game {
  private renderer: NoteRenderer;
  private midi = new MIDIManager();
  private audio = new AudioManager();
  private ui: UIManager;
  private settings: Settings = loadSettings();

  private songs: SongMeta[] = [];
  private songName: string | null = null;
  private meta: SongMeta | null = null;
  private chart: ChartData | null = null;
  private arrangement: Arrangement | null = null;

  private phase: Phase = 'menu';
  private songTime = 0;
  private tempo = 1;
  private lastFrame = 0;
  private rafId = 0;
  private resumeAt = 0;

  private notes: LiveNote[] = [];
  private cursor = 0; // primer índice que puede seguir pendiente
  private score = new ScoreManager(0);
  private pressed = new Map<number, Part | null>();
  private midiStatus: MIDIStatus | null = null;

  // Modo práctica
  private waitingFor = 0; // segundos esperando
  private waits = 0;
  private realPlaySeconds = 0;
  private lastMultiplier = 1;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new NoteRenderer(canvas);
    this.ui = new UIManager(uiRoot, {
      selectSong: name => void this.selectSong(name),
      changeSettings: patch => this.changeSettings(patch),
      start: () => void this.start(),
      retryMIDI: () => void this.initMIDI(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      restart: () => void this.restart(),
      quit: () => this.quit(),
      tempoStep: d => this.setTempo(this.tempo + d),
    });

    this.midi.onNote((n, v) => this.onNoteOn(n, v));
    this.midi.onNoteRelease(n => this.onNoteOff(n));
    this.midi.onStatus(s => this.onMIDIStatus(s));

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.phase !== 'menu') this.drawFrame();
    });
    window.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'playing') this.pause();
    });

    this.ui.syncSettings(this.settings);
    this.renderer.setFallTime(FALL_SECONDS[this.settings.fallSpeed]);
    this.audio.setVolume(this.settings.volume);
  }

  async init(): Promise<void> {
    this.ui.setMIDI(null);
    void this.initMIDI();
    this.songs = await SongLoader.listSongs();
    this.ui.setSongs(this.songs);
    const first = this.songs.find(s => s.name === this.settings.lastSong) ?? this.songs[0];
    if (first) await this.selectSong(first.name);
    this.ui.showMenu();
  }

  private async initMIDI(): Promise<void> {
    this.onMIDIStatus(await this.midi.init());
  }

  private onMIDIStatus(s: MIDIStatus): void {
    const first = this.midiStatus === null;
    const before = this.midiStatus?.devices ?? [];
    this.midiStatus = s;
    this.ui.setMIDI(s);
    if (first) return;
    if (before.length && !s.devices.length) this.ui.toast('Se desconectó el teclado');
    else if (!before.length && s.devices.length) this.ui.toast(`${s.devices[0]} conectado`);
  }

  // ─── Menú ───────────────────────────────────────────────────────────
  private async selectSong(name: string): Promise<void> {
    const meta = this.songs.find(s => s.name === name) ?? null;
    this.songName = name;
    this.meta = meta;
    this.ui.setSelected(name);
    this.ui.setDetail(meta, null, null);
    const chart = await SongLoader.loadChart(name);
    if (this.songName !== name) return; // eligieron otro mientras cargaba
    this.chart = chart;
    this.settings.lastSong = name;
    saveSettings(this.settings);
    this.refreshDetail();
  }

  private refreshDetail(): void {
    if (!this.chart || !this.songName) return;
    this.arrangement = buildArrangement(this.chart, { mode: this.settings.mode, difficulty: this.settings.difficulty });
    const record = getRecord(this.songName, this.settings.mode, this.settings.difficulty);
    this.ui.setDetail(this.meta, this.arrangement, record);
  }

  private changeSettings(patch: Partial<Settings>): void {
    const prev = this.settings;
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.ui.syncSettings(this.settings);

    if (patch.fallSpeed) this.renderer.setFallTime(FALL_SECONDS[this.settings.fallSpeed]);
    if (patch.volume !== undefined) this.audio.setVolume(this.settings.volume);
    if (patch.tempo !== undefined && this.phase === 'menu') this.tempo = this.settings.tempo;
    if (patch.keyboard && this.arrangement && this.phase !== 'menu') this.applyKeyboardRange(this.arrangement);
    if ((patch.mode && patch.mode !== prev.mode) || (patch.difficulty && patch.difficulty !== prev.difficulty)) this.refreshDetail();
  }

  // ─── Partida ────────────────────────────────────────────────────────
  private applyKeyboardRange(arr: Arrangement): void {
    const [lo, hi] = fitRange(arr.lowest, arr.highest, this.settings.keyboard === 'full');
    this.renderer.setRange(lo, hi);
    this.ui.setKeyboardRange(lo, hi);
  }

  private async start(): Promise<void> {
    if (!this.chart || !this.songName) return;
    await this.audio.ensure();
    const arr = buildArrangement(this.chart, { mode: this.settings.mode, difficulty: this.settings.difficulty });
    if (!arr.notes.length) {
      this.ui.toast('Este tema no tiene notas para ese modo.');
      return;
    }
    this.arrangement = arr;
    this.applyKeyboardRange(arr);

    const muted: Part[] = this.settings.backing === 'others'
      ? (this.settings.mode === 'both' ? ['melody', 'chords'] : this.settings.mode === 'notes' ? ['melody'] : ['chords'])
      : [];
    this.audio.setMutedParts(muted);
    await this.audio.load(this.chart, SongLoader.getAudioUrl(this.songName, this.chart), COUNT_IN_BEATS);

    this.ui.hideMenu();
    this.ui.hideResults();
    this.ui.hidePause();
    this.ui.showHUD(this.meta?.title ?? this.chart.title, this.meta?.artist ?? this.chart.artist, this.settings.practice);
    this.beginRun();
  }

  private beginRun(): void {
    const arr = this.arrangement!;
    this.notes = arr.notes.map(n => ({ ...n, state: 'pending', holding: false, releasedAt: null }));
    this.cursor = 0;
    this.score = new ScoreManager(this.notes.length);
    const w = HIT_WINDOWS[this.settings.difficulty];
    this.score.setWindows(w.perfect, w.good);
    this.score.sustainTotal = this.notes.filter(n => n.isLong).reduce((s, n) => s + n.duration, 0);
    this.pressed.clear();
    this.waitingFor = 0;
    this.waits = 0;
    this.realPlaySeconds = 0;
    this.lastMultiplier = 1;
    this.tempo = this.settings.tempo;
    this.renderer.clearEffects();

    // Entrada: lo que tarda en caer la primera nota o 4 pulsos, lo que sea mayor
    const fallSong = FALL_SECONDS[this.settings.fallSpeed] * this.tempo;
    const lead = Math.max(COUNT_IN_BEATS * arr.beat, fallSong + 0.3, -arr.notes[0].time + fallSong);
    this.songTime = Math.min(-lead, arr.notes[0].time - fallSong - 0.3);
    this.audio.seek(this.songTime);

    this.phase = 'playing';
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private async restart(): Promise<void> {
    if (!this.chart) return;
    this.ui.hidePause();
    this.ui.hideResults();
    this.audio.stopAll();
    await this.audio.ensure();
    this.ui.showHUD(this.meta?.title ?? this.chart.title, this.meta?.artist ?? this.chart.artist, this.settings.practice);
    this.beginRun();
  }

  private pause(): void {
    if (this.phase !== 'playing' && this.phase !== 'resuming') return;
    this.phase = 'paused';
    this.audio.stopAll();
    this.releaseAllHolds();
    this.ui.showPause();
    this.drawFrame();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.ui.hidePause();
    void this.audio.ensure();
    // Vuelve con una cuenta de un compás, retrocediendo apenas para retomar el pulso
    const beat = this.arrangement?.beat ?? 0.5;
    this.audio.seek(this.songTime);
    this.phase = 'resuming';
    this.resumeAt = performance.now() + beat * COUNT_IN_BEATS * 1000 / this.tempo;
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private quit(): void {
    cancelAnimationFrame(this.rafId);
    this.audio.stopAll();
    this.phase = 'menu';
    this.ui.hidePause();
    this.ui.hideResults();
    this.ui.hideHUD();
    this.refreshDetail();
    if (this.songs.length) this.ui.setSongs(this.songs);
    if (this.songName) this.ui.setSelected(this.songName);
    this.ui.showMenu(true);
  }

  private setTempo(t: number): void {
    const tempo = Math.round(Math.max(0.4, Math.min(1.5, t)) * 100) / 100;
    if (tempo === this.tempo) return;
    this.tempo = tempo;
    this.changeSettings({ tempo });
    if (this.phase === 'playing') {
      this.audio.stopAll();
      this.audio.seek(this.songTime);
    }
    this.updateHUD();
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.phase === 'resuming') {
      if (now >= this.resumeAt) {
        this.phase = 'playing';
        this.audio.seek(this.songTime);
      }
      this.drawFrame();
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    if (this.phase !== 'playing') return;

    this.step(dt);
    this.drawFrame();

    const arr = this.arrangement!;
    if (this.songTime > arr.endTime + 1.2) {
      this.finish();
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Avanza el reloj y resuelve sostenidos, pifiadas y esperas. */
  private step(dt: number): void {
    const practice = this.settings.practice;
    const next = this.nextPending();

    let advance = dt * this.tempo;
    if (practice && next && this.songTime + advance >= next.time) {
      // Modo práctica: el tiempo se frena en la nota hasta que la toques
      advance = Math.max(0, next.time - this.songTime);
      if (this.waitingFor === 0) this.waits++;
      this.waitingFor += dt;
    } else {
      this.waitingFor = 0;
    }

    const prev = this.songTime;
    this.songTime += advance;
    if (this.songTime >= 0) this.realPlaySeconds += dt;

    if (this.waitingFor > 0) this.audio.hold();
    else this.audio.update(this.songTime, this.tempo, practice && next ? next.time - 0.001 : Infinity);

    // Notas largas sostenidas
    for (let i = this.cursorFrom(prev - 6); i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time > this.songTime) break;
      if (!n.holding) continue;
      const end = n.time + n.duration;
      const from = Math.max(prev, n.time);
      const to = Math.min(this.songTime, end);
      if (to > from) this.score.addSustain(to - from);
      if (this.songTime >= end) n.holding = false;
    }

    // Pifiadas por tiempo (no en práctica)
    if (!practice) {
      const window = HIT_WINDOWS[this.settings.difficulty].good / 1000;
      for (let i = this.cursor; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time > this.songTime - window) break;
        if (n.state !== 'pending') continue;
        n.state = 'missed';
        this.score.registerMiss();
        this.renderer.flash(n.note, 'miss', n.part);
      }
    }
    while (this.cursor < this.notes.length && this.notes[this.cursor].state !== 'pending') this.cursor++;

    const m = this.score.multiplier;
    if (m > this.lastMultiplier && !practice) this.renderer.announce(`x${m}`, m === 4 ? theme.part.chords.light : theme.amber);
    this.lastMultiplier = m;

    this.updateHUD();
  }

  /** Primer índice con time >= t (búsqueda binaria). */
  private cursorFrom(t: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private nextPending(): LiveNote | null {
    for (let i = this.cursor; i < this.notes.length; i++) if (this.notes[i].state === 'pending') return this.notes[i];
    return null;
  }

  // ─── Entrada ────────────────────────────────────────────────────────
  private onNoteOn(note: number, _velocity: number): void {
    this.pressed.set(note, null);
    if (this.phase !== 'playing') return;

    const practice = this.settings.practice;
    const w = HIT_WINDOWS[this.settings.difficulty].good / 1000;
    const pressTime = this.songTime - (this.settings.latencyMs / 1000) * this.tempo;

    // La nota pendiente más vieja dentro de la ventana: en notas repetidas sobre
    // la misma tecla, un toque algo tarde no le "roba" la nota a la siguiente.
    let best: LiveNote | null = null;
    for (let i = this.cursorFrom(pressTime - (practice ? 4 : w)); i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time > pressTime + w) break;
      if (n.state !== 'pending' || n.note !== note) continue;
      if (!practice && n.time < pressTime - w) continue;
      best = n;
      break;
    }
    if (!best && practice) {
      // Esperando: cualquier nota del golpe actual vale
      const next = this.nextPending();
      if (next && (this.waitingFor > 0 || pressTime >= next.time - w)) {
        for (let i = this.cursorFrom(next.time - GROUP_EPS); i < this.notes.length; i++) {
          const n = this.notes[i];
          if (n.time > next.time + GROUP_EPS) break;
          if (n.state === 'pending' && n.note === note) { best = n; break; }
        }
      }
    }
    if (!best) return; // tecla de más: sin castigo

    // En práctica el reloj espera, así que el toque nunca llega "tarde"
    const evalTime = practice ? Math.min(Math.max(pressTime, best.time - w), best.time) : pressTime;
    const res = this.score.evaluate(best.time, evalTime);
    const rating = res.rating === 'miss' ? 'good' : res.rating;
    best.state = 'hit';
    if (best.isLong) best.holding = true;
    this.pressed.set(note, best.part);
    this.renderer.flash(note, rating, best.part);
  }

  private onNoteOff(note: number): void {
    this.pressed.delete(note);
    for (let i = this.cursorFrom(this.songTime - 6); i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time > this.songTime + 0.5) break;
      if (n.holding && n.note === note) {
        n.holding = false;
        n.releasedAt = this.songTime;
      }
    }
  }

  private releaseAllHolds(): void {
    for (const n of this.notes) if (n.holding) { n.holding = false; n.releasedAt = this.songTime; }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.ui.settingsOpen) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range';

    if (e.key === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'resuming') { e.preventDefault(); this.pause(); }
      else if (this.phase === 'paused') { e.preventDefault(); this.resume(); }
      return;
    }
    if (this.phase === 'paused' && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); void this.restart(); return; }
    if ((this.phase === 'playing' || this.phase === 'paused') && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      this.setTempo(this.tempo + (e.key === ']' ? 0.1 : -0.1));
      return;
    }
    if (this.phase === 'playing' && e.key === ' ') { e.preventDefault(); this.pause(); return; }
    if (this.phase === 'menu' && e.key === 'Enter' && !typing && !(target.closest('button'))) {
      e.preventDefault();
      void this.start();
    }
  }

  // ─── Dibujo ─────────────────────────────────────────────────────────
  private drawFrame(): void {
    const arr = this.arrangement;
    if (!arr) return;
    const guide = new Map<number, Part>();
    const practice = this.settings.practice;
    const t = this.songTime;
    const next = practice ? this.nextPending() : null;
    for (let i = this.cursorFrom(t - 6); i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time > t + 0.12) break;
      const sounding = t >= n.time - 0.12 && t <= n.time + Math.max(0.12, n.duration);
      if (n.state === 'pending' && sounding) guide.set(n.note, n.part);
      else if (n.state === 'hit' && n.isLong && t < n.time + n.duration) guide.set(n.note, n.part);
    }
    if (next) {
      for (let i = this.cursorFrom(next.time - GROUP_EPS); i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time > next.time + GROUP_EPS) break;
        if (n.state === 'pending' && t >= n.time - 0.12) guide.set(n.note, n.part);
      }
    }

    let countIn: Frame['countIn'] = null;
    if (this.phase === 'resuming') {
      const left = (this.resumeAt - performance.now()) / 1000;
      const beatReal = arr.beat / this.tempo;
      const k = Math.ceil(left / beatReal);
      if (k >= 1 && k <= COUNT_IN_BEATS) countIn = { label: String(COUNT_IN_BEATS - k + 1), phase: 1 - (left / beatReal - (k - 1)) };
    } else if (t < 0) {
      const beatsLeft = -t / arr.beat;
      const k = Math.ceil(beatsLeft);
      if (k >= 1 && k <= COUNT_IN_BEATS) countIn = { label: String(COUNT_IN_BEATS - k + 1), phase: 1 - (beatsLeft - (k - 1)) };
    }

    this.renderer.render({
      songTime: t,
      tempo: this.tempo,
      beat: arr.beat,
      notes: this.notes,
      pressed: this.pressed,
      guide,
      waiting: this.waitingFor,
      countIn,
      naming: this.settings.naming,
    });
  }

  private updateHUD(): void {
    const arr = this.arrangement;
    if (!arr) return;
    const s = this.score.state;
    this.ui.updateHUD({
      score: s.score,
      multiplier: this.score.multiplier,
      combo: s.combo,
      progress: Math.max(0, this.songTime) / Math.max(1, arr.endTime),
      elapsed: Math.max(0, this.songTime),
      total: arr.endTime,
      tempo: this.tempo,
    });
  }

  // ─── Fin ────────────────────────────────────────────────────────────
  private finish(): void {
    this.phase = 'results';
    cancelAnimationFrame(this.rafId);
    this.audio.stopAll();
    const s = this.score.state;
    const total = Math.max(1, s.totalNotes);
    const accuracy = (s.perfects + s.goods) / total;
    const stars = accuracy >= 0.95 ? 5 : accuracy >= 0.85 ? 4 : accuracy >= 0.7 ? 3 : accuracy >= 0.5 ? 2 : 1;
    const practice = this.settings.practice;
    const prev = this.songName ? getRecord(this.songName, this.settings.mode, this.settings.difficulty) : null;
    let newRecord = false;
    if (!practice && this.songName && s.score > 0) {
      newRecord = submitRecord(this.songName, this.settings.mode, this.settings.difficulty, {
        score: s.score, stars, accuracy, date: new Date().toISOString(),
      });
    }
    this.ui.showResults({
      title: this.meta?.title ?? this.chart?.title ?? '',
      artist: this.meta?.artist ?? '',
      practice,
      score: s.score,
      stars,
      accuracy,
      perfects: s.perfects,
      goods: s.goods,
      misses: s.misses,
      maxCombo: s.maxCombo,
      sustainPct: this.score.sustainTotal > 0.5 ? Math.min(1, this.score.sustainHeld / this.score.sustainTotal) : null,
      totalNotes: s.totalNotes,
      newRecord,
      previousBest: prev?.score ?? null,
      timingBias: this.score.timingBias,
      playSeconds: this.realPlaySeconds,
      waits: this.waits,
      latencyMs: this.settings.latencyMs,
    }, ms => this.changeSettings({ latencyMs: Math.max(-250, Math.min(350, ms)) }));
  }

  // ─── Herramientas de desarrollo ─────────────────────────────────────
  /** Solo para pruebas automáticas (expuesto en dev). */
  debugState() {
    return {
      phase: this.phase,
      songTime: this.songTime,
      tempo: this.tempo,
      notes: this.notes,
      score: { ...this.score.state, multiplier: this.score.multiplier, sustainHeld: this.score.sustainHeld },
      waitingFor: this.waitingFor,
    };
  }

  get midiManager(): MIDIManager {
    return this.midi;
  }
}
