import type { ChartData, GameMode } from '../types';

/**
 * Renderiza las notas cayendo verticalmente sobre un teclado de piano horizontal.
 * Tipo Guitar Hero pero con teclas de piano.
 *
 * Layout (vertical):
 *   [ HUD arriba ]
 *   [   NOTAS CAYENDO  ]
 *   [   ↓    ↓    ↓    ]
 *   [   ]   ]   ]   ]  ]
 *   [   LÍNEA DE IMPACTO ]
 *   [ TECLADO DE PIANO ]
 */
export class NoteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  // Configuración visual
  private readonly hudHeight: number = 65;
  private readonly keyboardHeight: number = 90;
  private readonly noteScrollTime: number = 3; // segundos que tarda una nota en caer desde arriba hasta la línea de impacto

  // Rango de teclas MIDI Yamaha E333 (61 teclas: C2=36 a C7=96)
  private readonly maxNote: number = 96;
  private readonly keyCount: number = 61;

  // Layout del teclado: índice de las teclas negras dentro de cada octava
  // C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
  private readonly blackKeyIndices = new Set([1, 3, 6, 8, 10]);

  // Colores
  private readonly bgColor = '#0a0a1a';
  private readonly laneBgColor = '#111128';
  private readonly hitZoneColor = '#ffcc0033';
  private readonly hitZoneLineColor = '#ffcc00';
  private readonly noteColor = '#00ddff';
  private readonly chordColor = '#ff66ff';
  private readonly whiteKeyColor = '#e0e0e0';
  private readonly whiteKeyActiveColor = '#aaddff';
  private readonly blackKeyColor = '#222230';
  private readonly blackKeyActiveColor = '#4488cc';
  private readonly keyBorderColor = '#555';
  private readonly perfectColor = '#00ff88';
  private readonly goodColor = '#ffcc00';
  private readonly missColor = '#ff3355';

  // Cache de layout de teclas
  private keyLayout: {
    x: number;
    w: number;
    isBlack: boolean;
  }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.buildKeyLayout();
  }

  /** Calcula la posición Y de la línea de impacto */
  private get hitLineY(): number {
    return this.height - this.keyboardHeight - 20;
  }

  /** Calcula la posición X de cada tecla en el teclado */
  private buildKeyLayout(): void {
    this.keyLayout = [];
    const totalW = this.width;

    // Contar teclas blancas para distribuir el ancho
    let whiteCount = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      if (!this.blackKeyIndices.has(note % 12)) {
        whiteCount++;
      }
    }

    const whiteKeyW = totalW / whiteCount;
    const blackKeyW = whiteKeyW * 0.6;
    let whiteIndex = 0;

    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      const isBlack = this.blackKeyIndices.has(note % 12);

      if (isBlack) {
        // La tecla negra se posiciona entre la blanca actual y la siguiente
        const prevWhiteX = (whiteIndex - 1) * whiteKeyW;
        this.keyLayout.push({
          x: prevWhiteX + whiteKeyW - blackKeyW / 2,
          w: blackKeyW,
          isBlack: true,
        });
      } else {
        this.keyLayout.push({
          x: whiteIndex * whiteKeyW,
          w: whiteKeyW,
          isBlack: false,
        });
        whiteIndex++;
      }
    }
  }

  /** Renderiza un frame completo */
  render(
    chart: ChartData,
    gameTime: number,
    scoreState: { score: number; combo: number; maxCombo: number; perfects: number; goods: number; misses: number },
    mode: GameMode,
    activeNotes: Set<number>,
    hitResults: { time: number; rating: string }[],
  ): void {
    const ctx = this.ctx;

    // Limpiar
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.width, this.height);

    // HUD
    this.renderHUD(chart, scoreState, mode, gameTime);

    // Área de juego (notas cayendo)
    this.renderLane(chart, gameTime, mode);

    // Feedback de hits recientes
    this.renderHitFeedback(hitResults);

    // Teclado de piano
    this.renderKeyboard(activeNotes, gameTime);
  }

  private renderHUD(
    chart: ChartData,
    scoreState: { score: number; combo: number; maxCombo: number; perfects: number; goods: number; misses: number },
    mode: GameMode,
    gameTime: number,
  ): void {
    const ctx = this.ctx;

    // Fondo del HUD
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.hudHeight);

    // Línea separadora
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.hudHeight);
    ctx.lineTo(this.width, this.hudHeight);
    ctx.stroke();

    // Título
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`${chart.title} - ${chart.artist}`, 16, 24);

    // Modo
    const modeLabel = mode === 'chords' ? '🎸 ACORDES' : mode === 'notes' ? '🎵 NOTAS' : '🎵🎸 AMBOS';
    ctx.font = '11px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`Modo: ${modeLabel}`, 16, 44);

    // Stats (perfects/goods/misses)
    ctx.font = '11px monospace';
    ctx.fillStyle = this.perfectColor;
    ctx.fillText(`P:${scoreState.perfects}`, this.width * 0.45, 24);
    ctx.fillStyle = this.goodColor;
    ctx.fillText(`G:${scoreState.goods}`, this.width * 0.45, 44);
    ctx.fillStyle = this.missColor;
    ctx.fillText(`M:${scoreState.misses}`, this.width * 0.45, 64);

    // Timer
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'right';
    ctx.font = '12px monospace';
    const min = Math.floor(gameTime / 60);
    const sec = Math.floor(gameTime % 60);
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, this.width - 16, 24);

    // Tiempo restante
    const remaining = Math.max(0, chart.duration - gameTime);
    const remMin = Math.floor(remaining / 60);
    const remSec = Math.floor(remaining % 60);
    ctx.fillStyle = '#555555';
    ctx.fillText(`-${remMin}:${remSec.toString().padStart(2, '0')}`, this.width - 16, 44);

    ctx.textAlign = 'left';

    // Score
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${scoreState.score}`, this.width - 16, 64);

    // Combo
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = scoreState.combo > 5 ? '#ffcc00' : '#aaaaaa';
    ctx.fillText(`🔥 ${scoreState.combo}`, this.width - 140, 64);
    ctx.textAlign = 'left';
  }

  private renderLane(chart: ChartData, gameTime: number, mode: GameMode): void {
    const ctx = this.ctx;
    const laneTop = this.hudHeight;
    const laneBottom = this.hitLineY;
    const laneH = laneBottom - laneTop;

    // Fondo del carril
    ctx.fillStyle = this.laneBgColor;
    ctx.fillRect(0, laneTop, this.width, laneH);

    // Línea de octavas verticales (separación entre C y B)
    ctx.strokeStyle = '#1a1a30';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      if (note % 12 === 0) {
        // Inicio de octava - línea más marcada
        const key = this.keyLayout[i];
        if (key) {
          ctx.strokeStyle = '#252545';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(key.x, laneTop);
          ctx.lineTo(key.x, laneBottom);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }

    // Etiquetas de notas (solo C y su número de octava)
    ctx.font = '8px monospace';
    ctx.fillStyle = '#444466';
    ctx.textAlign = 'center';
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      if (note % 12 === 0) {
        const key = this.keyLayout[i];
        if (key) {
          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const octave = Math.floor(note / 12) - 1;
          ctx.fillText(`${noteNames[0]}${octave}`, key.x + key.w / 2, laneBottom - 4);
        }
      }
    }

    // Velocidad de caída de las notas
    const pxPerSec = laneH / this.noteScrollTime;

    // Renderizar notas y acordes
    if (mode === 'notes' || mode === 'both') {
      for (const note of chart.notes) {
        this.renderNote(note, gameTime, laneTop, laneBottom, pxPerSec);
      }
    }
    if (mode === 'chords' || mode === 'both') {
      for (const chord of chart.chords) {
        this.renderChord(chord, gameTime, laneTop, laneBottom, pxPerSec);
      }
    }

    // Línea de impacto
    ctx.fillStyle = this.hitZoneColor;
    ctx.fillRect(0, laneBottom - 15, this.width, 30);
    ctx.strokeStyle = this.hitZoneLineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, laneBottom);
    ctx.lineTo(this.width, laneBottom);
    ctx.stroke();
  }

  private renderNote(
    note: { time: number; note: number; duration: number },
    gameTime: number,
    _laneTop: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = note.time - gameTime;

    // No dibujar si muy lejos en el pasado o futuro
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    // Posición Y (arriba a abajo)
    const y = laneBottom - timeDiff * pxPerSec;

    // Tamaño según duración
    const h = Math.max(note.duration * pxPerSec, 6);

    // Posición X según la tecla
    const noteIndex = this.maxNote - note.note;
    const key = this.keyLayout[noteIndex];
    if (!key) return;

    // Centro de la tecla
    const x = key.x;
    const w = key.w;

    // Si es tecla negra, la nota es más angosta y arriba de la blanca
    const noteW = key.isBlack ? w : w * 0.85;
    const noteX = key.isBlack ? x : x + (w - noteW) / 2;

    // Opacidad según distancia
    const distFromHit = Math.abs(timeDiff);
    const alpha = Math.max(0.25, 1 - distFromHit / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    // Brillo si está cerca del hit zone
    if (distFromHit < 0.3) {
      ctx.shadowColor = this.noteColor;
      ctx.shadowBlur = 12;
    }

    // Dibujar la nota como rectángulo redondeado
    const radius = 3;
    ctx.fillStyle = this.noteColor;
    ctx.beginPath();
    ctx.moveTo(noteX + radius, y);
    ctx.lineTo(noteX + noteW - radius, y);
    ctx.quadraticCurveTo(noteX + noteW, y, noteX + noteW, y + radius);
    ctx.lineTo(noteX + noteW, y + h - radius);
    ctx.quadraticCurveTo(noteX + noteW, y + h, noteX + noteW - radius, y + h);
    ctx.lineTo(noteX + radius, y + h);
    ctx.quadraticCurveTo(noteX, y + h, noteX, y + h - radius);
    ctx.lineTo(noteX, y + radius);
    ctx.quadraticCurveTo(noteX, y, noteX + radius, y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private renderChord(
    chord: { time: number; notes: number[]; duration: number },
    gameTime: number,
    _laneTop: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = chord.time - gameTime;

    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    const y = laneBottom - timeDiff * pxPerSec;
    const h = Math.max(chord.duration * pxPerSec, 6);

    const distFromHit = Math.abs(timeDiff);
    const alpha = Math.max(0.25, 1 - distFromHit / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    if (distFromHit < 0.3) {
      ctx.shadowColor = this.chordColor;
      ctx.shadowBlur = 12;
    }

    // Dibujar cada nota del acorde como un rectángulo
    for (const midiNote of chord.notes) {
      const noteIndex = this.maxNote - midiNote;
      const key = this.keyLayout[noteIndex];
      if (!key) continue;

      const noteW = key.isBlack ? key.w : key.w * 0.85;
      const noteX = key.isBlack ? key.x : key.x + (key.w - noteW) / 2;

      const radius = 2;
      ctx.fillStyle = this.chordColor;
      ctx.beginPath();
      ctx.moveTo(noteX + radius, y);
      ctx.lineTo(noteX + noteW - radius, y);
      ctx.quadraticCurveTo(noteX + noteW, y, noteX + noteW, y + radius);
      ctx.lineTo(noteX + noteW, y + h - radius);
      ctx.quadraticCurveTo(noteX + noteW, y + h, noteX + noteW - radius, y + h);
      ctx.lineTo(noteX + radius, y + h);
      ctx.quadraticCurveTo(noteX, y + h, noteX, y + h - radius);
      ctx.lineTo(noteX, y + radius);
      ctx.quadraticCurveTo(noteX, y, noteX + radius, y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private renderKeyboard(activeNotes: Set<number>, _gameTime: number): void {
    const ctx = this.ctx;
    const kbTop = this.height - this.keyboardHeight;
    const kbH = this.keyboardHeight - 5;

    // Fondo del teclado
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, kbTop - 2, this.width, kbH + 2);

    // Línea separadora del teclado
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, kbTop);
    ctx.lineTo(this.width, kbTop);
    ctx.stroke();

    // Dibujar teclas blancas primero
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      const key = this.keyLayout[i];
      if (!key || key.isBlack) continue;

      const isActive = activeNotes.has(note);
      ctx.fillStyle = isActive ? this.whiteKeyActiveColor : this.whiteKeyColor;
      ctx.fillRect(key.x, kbTop + 2, key.w, kbH);

      ctx.strokeStyle = this.keyBorderColor;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbTop + 2, key.w, kbH);
    }

    // Dibujar teclas negras encima
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      const key = this.keyLayout[i];
      if (!key || !key.isBlack) continue;

      const isActive = activeNotes.has(note);
      ctx.fillStyle = isActive ? this.blackKeyActiveColor : this.blackKeyColor;
      ctx.fillRect(key.x, kbTop + 2, key.w, kbH * 0.6);

      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbTop + 2, key.w, kbH * 0.6);
    }

    // Si los acordes están activos, mostrar el nombre del acorde actual cerca del teclado
    // (opcional, por ahora no)
  }

  private renderHitFeedback(hitResults: { time: number; rating: string }[]): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;

    // Filtrar solo los últimos 2 segundos
    const recent = hitResults.filter(h => (now - h.time) < 2);

    for (const hit of recent) {
      const age = now - hit.time;

      const alpha = Math.max(0, 1 - age / 2);
      ctx.globalAlpha = alpha;

      const color = hit.rating === 'perfect'
        ? this.perfectColor
        : hit.rating === 'good'
          ? this.goodColor
          : this.missColor;

      ctx.fillStyle = color;
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';

      // El feedback aparece arriba del centro, y sube con el tiempo
      const floatY = this.height / 2 - 150 + age * -80;

      const label = hit.rating === 'perfect' ? '🔥 PERFECTO' : hit.rating === 'good' ? '👍 BIEN' : '❌ MISS';
      ctx.fillText(label, this.width / 2, floatY);

      const subLabel = hit.rating === 'perfect' ? '+100' : hit.rating === 'good' ? '+50' : '+0';
      ctx.font = '16px monospace';
      ctx.fillStyle = '#cccccc';
      ctx.fillText(subLabel, this.width / 2, floatY + 30);
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}