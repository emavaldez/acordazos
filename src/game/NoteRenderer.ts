import type { ChartData, GameMode } from '../types';

/**
 * Renderiza notas cayendo verticalmente sobre un teclado de piano horizontal.
 * Estilo Guitar Hero — escenario oscuro, neones, gemas brillantes, HUD potente.
 *
 * Layout:
 *   [ STAGE / FONDO ANIMADO ]
 *   [ HUD con score, combo, multiplier, barra de canción ]
 *   [ CARRIL CON NOTAS CAYENDO ↓↓↓ ]
 *   [ LÍNEA DE IMPACTO (glowing) ]
 *   [ TECLADO DE PIANO ]
 */
export class NoteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  // Config
  private readonly hudHeight: number = 70;
  private readonly keyboardHeight: number = 100;
  private noteScrollTime: number = 5;

  // Rango Yamaha E333 (61 teclas: C2=36 a C7=96)
  private readonly minNote: number = 36;
  private readonly keyCount: number = 61;
  private readonly blackKeyIndices = new Set([1, 3, 6, 8, 10]);

  // Colores tipo Guitar Hero — neón oscuro

  // Colores para las "regiones" del carril (como los 5 botones del GH)
  private readonly laneColors = [
    { r: 0, g: 200, b: 80 },   // Green GH
    { r: 255, g: 40, b: 40 },  // Red GH
    { r: 255, g: 200, b: 0 },  // Yellow GH
    { r: 40, g: 100, b: 255 }, // Blue GH
    { r: 255, g: 120, b: 0 },  // Orange GH
  ];

  private readonly hitLineColor = '#44ddff';
  private readonly hitZoneGlow = 'rgba(68, 221, 255, 0.15)';

  private readonly perfectColor = '#00ff88';
  private readonly goodColor = '#ffdd00';
  private readonly missColor = '#ff2244';

  private readonly whiteKeyActiveColor = '#88ccff';
  private readonly blackKeyActiveColor = '#3388cc';

  // Animación de fondo
  private bgTime: number = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; r: number }[] = [];

  // Key layout cache
  private keyLayout: { x: number; w: number; isBlack: boolean }[] = [];

  // Hit particles
  private hitParticles: { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    // Inicializar partículas de fondo
    for (let i = 0; i < 30; i++) {
      this.particles.push(this.createBgParticle());
    }
  }

  private createBgParticle() {
    return {
      x: Math.random() * (this.width || 1920),
      y: Math.random() * (this.height || 1080),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.3 - 0.2,
      life: 0,
      maxLife: 300 + Math.random() * 200,
      r: 0.5 + Math.random() * 1.5,
    };
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

  private buildKeyLayout(): void {
    this.keyLayout = [];
    const totalW = this.width;

    let whiteCount = 0;
    for (let i = 0; i < this.keyCount; i++) {
      if (!this.blackKeyIndices.has((this.minNote + i) % 12)) whiteCount++;
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
    this.bgTime += 0.016; // ~60fps step

    // Fondo con gradiente animado
    this.renderBackground();

    // Carril de notas (detrás del HUD)
    this.renderLane(chart, gameTime, mode);

    // Hit feedback (flotando sobre el carril)
    this.renderHitFeedback(hitResults, gameTime);

    // HUD al frente
    this.renderHUD(chart, scoreState, mode, gameTime);

    // Teclado
    this.renderKeyboard(activeNotes);

    // Partículas de hit
    this.renderHitParticles();

    // Overlay de bordes tipo GH
    this.renderVignette();
  }

  // ─── FONDO DE ESCENARIO ──────────────────────────────────────────────
  private renderBackground(): void {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(
      this.width / 2, this.height * 0.3, 0,
      this.width / 2, this.height * 0.3, this.height * 0.8,
    );
    const pulse = Math.sin(this.bgTime * 0.5) * 0.05 + 0.15;
    grad.addColorStop(0, `rgba(30, 0, 50, ${pulse})`);
    grad.addColorStop(0.5, '#0a0015');
    grad.addColorStop(1, '#050210');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Líneas de luz de escenario (tipo GH stage lights)
    ctx.strokeStyle = 'rgba(100, 0, 200, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const x = (this.width / 12) * i + Math.sin(this.bgTime + i) * 20;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x + Math.sin(this.bgTime + i * 2) * 30, this.height * 0.7);
      ctx.stroke();
    }

    // Partículas
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life > p.maxLife || p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) {
        Object.assign(p, this.createBgParticle());
        p.x = Math.random() * this.width;
        p.y = this.height + 10;
      }
      const alpha = Math.min(1, p.life / 50) * (1 - p.life / p.maxLife) * 0.6;
      ctx.fillStyle = `rgba(180, 100, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderVignette(): void {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, this.height * 0.3,
      this.width / 2, this.height / 2, this.height * 0.85,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // ─── HUD ─────────────────────────────────────────────────────────────
  private renderHUD(
    chart: ChartData,
    scoreState: { score: number; combo: number; maxCombo: number; perfects: number; goods: number; misses: number },
    mode: GameMode,
    gameTime: number,
  ): void {
    const ctx = this.ctx;

    // Barra superior oscura con gradiente
    const hudGrad = ctx.createLinearGradient(0, 0, 0, this.hudHeight);
    hudGrad.addColorStop(0, 'rgba(10, 0, 20, 0.95)');
    hudGrad.addColorStop(1, 'rgba(10, 0, 20, 0.7)');
    ctx.fillStyle = hudGrad;
    ctx.fillRect(0, 0, this.width, this.hudHeight);

    // Línea de borde inferior del HUD
    ctx.strokeStyle = 'rgba(68, 221, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.hudHeight);
    ctx.lineTo(this.width, this.hudHeight);
    ctx.stroke();

    // Progreso de la canción (barra superior fina)
    const progress = Math.min(1, gameTime / chart.duration);
    ctx.fillStyle = `rgba(68, 221, 255, ${0.3 + Math.sin(this.bgTime * 2) * 0.1})`;
    ctx.fillRect(0, 0, this.width * progress, 3);

    // Score — grande y con sombra
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${scoreState.score}`, 14, 28);
    ctx.shadowBlur = 0;

    // Combo con efecto de fuego si es alto
    const combo = scoreState.combo;
    if (combo > 0) {
      const comboX = 14;
      const comboY = 52;

      if (combo >= 10) {
        // Brillo/glow en el combo cuando es alto
        ctx.shadowColor = combo >= 20 ? '#ff6600' : '#ffcc00';
        ctx.shadowBlur = combo >= 30 ? 20 : 12;
        ctx.fillStyle = combo >= 20 ? '#ff8800' : '#ffdd44';
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#aaaacc';
      }
      ctx.font = `bold ${combo >= 20 ? 16 : 13}px "Courier New", monospace`;
      ctx.fillText(`🔥 ${combo}`, comboX, comboY);

      // Multiplicador
      if (combo >= 10) {
        const mult = Math.min(4, 1 + Math.floor(combo / 10));
        const multX = comboX + ctx.measureText(`🔥 ${combo} `).width;
        ctx.fillStyle = `rgba(255, 200, 0, ${0.6 + Math.sin(this.bgTime * 4) * 0.4})`;
        ctx.font = `bold ${10 + mult * 2}px "Courier New", monospace`;
        ctx.fillText(`x${mult}`, multX, comboY);
      }
      ctx.shadowBlur = 0;
    }

    // Stats de precisión (derecha)
    ctx.textAlign = 'right';
    ctx.font = '10px "Courier New", monospace';
    const statY = 22;
    ctx.fillStyle = this.perfectColor;
    ctx.fillText(`P:${scoreState.perfects}`, this.width - 14, statY);
    ctx.fillStyle = this.goodColor;
    ctx.fillText(`G:${scoreState.goods}`, this.width - 14, statY + 16);
    ctx.fillStyle = this.missColor;
    ctx.fillText(`M:${scoreState.misses}`, this.width - 14, statY + 32);

    // Tiempo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px "Courier New", monospace';
    const min = Math.floor(gameTime / 60);
    const sec = Math.floor(gameTime % 60);
    const totalMin = Math.floor(chart.duration / 60);
    const totalSec = Math.floor(chart.duration % 60);
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')} / ${totalMin}:${totalSec.toString().padStart(2, '0')}`,
      this.width - 14, statY + 52);

    ctx.textAlign = 'left';

    // Info de canción (centro)
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText(chart.title, this.width / 2, 20);

    const modeLabel = mode === 'chords' ? '🎸 ACORDES' : mode === 'notes' ? '🎵 NOTAS' : '🎸🎵 AMBOS';
    ctx.fillStyle = 'rgba(150,150,200,0.5)';
    ctx.font = '9px "Courier New", monospace';
    ctx.fillText(`${modeLabel} · ${chart.artist}`, this.width / 2, 38);

    // Rock meter (barra de vida)
    const rockPct = Math.max(0, Math.min(1,
      (scoreState.perfects * 2 + scoreState.goods) /
      Math.max(1, (scoreState.perfects + scoreState.goods + scoreState.misses) * 2)
    ));
    const meterX = this.width / 2 - 60;
    const meterY = 46;
    const meterW = 120;
    const meterH = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.roundRect(meterX, meterY, meterW, meterH, 4);
    ctx.fill();

    const meterColor = rockPct > 0.6 ? '#00ff88' : rockPct > 0.3 ? '#ffdd00' : '#ff3355';
    ctx.fillStyle = meterColor;
    ctx.shadowColor = meterColor;
    ctx.shadowBlur = 8;
    ctx.roundRect(meterX + 1, meterY + 1, (meterW - 2) * rockPct, meterH - 2, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
  }

  // ─── CARRIL DE NOTAS ───────────────────────────────────────────────
  private renderLane(chart: ChartData, gameTime: number, mode: GameMode): void {
    const ctx = this.ctx;
    const laneTop = this.hudHeight;
    const laneBottom = this.hitLineY;
    const laneH = laneBottom - laneTop;

    // Fondo del carril con gradiente
    const laneGrad = ctx.createLinearGradient(0, laneTop, 0, laneBottom);
    laneGrad.addColorStop(0, 'rgba(10, 5, 30, 0.9)');
    laneGrad.addColorStop(0.5, 'rgba(15, 8, 35, 0.95)');
    laneGrad.addColorStop(1, 'rgba(20, 10, 40, 1)');
    ctx.fillStyle = laneGrad;
    ctx.fillRect(0, laneTop, this.width, laneH);

    // Pistas de colores (como los 5 botones de GH) basadas en octavas
    const regionCount = 5;
    const regionW = this.width / regionCount;
    for (let i = 0; i < regionCount; i++) {
      const c = this.laneColors[i];
      const pulse = Math.sin(this.bgTime * 0.3 + i * 1.2) * 0.15 + 0.85;
      ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${0.015 * pulse})`;
      ctx.fillRect(i * regionW, laneTop, regionW, laneH);

      // Línea divisoria vertical tenue
      if (i > 0) {
        ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.08)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(i * regionW, laneTop);
        ctx.lineTo(i * regionW, laneBottom);
        ctx.stroke();
      }
    }

    // Líneas divisorias de octavas
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      if (note % 12 === 0) {
        const key = this.keyLayout[i];
        if (!key) continue;
        ctx.strokeStyle = 'rgba(68, 221, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(key.x, laneTop);
        ctx.lineTo(key.x, laneBottom);
        ctx.stroke();
      }
    }

    // Etiquetas de octava (más sutiles)
    ctx.font = '7px "Courier New", monospace';
    ctx.fillStyle = 'rgba(80, 80, 120, 0.4)';
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

    // Velocidad scroll
    const pxPerSec = laneH / this.noteScrollTime;

    if (mode === 'notes' || mode === 'both') {
      for (const n of chart.notes) this.renderNote(n, gameTime, laneBottom, pxPerSec);
    }
    if (mode === 'chords' || mode === 'both') {
      for (const c of chart.chords) this.renderChord(c, gameTime, laneBottom, pxPerSec);
    }

    // Línea de impacto — estilo GH
    const hitZoneY = laneBottom;
    ctx.shadowColor = this.hitLineColor;
    ctx.shadowBlur = 20;
    ctx.fillStyle = this.hitZoneGlow;
    ctx.fillRect(0, hitZoneY - 15, this.width, 30);
    ctx.shadowBlur = 0;

    // Línea principal
    ctx.strokeStyle = this.hitLineColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = this.hitLineColor;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(0, hitZoneY);
    ctx.lineTo(this.width, hitZoneY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Línea secundaria más arriba
    ctx.strokeStyle = `rgba(68, 221, 255, 0.15)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, hitZoneY - 30);
    ctx.lineTo(this.width, hitZoneY - 30);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Renderiza una gema individual en una posición y color dados */
  private renderGem(
    x: number, y: number, w: number, h: number,
    color: { r: number; g: number; b: number },
    alpha: number,
    dist: number,
  ): void {
    const ctx = this.ctx;
    const radius = Math.min(w / 2, h / 2, 8);
    ctx.globalAlpha = alpha;

    if (dist < 0.4) {
      ctx.shadowColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.shadowBlur = 18;
    }

    const gemGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    gemGrad.addColorStop(0, `rgba(${Math.min(255, color.r + 100)}, ${Math.min(255, color.g + 100)}, ${Math.min(255, color.b + 100)}, 1)`);
    gemGrad.addColorStop(0.5, `rgb(${color.r}, ${color.g}, ${color.b})`);
    gemGrad.addColorStop(1, `rgba(${Math.max(0, color.r - 50)}, ${Math.max(0, color.g - 50)}, ${Math.max(0, color.b - 50)}, 1)`);
    ctx.fillStyle = gemGrad;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();

    // Brillo superior (specular)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * alpha})`;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, w * 0.4, h * 0.3, 2);
    ctx.fill();

    // Borde
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /** Renderiza una nota como gema brillante */
  private renderNote(
    noteEv: { time: number; note: number; duration: number },
    gameTime: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const timeDiff = noteEv.time - gameTime;
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    const y = laneBottom - timeDiff * pxPerSec;
    const h = Math.min(Math.max(noteEv.duration * pxPerSec * 0.3, 12), 30);

    const keyIdx = noteEv.note - this.minNote;
    const key = this.keyLayout[keyIdx];
    if (!key) return;

    const noteW = key.isBlack ? key.w * 0.85 : key.w * 0.75;
    const noteX = key.x + (key.w - noteW) / 2;
    const dist = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - dist / this.noteScrollTime);

    // Color por región (como GH: 5 colores según octava)
    const region = Math.floor((noteEv.note - this.minNote) / (this.keyCount / 5));
    const lc = this.laneColors[Math.min(region, 4)];

    this.renderGem(noteX, y, noteW, h, lc, alpha, dist);
  }

  /** Renderiza un acorde — cada nota del acorde usa renderGem con color acorde */
  private renderChord(
    chord: { time: number; notes: number[]; duration: number },
    gameTime: number,
    laneBottom: number,
    pxPerSec: number,
  ): void {
    const timeDiff = chord.time - gameTime;
    if (timeDiff < -0.5 || timeDiff > this.noteScrollTime + 0.5) return;

    const y = laneBottom - timeDiff * pxPerSec;
    const h = Math.min(Math.max(chord.duration * pxPerSec * 0.3, 14), 34);
    const dist = Math.abs(timeDiff);
    const alpha = Math.max(0.3, 1 - dist / this.noteScrollTime);

    // Color acorde: púrpura/magenta vibrante
    const chordColor = { r: 200, g: 70, b: 255 };

    for (const midiNote of chord.notes) {
      const keyIdx = midiNote - this.minNote;
      const key = this.keyLayout[keyIdx];
      if (!key) continue;

      const noteW = key.isBlack ? key.w * 0.85 : key.w * 0.75;
      const noteX = key.x + (key.w - noteW) / 2;

      this.renderGem(noteX, y, noteW, h, chordColor, alpha, dist);
    }
  }

  // ─── TECLADO DE PIANO ──────────────────────────────────────────────
  private renderKeyboard(activeNotes: Set<number>): void {
    const ctx = this.ctx;
    const kbY = this.height - this.keyboardHeight;
    const kbH = this.keyboardHeight - 5;

    // Fondo con gradiente
    const kbGrad = ctx.createLinearGradient(0, kbY, 0, kbY + kbH);
    kbGrad.addColorStop(0, 'rgba(20, 10, 30, 0.95)');
    kbGrad.addColorStop(1, 'rgba(10, 5, 20, 0.98)');
    ctx.fillStyle = kbGrad;
    ctx.fillRect(0, kbY - 2, this.width, kbH + 2);

    // Línea de separación
    ctx.strokeStyle = 'rgba(68, 221, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, kbY);
    ctx.lineTo(this.width, kbY);
    ctx.stroke();

    // Teclas blancas
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      const key = this.keyLayout[i];
      if (!key || key.isBlack) continue;
      const active = activeNotes.has(note);
      const even = (Math.floor((note - 36) / 7)) % 2 === 0;
      ctx.fillStyle = active
        ? this.whiteKeyActiveColor
        : even ? '#e8e8e2' : '#d0d0cc';
      ctx.fillRect(key.x, kbY + 2, key.w, kbH);

      // Borde de tecla
      ctx.strokeStyle = active ? 'rgba(68, 221, 255, 0.6)' : 'rgba(150, 150, 150, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbY + 2, key.w, kbH);

      // Glow si activa
      if (active) {
        ctx.shadowColor = this.whiteKeyActiveColor;
        ctx.shadowBlur = 12;
        ctx.fillStyle = `rgba(68, 221, 255, 0.15)`;
        ctx.fillRect(key.x - 2, kbY + 2, key.w + 4, kbH);
        ctx.shadowBlur = 0;
      }
    }

    // Teclas negras encima
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.minNote + i;
      const key = this.keyLayout[i];
      if (!key || !key.isBlack) continue;
      const active = activeNotes.has(note);
      ctx.fillStyle = active ? this.blackKeyActiveColor : '#1a1a28';
      ctx.fillRect(key.x, kbY + 2, key.w, kbH * 0.6);

      ctx.strokeStyle = active ? 'rgba(68, 221, 255, 0.5)' : 'rgba(20, 20, 30, 0.8)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, kbY + 2, key.w, kbH * 0.6);

      // Brillo superior en teclas negras
      if (!active) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(key.x + 2, kbY + 3, key.w - 4, 2);
      }

      if (active) {
        ctx.shadowColor = this.blackKeyActiveColor;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgba(68, 100, 200, 0.2)`;
        ctx.fillRect(key.x - 2, kbY + 2, key.w + 4, kbH * 0.6);
        ctx.shadowBlur = 0;
      }
    }
  }

  // ─── FEEDBACK DE HITS ──────────────────────────────────────────────
  private renderHitFeedback(hitResults: { time: number; rating: string }[], _gameTime: number): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const recent = hitResults.filter(h => (now - h.time) < 2.0);

    for (const hit of recent) {
      const age = now - hit.time;
      const alpha = Math.max(0, 1 - age / 2.0);

      const isPerfect = hit.rating === 'perfect';
      const isGood = hit.rating === 'good';
      const color = isPerfect ? this.perfectColor : isGood ? this.goodColor : this.missColor;

      const floatY = this.hitLineY - 60 + age * -50;

      // Texto flotante grande como en Guitar Hero
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';

      let label: string;
      let subtext: string;

      if (isPerfect) {
        label = '🔥 PERFECTO';
        subtext = '+100';
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        ctx.font = 'bold 32px "Courier New", monospace';
        ctx.fillStyle = color;
        ctx.fillText(label, this.width / 2, floatY);
        ctx.shadowBlur = 10;
        ctx.font = '16px "Courier New", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(subtext, this.width / 2, floatY + 28);

        // Partículas en perfect
        if (age < 0.3) {
          this.spawnHitParticles(this.width / 2 + (Math.random() - 0.5) * 100, floatY, color);
        }
      } else if (isGood) {
        label = '👍 BIEN';
        subtext = '+50';
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.font = 'bold 26px "Courier New", monospace';
        ctx.fillStyle = color;
        ctx.fillText(label, this.width / 2, floatY);
        ctx.shadowBlur = 0;
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = '#ddd';
        ctx.fillText(subtext, this.width / 2, floatY + 26);
      } else {
        label = '✗ MISS';
        ctx.font = 'bold 24px "Courier New", monospace';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillText(label, this.width / 2, floatY);
        ctx.shadowBlur = 0;
      }

      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  // ─── PARTÍCULAS ────────────────────────────────────────────────────
  private spawnHitParticles(x: number, y: number, color: string): void {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.hitParticles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 30 + Math.random() * 20,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private renderHitParticles(): void {
    const ctx = this.ctx;
    const alive: typeof this.hitParticles = [];

    for (const p of this.hitParticles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
      p.life--;

      if (p.life <= 0) continue;
      alive.push(p);

      const alpha = p.life / 50;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    this.hitParticles = alive;
  }
}