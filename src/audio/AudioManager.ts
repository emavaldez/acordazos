/**
 * Maneja reproducción de audio vía Web Audio API.
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

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = 0.7;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  async load(url: string): Promise<boolean> {
    if (!this.audioContext) return false;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Audio HTTP ${response.status}: ${url}`);
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this._duration = this.buffer.duration;
      this._loaded = true;
      console.log(`Audio cargado: ${url} (${this._duration.toFixed(0)}s)`);
      return true;
    } catch (err) {
      console.warn('No se pudo cargar el audio:', url, err);
      this._loaded = false;
      return false;
    }
  }

  async play(): Promise<void> {
    if (!this.audioContext || !this.buffer) {
      console.warn('Sin audio, jugando igual');
      return;
    }

    // Asegurar que el contexto está activo (requiere gesto del usuario)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode!);
    this.source.start(0, 0);
    this.startTime = this.audioContext.currentTime;
    this.pausedAt = 0;
  }

  pause(): void {
    if (this.source && this.audioContext) {
      this.pausedAt = this.audioContext.currentTime - this.startTime;
      try { this.source.stop(); } catch { /* ya terminó */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  getCurrentTime(): number {
    if (!this.audioContext || !this.source) return this.pausedAt;
    return this.audioContext.currentTime - this.startTime;
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