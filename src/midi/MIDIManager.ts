import type { NoteEvent } from '../types';

/**
 * Maneja la conexión WebMIDI API.
 * Escanea puertos MIDI disponibles y emite eventos Note On/Off.
 */
export class MIDIManager {
  private midiAccess: MIDIAccess | null = null;
  private inputDevice: MIDIInput | null = null;
  private onNoteOn: ((note: number, velocity: number) => void) | null = null;
  private onNoteOff: ((note: number) => void) | null = null;

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('WebMIDI API no disponible en este navegador');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.updateDeviceList();
      this.midiAccess.onstatechange = () => this.updateDeviceList();
      return this.inputDevice !== null;
    } catch (err) {
      console.error('Error al acceder a MIDI:', err);
      return false;
    }
  }

  private updateDeviceList(): void {
    const inputs = this.midiAccess!.inputs;
    const devices: string[] = [];

    // Preferir Yamaha o primer dispositivo encontrado
    for (const input of inputs.values()) {
      devices.push(input.name || 'Unknown');
      if (
        !this.inputDevice &&
        (input.name?.toLowerCase().includes('yamaha') ||
          input.name?.toLowerCase().includes('keyboard') ||
          input.name?.toLowerCase().includes('midi'))
      ) {
        this.connectDevice(input);
      }
    }

    // Si no se encontró uno preferido, tomar el primero
    if (!this.inputDevice && inputs.size > 0) {
      this.connectDevice(inputs.values().next().value as MIDIInput);
    }

    console.log(`Dispositivos MIDI disponibles: ${devices.join(', ') || 'ninguno'}`);
  }

  private connectDevice(input: MIDIInput): void {
    this.inputDevice = input;
    input.onmidimessage = (event) => this.handleMIDIMessage(event);
    console.log(`✅ Conectado a ${input.name}`);
  }

  private handleMIDIMessage(event: MIDIMessageEvent): void {
    if (!event.data) return;
    const [status, note, velocity] = event.data;

    // Status byte: 0x90 = Note On, 0x80 = Note Off
    const noteOn = status & 0xf0;

    if (noteOn === 0x90 && velocity > 0) {
      this.onNoteOn?.(note, velocity);
    } else if (noteOn === 0x80 || (noteOn === 0x90 && velocity === 0)) {
      this.onNoteOff?.(note);
    }
  }

  /** Cargar notas desde un array de NoteEvent para alimentar el detector */
  getNoteEvents(): NoteEvent[] {
    return [];
  }

  onNote(callback: (note: number, velocity: number) => void): void {
    this.onNoteOn = callback;
  }

  onNoteRelease(callback: (note: number) => void): void {
    this.onNoteOff = callback;
  }

  getDeviceName(): string | null {
    return this.inputDevice?.name || null;
  }

  getDeviceCount(): number {
    return this.midiAccess ? this.midiAccess.inputs.size : 0;
  }
}