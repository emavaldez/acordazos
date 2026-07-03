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

  // Síntesis de notas
  private scheduledOscillators: OscillatorNode[] = [];
  private chart: ChartData | null = null;
  private synthMode: boolean = false;

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = 0.5;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  /**
   * Carga audio desde un archivo, o prepara síntesis desde el chart.
   */
  async load(url: string, chart?: ChartData): Promise<boolean> {
    if (!this.audioContext) return false;

    // Si no hay URL o es vacía, usar síntesis
    if (!url || url === '/' || url.endsWith('/audio.mp3') && chart) {
      if (chart && chart.notes.length > 0) {
        this.chart = chart;
        this.synthMode = true;
        this._duration = chart.duration;
        this._loaded = true;
        console.log(`Síntesis activada: ${chart.notes.length} notas, ${chart.duration.toFixed(0)}s`);
        return true;
      }
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Audio HTTP ${response.status}: ${url}`);
        // Fallback a síntesis si hay chart
        if (chart && chart.notes.length > 0) {
          this.chart = chart;
          this.synthMode = true;
          this._duration = chart.duration;
          this._loaded = true;
          console.log(`Síntesis (fallback): ${chart.notes.length} notas`);
          return true;
        }
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this._duration = this.buffer.duration;
      this._loaded = true;
      this.synthMode = false;
      console.log(`Audio cargado: ${url} (${this._duration.toFixed(0)}s)`);
      return true;
    } catch (err) {
      console.warn('No se pudo cargar el audio:', url, err);
      // Fallback a síntesis
      if (chart && chart.notes.length > 0) {
        this.chart = chart;
        this.synthMode = true;
        this._duration = chart.duration;
        this._loaded = true;
        console.log(`Síntesis (error fallback): ${chart.notes.length} notas`);
        return true;
      }
      this._loaded = false;
      return false;
    }
  }

  /**
   * Convierte nota MIDI a frecuencia en Hz
   */
  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Programa las notas del chart como osciladores
   */
  private scheduleSynthNotes(): void {
    if (!this.audioContext || !this.chart) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Notas individuales
    for (const note of this.chart.notes) {
      this.scheduleNote(note.note, now + note.time, note.duration, note.velocity);
    }

    // Acordes
    for (const chord of this.chart.chords) {
      for (const note of chord.notes) {
        this.scheduleNote(note, now + chord.time, chord.duration, 80);
      }
    }
  }

  /**
   * Programa una sola nota con un oscilador
   */
  private scheduleNote(midi: number, startTime: number, duration: number, velocity: number): void {
    if (!this.audioContext || !this.gainNode) return;

    const freq = this.midiToFreq(midi);
    const osc = this.audioContext.createOscillator();
    const noteGain = this.audioContext.createGain();

    osc.type = 'triangle'; // Sonido más suave que square
    osc.frequency.value = freq;

    // Envelope: attack rápido, decay suave, release
    const vol = (velocity / 127) * 0.3;
    noteGain.gain.setValueAtTime(0, startTime);
    noteGain.gain.linearRampToValueAtTime(vol, startTime + 0.01); // Attack
    noteGain.gain.exponentialRampToValueAtTime(vol * 0.5, startTime + 0.1); // Decay
    noteGain.gain.setValueAtTime(vol * 0.5, startTime + duration * 0.8);
    noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // Release

    osc.connect(noteGain);
    noteGain.connect(this.gainNode);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    this.scheduledOscillators.push(osc);
  }

  async play(): Promise<void> {
    if (!this.audioContext) return;

    // Asegurar que el contexto está activo
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (this.synthMode) {
      // Síntesis: programar todas las notas
      this.scheduleSynthNotes();
      this.startTime = this.audioContext.currentTime;
      this.pausedAt = 0;
      return;
    }

    if (!this.buffer) {
      console.warn('Sin audio, jugando igual');
      return;
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode!);
    this.source.start(0, this.pausedAt);
    this.startTime = this.audioContext.currentTime - this.pausedAt;
    this.pausedAt = 0;
  }

  pause(): void {
    if (this.synthMode) {
      // Detener todos los osciladores programados
      for (const osc of this.scheduledOscillators) {
        try { osc.stop(); } catch { /* ya terminó */ }
        try { osc.disconnect(); } catch { /* */ }
      }
      this.scheduledOscillators = [];
      if (this.audioContext) {
        this.pausedAt = this.audioContext.currentTime - this.startTime;
      }
      return;
    }

    if (this.source && this.audioContext) {
      this.pausedAt = this.audioContext.currentTime - this.startTime;
      try { this.source.stop(); } catch { /* ya terminó */ }
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
