import type { ChartData } from '../types';

/**
 * Maneja reproducción de audio vía Web Audio API.
 * Si hay archivo de audio, lo carga y reproduce.
 * Si no, sintetiza las notas del chart con osciladores.
 */
export class AudioManager {
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private startTime: number = 0;
  private pausedAt: number = 0;
  private buffer: AudioBuffer | null = null;
  private _duration: number = 0;
  private _loaded: boolean = false;

  private scheduledOscillators: OscillatorNode[] = [];
  private chart: ChartData | null = null;
  private synthMode: boolean = false;

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = 0.3;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  /** Detiene todo lo que esté sonando */
  private stopAllOscillators(): void {
    for (const osc of this.scheduledOscillators) {
      try { osc.stop(); } catch { /* ya terminó */ }
      try { osc.disconnect(); } catch { /* */ }
    }
    this.scheduledOscillators = [];
  }

  async load(url: string, chart?: ChartData): Promise<boolean> {
    if (!this.audioContext) return false;

    // Detener cualquier audio anterior
    this.stopAllOscillators();
    this.pause();
    this.buffer = null;
    this.synthMode = false;
    this._loaded = false;

    // Si no hay URL válida o es el default de audio.mp3, usar síntesis
    if ((!url || url === '/' || url.endsWith('/audio.mp3')) && chart && chart.notes.length > 0) {
      this.chart = chart;
      this.synthMode = true;
      this._duration = chart.duration;
      this._loaded = true;
      console.log(`Síntesis: ${chart.notes.length} notas, ${chart.duration.toFixed(0)}s`);
      return true;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (chart && chart.notes.length > 0) {
          this.chart = chart;
          this.synthMode = true;
          this._duration = chart.duration;
          this._loaded = true;
          return true;
        }
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this._duration = this.buffer.duration;
      this._loaded = true;
      this.synthMode = false;
      return true;
    } catch {
      if (chart && chart.notes.length > 0) {
        this.chart = chart;
        this.synthMode = true;
        this._duration = chart.duration;
        this._loaded = true;
        return true;
      }
      this._loaded = false;
      return false;
    }
  }

  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Programa las notas del chart como osciladores.
   * SOLO notas individuales, NO acordes.
   */
  private scheduleSynthNotes(): void {
    if (!this.audioContext || !this.chart) return;

    const now = this.audioContext.currentTime;

    for (const note of this.chart.notes) {
      this.scheduleNote(note.note, now + note.time, note.duration, note.velocity);
    }
  }

  private scheduleNote(midi: number, startTime: number, duration: number, velocity: number): void {
    if (!this.audioContext || !this.gainNode) return;

    const freq = this.midiToFreq(midi);
    const osc = this.audioContext.createOscillator();
    const noteGain = this.audioContext.createGain();

    // Sine wave = sonido suave tipo flauta
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Envelope suave: attack rápido, sustain bajo, release
    const vol = (velocity / 127) * 0.15;
    noteGain.gain.setValueAtTime(0, startTime);
    noteGain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
    noteGain.gain.setValueAtTime(vol * 0.7, startTime + duration * 0.5);
    noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(noteGain);
    noteGain.connect(this.gainNode);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    this.scheduledOscillators.push(osc);
  }

  async play(): Promise<void> {
    if (!this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (this.synthMode) {
      this.stopAllOscillators();
      this.scheduleSynthNotes();
      this.startTime = this.audioContext.currentTime;
      this.pausedAt = 0;
      return;
    }

    if (!this.buffer) return;

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode!);
    this.source.start(0, this.pausedAt);
    this.startTime = this.audioContext.currentTime - this.pausedAt;
    this.pausedAt = 0;
  }

  pause(): void {
    if (this.synthMode) {
      this.stopAllOscillators();
      if (this.audioContext) {
        this.pausedAt = this.audioContext.currentTime - this.startTime;
      }
      return;
    }

    if (this.source && this.audioContext) {
      this.pausedAt = this.audioContext.currentTime - this.startTime;
      try { this.source.stop(); } catch { /* */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  getCurrentTime(): number {
    if (!this.audioContext) return this.pausedAt;
    if (this.synthMode || this.source) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pausedAt;
  }

  getDuration(): number {
    return this._duration;
  }

  async resumeContext(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}
