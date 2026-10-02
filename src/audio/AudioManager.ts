import type { ChartData, Part } from '../types';
import type { BackingEvent } from '../game/Arrangement';
import { buildBacking } from '../game/Arrangement';
import { midiToFreq } from '../music/notes';

type EventKind = Part | 'click' | 'accent';

interface AudioEvent {
  kind: EventKind;
  note: number;
  time: number;
  duration: number;
}

interface Voice {
  stopAt: number;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

/** Cuánto se agenda por adelantado (segundos reales). */
const LOOKAHEAD = 0.18;

/**
 * Audio del juego.
 * - Sin MP3: sintetiza el tema con un scheduler que mira apenas adelante del reloj
 *   del juego, así respeta tempo, pausa y el modo práctica (que frena el tiempo).
 * - Con MP3: lo reproduce con playbackRate = tempo y lo resincroniza si se corre.
 * - La cuenta de entrada (clics) siempre es sintetizada.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private synthBus: GainNode | null = null;

  private events: AudioEvent[] = [];
  private pointer = 0;
  private scheduledUntil = -Infinity;
  private voices = new Set<Voice>();
  private mutedParts = new Set<Part>();

  private media: HTMLAudioElement | null = null;
  private volume = 0.7;

  get hasMedia(): boolean {
    return this.media !== null;
  }

  /** Crea/reanuda el AudioContext. Llamar desde un gesto del usuario. */
  async ensure(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.synthBus = this.ctx.createGain();
      this.synthBus.gain.value = 0.55;
      this.synthBus.connect(comp);
      comp.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* sin audio */ }
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    if (this.media) this.media.volume = this.volume;
  }

  /** Partes que no suenan en la pista de fondo (p. ej. la que toca el jugador). */
  setMutedParts(parts: Part[]): void {
    this.mutedParts = new Set(parts);
  }

  /**
   * Prepara el tema. `countInBeats` clics antes del tiempo 0.
   * Devuelve rápido: el MP3 se intenta en paralelo con un tope de 2 s.
   */
  async load(chart: ChartData, audioUrl: string | null, countInBeats: number): Promise<void> {
    this.stopAll();
    this.disposeMedia();

    const beat = 60 / (chart.bpm > 20 && chart.bpm < 400 ? chart.bpm : 120);
    const clicks: AudioEvent[] = [];
    for (let i = countInBeats; i >= 1; i--) {
      clicks.push({ kind: i === countInBeats ? 'accent' : 'click', note: 0, time: -i * beat, duration: 0.05 });
    }
    const backing: AudioEvent[] = buildBacking(chart).map((e: BackingEvent) => ({ kind: e.part, note: e.note, time: e.time, duration: e.duration }));
    this.events = [...clicks, ...backing].sort((a, b) => a.time - b.time);

    if (audioUrl) {
      this.media = await new Promise<HTMLAudioElement | null>(resolve => {
        const el = new Audio();
        el.preload = 'auto';
        let done = false;
        const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok ? el : null); } };
        el.addEventListener('canplaythrough', () => finish(true), { once: true });
        el.addEventListener('error', () => finish(false), { once: true });
        setTimeout(() => finish(el.readyState >= 3), 2000);
        el.src = audioUrl;
      });
      if (this.media) {
        this.media.volume = this.volume;
        (this.media as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      }
    }
  }

  /** Reposiciona el scheduler (al empezar o reiniciar). */
  seek(songTime: number): void {
    this.stopAll();
    this.pointer = 0;
    while (this.pointer < this.events.length && this.events[this.pointer].time < songTime - 0.001) this.pointer++;
    this.scheduledUntil = songTime - 0.001;
    if (this.media) this.media.pause();
  }

  /**
   * Llamar en cada frame mientras el reloj corre.
   * `limit`: en modo práctica, no agendar más allá de la nota que se está esperando.
   */
  update(songTime: number, tempo: number, limit = Infinity): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const horizon = Math.min(songTime + LOOKAHEAD * tempo, limit);
    const outLatency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);

    while (this.pointer < this.events.length) {
      const ev = this.events[this.pointer];
      if (ev.time > horizon) break;
      this.pointer++;
      if (ev.time <= this.scheduledUntil) continue;
      const isClick = ev.kind === 'click' || ev.kind === 'accent';
      if (!isClick && this.media) continue; // el MP3 ya trae la música
      if (!isClick && this.mutedParts.has(ev.kind as Part)) continue;

      const when = Math.max(ctx.currentTime + 0.005, ctx.currentTime + (ev.time - songTime) / tempo - outLatency);
      const dur = Math.max(0.05, ev.duration / tempo);
      if (ev.kind === 'melody') this.playLead(ev.note, when, dur);
      else if (ev.kind === 'chords') this.playChordTone(ev.note, when, dur);
      else this.playClick(when, ev.kind === 'accent');
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, horizon);

    this.syncMedia(songTime, tempo);
    this.reap();
  }

  /** Corta todo lo que está sonando o agendado. */
  stopAll(): void {
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      for (const v of this.voices) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(0, now, 0.015);
          for (const s of v.sources) s.stop(now + 0.08);
        } catch { /* ya parado */ }
      }
    }
    this.voices.clear();
    if (this.media && !this.media.paused) this.media.pause();
  }

  /** Para el MP3 sin perder la posición (pausa / espera del modo práctica). */
  hold(): void {
    if (this.media && !this.media.paused) this.media.pause();
  }

  // ─── MP3 ────────────────────────────────────────────────────────────
  private syncMedia(songTime: number, tempo: number): void {
    const el = this.media;
    if (!el) return;
    if (songTime < 0) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.playbackRate !== tempo) el.playbackRate = tempo;
    if (el.paused) {
      el.currentTime = songTime;
      el.play().catch(() => { /* autoplay bloqueado */ });
    } else if (Math.abs(el.currentTime - songTime) > 0.08) {
      el.currentTime = songTime;
    }
  }

  private disposeMedia(): void {
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
      this.media = null;
    }
  }

  // ─── Instrumentos ───────────────────────────────────────────────────
  /** Lead tipo teclado de cumbia: cuadrada + sierra apenas desafinada, filtrada, con vibrato. */
  private playLead(note: number, when: number, dur: number): void {
    const ctx = this.ctx!;
    const freq = midiToFreq(note);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(4200, freq * 6);
    filter.Q.value = 0.8;

    const a = ctx.createOscillator();
    a.type = 'square';
    a.frequency.value = freq;
    const b = ctx.createOscillator();
    b.type = 'sawtooth';
    b.frequency.value = freq;
    b.detune.value = 7;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, when);
    lfoGain.gain.linearRampToValueAtTime(dur > 0.3 ? 9 : 0, when + Math.min(0.25, dur));
    lfo.connect(lfoGain);
    lfoGain.connect(a.detune);
    lfoGain.connect(b.detune);

    const mixA = ctx.createGain();
    mixA.gain.value = 0.55;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.35;
    a.connect(mixA).connect(filter);
    b.connect(mixB).connect(filter);
    filter.connect(gain);
    gain.connect(this.synthBus!);

    const peak = 0.22;
    const release = 0.07;
    const end = when + dur;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(peak * 0.7, when + 0.008 + Math.min(0.12, dur * 0.5));
    gain.gain.setValueAtTime(peak * 0.7, Math.max(when + 0.01, end - 0.01));
    gain.gain.linearRampToValueAtTime(0, end + release);

    const stopAt = end + release + 0.02;
    for (const o of [a, b, lfo]) { o.start(when); o.stop(stopAt); }
    this.voices.add({ stopAt, gain, sources: [a, b, lfo] });
  }

  /** Acordes: colchón suave tipo órgano, bien por debajo de la melodía. */
  private playChordTone(note: number, when: number, dur: number): void {
    const ctx = this.ctx!;
    const freq = midiToFreq(note);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;

    const a = ctx.createOscillator();
    a.type = 'triangle';
    a.frequency.value = freq;
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = freq * 2;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.25;

    a.connect(filter);
    b.connect(bGain).connect(filter);
    filter.connect(gain);
    gain.connect(this.synthBus!);

    const peak = 0.075;
    const end = when + dur;
    const release = 0.12;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.02);
    gain.gain.setTargetAtTime(peak * 0.75, when + 0.02, 0.2);
    gain.gain.setValueAtTime(peak * 0.75, Math.max(when + 0.03, end - 0.01));
    gain.gain.linearRampToValueAtTime(0, end + release);

    const stopAt = end + release + 0.02;
    for (const o of [a, b]) { o.start(when); o.stop(stopAt); }
    this.voices.add({ stopAt, gain, sources: [a, b] });
  }

  /** Clic de cuenta (tipo clave de madera). */
  private playClick(when: number, accent: boolean): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 2100 : 1500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(when);
    osc.stop(when + 0.08);
    this.voices.add({ stopAt: when + 0.08, gain, sources: [osc] });
  }

  private reap(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices) if (v.stopAt < now) this.voices.delete(v);
  }
}
