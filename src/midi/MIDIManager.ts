/**
 * Conexión WebMIDI. Escucha todas las entradas a la vez y se entera si
 * enchufás o desenchufás el teclado con el juego abierto.
 */
export interface MIDIStatus {
  /** El navegador soporta WebMIDI */
  supported: boolean;
  /** El usuario dio permiso */
  allowed: boolean;
  /** Nombres de los dispositivos de entrada conectados */
  devices: string[];
}

type NoteOnHandler = (note: number, velocity: number) => void;
type NoteOffHandler = (note: number) => void;

export class MIDIManager {
  private access: MIDIAccess | null = null;
  private onNoteOn: NoteOnHandler | null = null;
  private onNoteOff: NoteOffHandler | null = null;
  private statusListeners: ((s: MIDIStatus) => void)[] = [];
  private status: MIDIStatus = { supported: typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess, allowed: false, devices: [] };

  async init(): Promise<MIDIStatus> {
    if (!this.status.supported) return this.status;
    try {
      this.access = await Promise.race([
        navigator.requestMIDIAccess({ sysex: false }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MIDI timeout')), 6000)),
      ]);
      this.status.allowed = true;
      this.access.onstatechange = () => this.attachAll();
      this.attachAll();
    } catch (err) {
      console.warn('No se pudo acceder a MIDI:', err);
      this.status.allowed = false;
      this.emitStatus();
    }
    return this.status;
  }

  private attachAll(): void {
    if (!this.access) return;
    const names: string[] = [];
    for (const input of this.access.inputs.values()) {
      if (input.state !== 'connected') continue;
      input.onmidimessage = (e) => this.handle(e);
      names.push(input.name || 'Teclado MIDI');
    }
    this.status.devices = names;
    this.emitStatus();
  }

  private handle(event: MIDIMessageEvent): void {
    if (!event.data || event.data.length < 3) return;
    const [status, note, velocity] = event.data;
    const type = status & 0xf0;
    if (type === 0x90 && velocity > 0) this.onNoteOn?.(note, velocity);
    else if (type === 0x80 || (type === 0x90 && velocity === 0)) this.onNoteOff?.(note);
  }

  /** Inyecta una nota como si viniera del teclado (pruebas / herramientas de dev). */
  emitNoteOn(note: number, velocity = 100): void {
    this.onNoteOn?.(note, velocity);
  }

  emitNoteOff(note: number): void {
    this.onNoteOff?.(note);
  }

  onNote(cb: NoteOnHandler): void {
    this.onNoteOn = cb;
  }

  onNoteRelease(cb: NoteOffHandler): void {
    this.onNoteOff = cb;
  }

  onStatus(cb: (s: MIDIStatus) => void): void {
    this.statusListeners.push(cb);
  }

  getStatus(): MIDIStatus {
    return { ...this.status, devices: [...this.status.devices] };
  }

  getDeviceName(): string | null {
    return this.status.devices[0] ?? null;
  }

  private emitStatus(): void {
    const s = this.getStatus();
    for (const l of this.statusListeners) l(s);
  }
}
