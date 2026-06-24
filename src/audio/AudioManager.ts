/**
 * Maneja reproducción de audio vía Web Audio API.
 * Reproduce el mix completo de la canción.
 */
export class AudioManager {
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private startTime: number = 0;
  private pausedAt: number = 0;
  private buffer: AudioBuffer | null = null;

  /** Inicializa el AudioContext (debe llamarse tras interacción del usuario) */
  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = 0.7;
  }

  /** Carga un archivo de audio desde URL */
  async load(url: string): Promise<boolean> {
    if (!this.audioContext) return false;

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
      return true;
    } catch (err) {
      console.warn('No se pudo cargar el audio:', url, err);
      return false;
    }
  }

  /** Inicia reproducción desde el inicio */
  play(): void {
    if (!this.audioContext || !this.buffer) {
      console.warn('No hay audio cargado, reproduciendo igual');
      return;
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode!);
    this.source.start(0, 0);
    this.startTime = this.audioContext.currentTime;
    this.pausedAt = 0;
  }

  /** Pausa */
  pause(): void {
    if (this.source && this.audioContext) {
      this.pausedAt = this.audioContext.currentTime - this.startTime;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Obtiene el tiempo actual de reproducción */
  getCurrentTime(): number {
    if (!this.audioContext || !this.source) return this.pausedAt;
    return this.audioContext.currentTime - this.startTime;
  }

  /** Obtiene el tiempo total en segundos */
  getDuration(): number {
    return this.buffer?.duration || 0;
  }

  /** Reproduce un tono de prueba (sin audio cargado) */
  playTestTone(frequency: number, duration: number): void {
    if (!this.audioContext) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    osc.start();
    osc.stop(this.audioContext.currentTime + duration);
  }

  resumeContext(): void {
    this.audioContext?.resume();
  }

  destroy(): void {
    this.source?.stop();
    this.source?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
  }
}