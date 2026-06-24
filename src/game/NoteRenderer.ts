import type { ChartData, GameMode } from '../types';

/**
 * Renderiza notas cayendo verticalmente sobre un teclado de piano horizontal.
 * Tipo Guitar Hero con teclas de piano (de izquierda a derecha: grave→agudo).
 *
 * Layout:
 *   [ HUD ]
 *   [ NOTAS CAYENDO ↓↓↓ ]
 *   [ ████████████████ ]  ← línea de impacto
 *   [ TECLADO DE PIANO ]
 */
export class NoteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  // Configuración
  private readonly hudHeight: number = 65;
  private readonly keyboardHeight: number = 100;
  private noteScrollTime: number = 5; // segundos que tarda una nota en caer

  // Rango Yamaha E333 (61 teclas: C2=36 a C7=96)
  private readonly minNote: number = 36;
  private readonly keyCount: number = 61;

  // Teclas negras dentro de cada octava (C=0, C#=1, ..., B=11)
  private readonly blackKeyIndices = new Set([1, 3, 6, 8, 10]);

  // Colores
  private readonly bgColor = '#0a0a1a';
  private readonly laneBgColor = '#111128';
  private readonly hitZoneColor = '#ffcc0044';
  private readonly hitZoneLineColor = '#ffcc00';
  private readonly noteColor = '#00eeff';
  private readonly noteGlow = '#00eeff66';
  private readonly chordColor = '#ff66ff';
  private readonly chordGlow = '#ff66ff66';
  private readonly whiteKeyActiveColor = '#aaddff';
    private readonly blackKeyActiveColor = '#4488cc';
  private readonly perfectColor = '#00ff88';
  private readonly goodColor = '#ffcc00';
  private readonly missColor = '#ff3355';

  // Layout de teclas cacheado
  private keyLayout: { x: number; w: number; isBlack: boolean }[] = [];

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

  private get hitLineY(): number {
    return this.height - this.keyboardHeight - 15;
  }

  /** Construye el layout de teclas de IZQUIERDA (grave=C2) a DERECHA (agudo=C7) */
  private buildKeyLayout(): void {
    this.keyLayout = [];
    const totalW = this.width;

    // Contar teclas blancas
    let whiteCount = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i; // 36 → 96 (C2 → C7)
      if (!this.blackKeyIndices.has(note % 12)) whiteCount++;
    }

    const whiteKeyW = totalW / whiteCount;
    const blackKeyW = whiteKeyW * 0.6;
    let whiteIndex = 0;

    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      const isBlack = this.blackKeyIndices.has(note % 12);

      if (isBlack) {
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

  /** Cambia el tiempo de scroll (para control de velocidad) */
  setScrollTime(seconds: number): void {
    this.noteScrollTime = seconds;
  }

  /** Renderiza un frame */
  render(
    chart: ChartData,
    gameTime: number,
    scoreState: { score: number; combo: number; maxCombo: number; perfects: number; goods: number; misses: number },
    mode: GameMode,
    activeNotes: Set<number>,
    hitResults: { time: number; rating: string }[],
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.width, this.height);

    this.renderHUD(chart, scoreState, mode, gameTime);
    this.renderLane(chart, gameTime, mode);
    this.renderHitFeedback(hitResults);
    this.renderKeyboard(activeNotes);
  }

  // ─── HUD ───────────────────────────────────────────────────────────────
  private renderHUD(chart: ChartData, scoreState: { score: number; combo: number; perfects: number; goods: number; misses: number }, mode: GameMode, gameTime: number): void {
    const ctx = this.ctx;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.hudHeight);
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.hudHeight);
    ctx.lineTo(this.width, this.hudHeight);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${chart.title}`, 14, 22);

    const modeLabel = mode === 'chords' ? '🎸 ACORDES' : mode === 'notes' ? '🎵 NOTAS' : '🎵🎸 AMBOS';
    ctx.font = '10px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText(`${modeLabel} · ${chart.artist}`, 14, 44);

    // Stats
    ctx.font = '10px monospace';
    ctx.fillStyle = this.perfectColor;
    ctx.fillText(`P:${scoreState.perfects}`, this.width * 0.42, 22);
    ctx.fillStyle = this.goodColor;
    ctx.fillText(`G:${scoreState.goods}`, this.width * 0.42, 44);
    ctx.fillStyle = this.missColor;
    ctx.fillText(`M:${scoreState.misses}`, this.width * 0.42, 64);

    // Score + combo
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${scoreState.score}`, this.width - 14, 26);
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = scoreState.combo > 5 ? '#ffcc00' : '#aaa';
    ctx.fillText(`🔥 ${scoreState.combo}`, this.width - 14, 48);
    ctx.textAlign = 'left';

    // Timer
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    const min = Math.floor(gameTime / 60);
    const sec = Math.floor(gameTime % 60);
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, this.width - 14, 65);
    ctx.textAlign = 'left';
  }

  // ─── CARRIL DE NOTAS ───────────────────────────────────────────────────
  private renderLane(chart: ChartData, gameTime: number, mode: GameMode): void {
    const ctx = this.ctx;
    const laneTop = this.hudHeight;
    const laneBottom = this.hitLineY;
    const laneH = laneBottom - laneTop;

    // Fondo
    ctx.fillStyle = this.laneBgColor;
    ctx.fillRect(0, laneTop, this.width, laneH);

    // Líneas divisorias de octavas
    ctx.strokeStyle = '#1a1a30';
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      if (note % 12 === 0) {
        const key = this.keyLayout[i];
        if (!key) continue;
        ctx.strokeStyle = '#252545';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(key.x, laneTop);
        ctx.lineTo(key.x, laneBottom);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;

    // Etiquetas C en cada octava (izquierda de cada octava)
    ctx.font = '7px monospace';
    ctx.fillStyle = '#555577';
    ctx.textAlign = 'center';
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      if (note % 12 === 0) {
        const key = this.keyLayout[i];
        if (!key) continue;
        const octave = Math.floor(note / 12) - 1;
        ctx.fillText(`C${octave}`, key.x + key.w / 2, laneBottom - 4);
      }
    }

    // Velocidad de scroll (pixeles por segundo)
    const pxPerSec = laneH / this.noteScrollTime;

    // Notas
    if (mode === 'notes' || mode === 'both') {
      for (const n of chart.notes) this.renderNote(n, gameTime, laneBottom, pxPerSec);
    }
    if (mode === 'chords' || mode === 'both') {
      for (const c of chart.chords) this.renderChord(c, gameTime, laneBottom, pxPerSec);
    }

    // Línea de impacto (más visible)
    ctx.fillStyle = this.hitZoneColor;
    ctx.fillRect(0, laneBottom - 18, this.width, 36);
    ctx.strokeStyle = this.hitZoneLineColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = this.hitZoneLineColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, laneBottom);
    ctx.lineTo(this.width, laneBottom);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Renderiza una nota individual como "pastillita" */
  private renderNote(
    noteEv: { time: number; note: number; duration: number },
    gameTime: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = noteEv.time - gameTime;
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    // Posición en el carril
    const y = laneBottom - timeDiff * pxPerSec;
    const h = Math.min(Math.max(noteEv.duration * pxPerSec * 0.3, 10), 28);

    // Lookup de tecla
    const keyIdx = noteEv.note - this.minNote;
    const key = this.keyLayout[keyIdx];
    if (!key) return;

    const noteW = key.isBlack ? key.w * 0.9 : key.w * 0.8;
    const noteX = key.x + (key.w - noteW) / 2;

    // Opacidad según distancia
    const dist = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - dist / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    // Sombra/glow si está cerca del hit
    if (dist < 0.5) {
      ctx.shadowColor = this.noteGlow;
      ctx.shadowBlur = 14;
    }

    // ── Pastillita (roundRect) ──
    const radius = Math.min(noteW / 2, h / 2, 10);
    ctx.fillStyle = this.noteColor;
    ctx.beginPath();
    ctx.roundRect(noteX, y, noteW, h, radius);
    ctx.fill();

    // Borde brillante
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /** Renderiza un acorde como múltiples pastillitas del mismo color */
  private renderChord(
    chord: { time: number; notes: number[]; duration: number },
    gameTime: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const timeDiff = chord.time - gameTime;
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    const y = laneBottom - timeDiff * pxPerSec;
    const h = Math.min(Math.max(chord.duration * pxPerSec * 0.3, 12), 32);
    const dist = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - dist / this.noteScrollTime);
    ctx.globalAlpha = alpha;

    if (dist < 0.5) {
      ctx.shadowColor = this.chordGlow;
      ctx.shadowBlur = 16;
    }

    for (const midiNote of chord.notes) {
      const keyIdx = midiNote - this.minNote;
      const key = this.keyLayout[keyIdx];
      if (!key) continue;

      const noteW = key.isBlack ? key.w * 0.9 : key.w * 0.8;
      const noteX = key.x + (key.w - noteW) / 2;

      const radius = Math.min(noteW / 2, h / 2, 10);
      ctx.fillStyle = this.chordColor;
      ctx.beginPath();
      ctx.roundRect(noteX, y, noteW, h, radius);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // ─── TECLADO DE PIANO ──────────────────────────────────────────────────
  private renderKeyboard(activeNotes: Set<number>): void {
    const ctx = this.ctx;
    const kbY = this.height - this.keyboardHeight;
    const kbH = this.keyboardHeight - 5;

    // Fondo
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, kbY - 2, this.width, kbH + 2);
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, kbY);
    ctx.lineTo(this.width, kbY);
    ctx.stroke();

    // Blancas
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      const key = this.keyLayout[i];
      if (!key || key.isBlack) continue;
      const active = activeNotes.has(note);
      const even = (Math.floor((note - 36) / 7)) % 2 === 0;
      ctx.fillStyle = active ? this.whiteKeyActiveColor : even ? '#e8e8e4' : '#d4d4d0';
      ctx.fillRect(key.x, kbY + 2, key.w, kbH);
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbY + 2, key.w, kbH);
    }

    // Negras encima
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      const key = this.keyLayout[i];
      if (!key || !key.isBlack) continue;
      const active = activeNotes.has(note);
      ctx.fillStyle = active ? this.blackKeyActiveColor : '#1e1e2e';
      ctx.fillRect(key.x, kbY + 2, key.w, kbH * 0.6);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbY + 2, key.w, kbH * 0.6);

      // Brillo en teclas negras
      if (!active) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(key.x + 2, kbY + 3, key.w - 4, 3);
      }
    }
  }

  // ─── FEEDBACK DE HITS ──────────────────────────────────────────────────
  private renderHitFeedback(hitResults: { time: number; rating: string }[]): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const recent = hitResults.filter(h => (now - h.time) < 2.5);

    for (const hit of recent) {
      const age = now - hit.time;
      const alpha = Math.max(0, 1 - age / 2.5);
      ctx.globalAlpha = alpha;

      const color = hit.rating === 'perfect' ? this.perfectColor
        : hit.rating === 'good' ? this.goodColor : this.missColor;

      const floatY = this.height / 2 - 150 + age * -60;
      const label = hit.rating === 'perfect' ? '🔥 PERFECTO'
        : hit.rating === 'good' ? '👍 BIEN' : '❌ MISS';
      const sub = hit.rating === 'perfect' ? '+100' : hit.rating === 'good' ? '+50' : '+0';

      ctx.fillStyle = color;
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillText(label, this.width / 2, floatY);
      ctx.shadowBlur = 0;
      ctx.font = '14px monospace';
      ctx.fillStyle = '#ccc';
      ctx.fillText(sub, this.width / 2, floatY + 28);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}