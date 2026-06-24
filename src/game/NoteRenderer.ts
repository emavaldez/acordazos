import type { ChartData, GameMode } from '../types';

/**
 * Renderiza el carril horizontal de notas en un Canvas.
 * Las notas caen de derecha a izquierda tipo Rock Band horizontal.
 *
 * Layout:
 *   - HUD arriba (título, score, combo, modo)
 *   - Carril principal (notas scrolleando horizontalmente)
 *   - Teclado de piano abajo (visual)
 */
export class NoteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  // Configuración visual
  private readonly laneTop: number = 70; // espacio para HUD
  private readonly laneBottom: number = 120; // espacio para teclado
  private readonly hitZoneX: number = 0.2; // 20% desde la izquierda
  private readonly noteScrollTime: number = 3; // segundos que tarda una nota en cruzar la pantalla

  // Rango de teclas MIDI Yamaha E333 (61 teclas)
  private readonly maxNote: number = 96; // C7
  private readonly keyCount: number = 61;

  // Colores
  private readonly bgColor = '#0a0a1a';
  private readonly laneBgColor = '#111128';
  private readonly hitZoneColor = '#ffcc0033';
  private readonly hitZoneLineColor = '#ffcc00';
  private readonly noteColor = '#00ddff';
  private readonly chordColor = '#ff66ff';
  private readonly whiteKeyColor = '#e0e0e0';
  private readonly blackKeyColor = '#333340';
  private readonly perfectColor = '#00ff88';
  private readonly goodColor = '#ffcc00';
  private readonly missColor = '#ff3355';

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
  }

  /** Renderiza un frame completo */
  render(
    chart: ChartData,
    gameTime: number,
    scoreState: { score: number; combo: number; maxCombo: number; perfects: number; goods: number; misses: number },
    mode: GameMode,
    activeNotes: Set<number>, // teclas actualmente presionadas en el MIDI
    hitResults: { time: number; rating: string }[], // últimos hits para feedback
  ): void {
    const ctx = this.ctx;

    // Limpiar
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.width, this.height);

    // HUD
    this.renderHUD(chart, scoreState, mode, gameTime);

    // Carril de notas
    this.renderLane(chart, gameTime, mode);

    // Feedback de hits recientes
    this.renderHitFeedback(hitResults);

    // Teclado de piano
    this.renderKeyboard(activeNotes);
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
    ctx.fillRect(0, 0, this.width, 65);

    // Título
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`${chart.title} - ${chart.artist}`, 20, 28);

    // Modo
    const modeLabel = mode === 'chords' ? '🎸 ACORDES' : mode === 'notes' ? '🎵 NOTAS' : '🎵🎸 AMBOS';
    ctx.font = '12px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`Modo: ${modeLabel}`, 20, 48);

    // Score
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${scoreState.score}`, this.width - 20, 30);

    // Combo
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = scoreState.combo > 10 ? '#ffcc00' : '#aaaaaa';
    ctx.fillText(`🔥 ${scoreState.combo}`, this.width - 20, 52);

    // Stats (perfects/goods/misses)
    ctx.font = '12px monospace';
    ctx.fillStyle = this.perfectColor;
    ctx.textAlign = 'left';
    ctx.fillText(`P:${scoreState.perfects}`, this.width / 2 - 80, 28);
    ctx.fillStyle = this.goodColor;
    ctx.fillText(`G:${scoreState.goods}`, this.width / 2 - 80, 48);
    ctx.fillStyle = this.missColor;
    ctx.fillText(`M:${scoreState.misses}`, this.width / 2 - 80, 68);

    // Timer
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'right';
    ctx.font = '14px monospace';
    const min = Math.floor(gameTime / 60);
    const sec = Math.floor(gameTime % 60);
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, this.width - 20, 52);

    ctx.textAlign = 'left';

    // Tiempo restante
    const remaining = Math.max(0, chart.duration - gameTime);
    const remMin = Math.floor(remaining / 60);
    const remSec = Math.floor(remaining % 60);
    ctx.fillStyle = '#555555';
    ctx.font = '12px monospace';
    ctx.fillText(`-${remMin}:${remSec.toString().padStart(2, '0')}`, this.width - 20, 68);
    ctx.textAlign = 'left';
  }

  private renderLane(chart: ChartData, gameTime: number, mode: GameMode): void {
    const ctx = this.ctx;
    const laneX = 0;
    const laneY = this.laneTop;
    const laneW = this.width;
    const laneH = this.height - this.laneTop - this.laneBottom;

    // Fondo del carril
    ctx.fillStyle = this.laneBgColor;
    ctx.fillRect(laneX, laneY, laneW, laneH);

    // Líneas de división de octavas
    const keyH = laneH / this.keyCount;
    ctx.strokeStyle = '#1e1e3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.keyCount; i++) {
      const y = laneY + i * keyH;
      // Líneas más gruesas en los C (inicio de octava)
      const note = this.maxNote - i;
      if (note % 12 === 0) {
        ctx.strokeStyle = '#2a2a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(laneX, y);
        ctx.lineTo(laneX + laneW, y);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;

    // Etiquetas de notas (C, D, E...)
    ctx.font = '9px monospace';
    ctx.fillStyle = '#555570';
    ctx.textAlign = 'right';
    for (let i = 0; i < this.keyCount; i++) {
      if (i % 12 === 0) {
        const note = this.maxNote - i;
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(note / 12) - 1;
        const idx = note % 12;
        const y = laneY + i * keyH + keyH / 2;
        ctx.fillText(`${noteNames[idx]}${octave}`, laneX + 30, y + 3);
      }
    }
    ctx.textAlign = 'left';

    // Zona de impacto
    const hitX = this.width * this.hitZoneX;
    ctx.fillStyle = this.hitZoneColor;
    ctx.fillRect(hitX - 30, laneY, 60, laneH);
    ctx.strokeStyle = this.hitZoneLineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitX, laneY);
    ctx.lineTo(hitX, laneY + laneH);
    ctx.stroke();

    // Calcular velocidad de scroll: pixeles por segundo
    const pxPerSec = (this.width - hitX) / this.noteScrollTime;

    // Renderizar notas y acordes
    if (mode === 'notes' || mode === 'both') {
      for (const note of chart.notes) {
        this.renderNote(note, gameTime, keyH, laneY, laneH, hitX, pxPerSec);
      }
    }
    if (mode === 'chords' || mode === 'both') {
      for (const chord of chart.chords) {
        this.renderChord(chord, gameTime, keyH, laneY, laneH, hitX, pxPerSec);
      }
    }
  }

  private renderNote(
    note: { time: number; note: number; duration: number },
    gameTime: number,
    keyH: number,
    laneY: number,
    _laneH: number,
    hitX: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = note.time - gameTime;

    // No dibujar notas que ya pasaron o están muy lejos en el futuro
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    // Posición X en el carril
    const x = hitX + timeDiff * pxPerSec;

    // Posición Y (invertir: nota más alta = y más arriba)
    const y = laneY + (this.maxNote - note.note) * keyH;

    // Ancho según duración
    const w = Math.max(note.duration * pxPerSec, keyH * 0.5);

    // Colorear según qué tan lejos está de la zona de impacto
    const distFromHit = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - distFromHit / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    // Sombra/brillo si está cerca del hit zone
    if (distFromHit < 0.3) {
      ctx.shadowColor = this.noteColor;
      ctx.shadowBlur = 10;
    }

    // Dibujar la nota como un rectángulo redondeado
    const h = keyH * 0.85;
    const radius = 3;
    ctx.fillStyle = this.noteColor;
    ctx.beginPath();
    ctx.moveTo(x + radius, y + (keyH - h) / 2);
    ctx.lineTo(x + w - radius, y + (keyH - h) / 2);
    ctx.quadraticCurveTo(x + w, y + (keyH - h) / 2, x + w, y + (keyH - h) / 2 + radius);
    ctx.lineTo(x + w, y + (keyH - h) / 2 + h - radius);
    ctx.quadraticCurveTo(x + w, y + (keyH - h) / 2 + h, x + w - radius, y + (keyH - h) / 2 + h);
    ctx.lineTo(x + radius, y + (keyH - h) / 2 + h);
    ctx.quadraticCurveTo(x, y + (keyH - h) / 2 + h, x, y + (keyH - h) / 2 + h - radius);
    ctx.lineTo(x, y + (keyH - h) / 2 + radius);
    ctx.quadraticCurveTo(x, y + (keyH - h) / 2, x + radius, y + (keyH - h) / 2);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private renderChord(
    chord: { time: number; notes: number[]; duration: number },
    gameTime: number,
    keyH: number,
    laneY: number,
    _laneH: number,
    hitX: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = chord.time - gameTime;

    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    const x = hitX + timeDiff * pxPerSec;
    const w = Math.max(chord.duration * pxPerSec, keyH * 0.5);

    const distFromHit = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - distFromHit / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    if (distFromHit < 0.3) {
      ctx.shadowColor = this.chordColor;
      ctx.shadowBlur = 12;
    }

    // Dibujar cada nota del acorde como un rectángulo vertical apilado
    for (const note of chord.notes) {
      const y = laneY + (this.maxNote - note) * keyH;
      const h = keyH * 0.85;
      const radius = 2;
      ctx.fillStyle = this.chordColor;
      ctx.beginPath();
      ctx.moveTo(x + radius, y + (keyH - h) / 2);
      ctx.lineTo(x + w - radius, y + (keyH - h) / 2);
      ctx.quadraticCurveTo(x + w, y + (keyH - h) / 2, x + w, y + (keyH - h) / 2 + radius);
      ctx.lineTo(x + w, y + (keyH - h) / 2 + h - radius);
      ctx.quadraticCurveTo(x + w, y + (keyH - h) / 2 + h, x + w - radius, y + (keyH - h) / 2 + h);
      ctx.lineTo(x + radius, y + (keyH - h) / 2 + h);
      ctx.quadraticCurveTo(x, y + (keyH - h) / 2 + h, x, y + (keyH - h) / 2 + h - radius);
      ctx.lineTo(x, y + (keyH - h) / 2 + radius);
      ctx.quadraticCurveTo(x, y + (keyH - h) / 2, x + radius, y + (keyH - h) / 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private renderKeyboard(activeNotes: Set<number>): void {
    const ctx = this.ctx;
    const kbY = this.height - this.laneBottom;
    const kbH = this.laneBottom - 10;
    const kbW = this.width;

    // Fondo del teclado
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, kbY, kbW, kbH);

    const keyW = kbW / this.keyCount;

    // Teclas blancas y negras
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
      const isActive = activeNotes.has(note);

      const x = i * keyW;
      const y = kbY + 5;
      const w = keyW - 1;
      const h = kbH - 10;

      if (isBlack) continue; // Las pintamos después encima

      // Tecla blanca
      ctx.fillStyle = isActive ? '#aaddff' : this.whiteKeyColor;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, w, h);
    }

    // Teclas negras (se dibujan encima, más angostas)
    const blackW = keyW * 0.6;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.maxNote - i;
      const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
      if (!isBlack) continue;

      const isActive = activeNotes.has(note);
      const x = i * keyW + keyW - blackW / 2;
      const y = kbY + 5;
      const w = blackW;
      const h = kbH * 0.6;

      ctx.fillStyle = isActive ? '#6688cc' : this.blackKeyColor;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, w, h);
    }
  }

  private renderHitFeedback(
    hitResults: { time: number; rating: string }[],
  ): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;

    for (const hit of hitResults) {
      const age = now - hit.time;
      if (age > 2) continue; // desaparece después de 2s

      const alpha = Math.max(0, 1 - age / 2);
      ctx.globalAlpha = alpha;

      const color = hit.rating === 'perfect'
        ? this.perfectColor
        : hit.rating === 'good'
          ? this.goodColor
          : this.missColor;

      ctx.fillStyle = color;
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';

      const label = hit.rating === 'perfect' ? '🔥 PERFECTO' : hit.rating === 'good' ? '👍 BIEN' : '❌ MISS';
      ctx.fillText(label, this.width / 2, this.height / 2 - 100 + (now - hit.time) * 50);
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}