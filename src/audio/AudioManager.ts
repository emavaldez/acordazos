import type { ChartData } from '../types';

/**
 * Maneja reproducción de audio vía Web Audio API.
 * Si hay archivo de audio, lo carga y reproduce.
 * Si no, sintetiza las notas del chart con osciladores.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private audioEl: HTMLAudioElement | null = null;

  private synthChart: ChartData | null = null;
  private activeOscillators: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();
  private nextNoteId = 0;

  started = false;
  synthActive = false;

  volume = 0.12;
  startTime = 0;

  get loaded(): boolean {
    return this.started || this.synthActive || this.audioEl !== null;
  }

  get isPlaying(): boolean {
    if (this.audioEl) return !this.audioEl.paused;
    return this.synthActive;
  }

  get currentNote(): number {
    if (!this.ctx || !this.synthChart) return 0;
    const t = this.ctx.currentTime - this.startTime;
    const notes = this.synthChart.notes;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].time > t) return i;
    }
    return notes.length;
  }

  get currentTime(): number {
    if (!this.ctx) return 0;
    return this.synthActive
      ? this.ctx.currentTime - this.startTime
      : this.audioEl?.currentTime ?? 0;
  }

  get duration(): number {
    if (this.audioEl) return this.audioEl.duration || 0;
    if (this.synthChart) {
      const notes = this.synthChart.notes;
      return notes.length > 0 ? notes[notes.length - 1].time + 1 : 0;
    }
    return 0;
  }

  async init(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.started = false;
    this.synthActive = false;
  }

  async resumeContext(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        console.warn('AudioContext resume falló');
      }
    }
  }

  async load(audioUrl: string, chart: ChartData): Promise<void> {
    // Detener TODO lo que esté sonando
    this.stopAllOscillators();
    this.synthActive = false;

    // Limpiar audio anterior
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }

    // Guardar chart para síntesis (sin reproducir nada)
    this.synthChart = chart;
    this.started = false;

    // Intentar cargar MP3 — si no existe, usar síntesis
    await new Promise<void>(resolve => {
      try {
        const audioEl = new Audio();
        audioEl.preload = 'auto';
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        // Si carga metadata, hay audio real
        audioEl.addEventListener('loadedmetadata', () => {
          this.audioEl = audioEl;
          done();
        }, { once: true });
        // Si falla (404 o error), no hay audio — usar síntesis
        audioEl.addEventListener('error', () => {
          this.audioEl = null;
          done();
        }, { once: true });
        audioEl.src = audioUrl;
        // Timeout de 2s: si no carga, asumir síntesis
        setTimeout(done, 2000);
      } catch {
        this.audioEl = null;
        resolve();
      }
    });
  }

  async play(): Promise<void> {
    if (this.audioEl) {
      try {
        await this.audioEl.play();
        this.started = true;
      } catch (e) {
        console.warn('Audio play falló:', e);
      }
    } else if (this.synthChart) {
      // Detener osciladores anteriores ANTES de empezar los nuevos
      this.stopAllOscillators();
      this.synthActive = true;
      this.playSynthNotes();
    }
  }

  pause(): void {
    if (this.audioEl) {
      this.audioEl.pause();
    } else {
      this.synthActive = false;
    }
  }

  stop(): void {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
      this.started = false;
    }
    this.stopAllOscillators();
    this.synthActive = false;
  }

  private stopAllOscillators(): void {
    for (const [, { osc, gain }] of this.activeOscillators) {
      try {
        gain.gain.setValueAtTime(0, this.ctx!.currentTime);
        osc.stop(this.ctx!.currentTime + 0.01);
      } catch { /* ya está parado */ }
    }
    this.activeOscillators.clear();
    this.nextNoteId = 0;
  }

  private playSynthNotes(): void {
    if (!this.ctx || !this.synthChart) return;

    this.startTime = this.ctx.currentTime + 0.1; // empezar en ~100ms
    const notes = this.synthChart.notes;

    for (const note of notes) {
      const id = this.nextNoteId++;
      const freq = 440 * Math.pow(2, (note.note - 69) / 12);
      const noteStart = this.startTime + note.time;

      if (noteStart < this.ctx.currentTime) continue;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Envelope ADSR suave
      const attack = 0.005;
      const release = 0.08;
      const noteDuration = Math.max(note.duration, 0.05);
      const vol = this.volume;

      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(vol, noteStart + attack);
      gain.gain.setValueAtTime(vol, noteStart + noteDuration - release);
      gain.gain.linearRampToValueAtTime(0, noteStart + noteDuration);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(noteStart);
      osc.stop(noteStart + noteDuration + 0.01);

      this.activeOscillators.set(id, { osc, gain });

      // Limpiar oscilador cuando termine
      osc.addEventListener('ended', () => {
        this.activeOscillators.delete(id);
      });
    }

    // Cuando termine la última nota, desactivar
    const lastNote = notes[notes.length - 1];
    if (lastNote) {
      const endTime = this.startTime + lastNote.time + lastNote.duration + 0.1;
      setTimeout(() => {
        this.synthActive = false;
        this.stopAllOscillators();
      }, (endTime - this.ctx.currentTime) * 1000);
    }
  }

  getAnalyserData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  getDuration(): number {
    return this.duration;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }
}
