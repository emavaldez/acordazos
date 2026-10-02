import type { Part, PlayNote } from '../types';
import { KeyboardLayout, type KeyRect } from './KeyboardLayout';
import { isBlack, noteName, MIDDLE_C, KEYBOARD_MIN, KEYBOARD_MAX, type NoteNaming } from '../music/notes';
import { theme } from '../theme';

export type NoteState = 'pending' | 'hit' | 'missed';

/** Nota con su estado durante la partida. */
export interface LiveNote extends PlayNote {
  state: NoteState;
  /** Nota larga apretada en este momento */
  holding: boolean;
  /** Si se soltó antes de tiempo, momento (de canción) en que se soltó */
  releasedAt: number | null;
}

export interface Frame {
  songTime: number;
  tempo: number;
  beat: number;
  notes: LiveNote[];
  /** Teclas apretadas: parte que se acertó o null si no correspondía ninguna */
  pressed: Map<number, Part | null>;
  /** Teclas que hay que tocar (o sostener) ahora */
  guide: Map<number, Part>;
  /** Segundos esperando en modo práctica (0 si no espera) */
  waiting: number;
  countIn: { label: string; phase: number } | null;
  naming: NoteNaming;
}

type Rating = 'perfect' | 'good' | 'miss';

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }

const pc = (n: number) => ((n % 12) + 12) % 12;

/** Alto del HUD (HTML) arriba de la pista. Tiene que coincidir con --hud-h en style.css. */
export const LANE_TOP = 72;

/**
 * Dibuja el carril: pared LED, guías por tecla, líneas de compás, píldoras,
 * marquesina de bombitas (línea de impacto) y el teclado.
 */
export class NoteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;

  private range: [number, number] = [KEYBOARD_MIN, KEYBOARD_MAX];
  private layout: KeyboardLayout = new KeyboardLayout(KEYBOARD_MIN, KEYBOARD_MAX, 1000);
  private fallTime = 2.4;

  private ledMask: HTMLCanvasElement = document.createElement('canvas');
  private ledTint: HTMLCanvasElement = document.createElement('canvas');

  private sparks: Spark[] = [];
  private judgements = new Map<number, { rating: Rating; born: number }>();
  private beams = new Map<number, { part: Part; born: number; good: boolean }>();
  private announcement: { text: string; color: string; born: number } | null = null;
  private lastNow = performance.now() / 1000;
  private frame = 0;
  private reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  // ─── Configuración ──────────────────────────────────────────────────
  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.layout = new KeyboardLayout(this.range[0], this.range[1], this.W);
    this.buildLedMask();
    this.frame = 0;
  }

  setRange(low: number, high: number): void {
    this.range = [low, high];
    this.layout = new KeyboardLayout(low, high, this.W);
  }

  /** Segundos reales que tarda una nota en caer hasta la línea. */
  setFallTime(seconds: number): void {
    this.fallTime = seconds;
  }

  get isFullKeyboard(): boolean {
    return this.range[0] === KEYBOARD_MIN && this.range[1] === KEYBOARD_MAX;
  }

  private get kbH(): number {
    return Math.max(96, Math.min(this.layout.whiteW * 4, 200, this.H * 0.24));
  }

  private get hitY(): number {
    return this.H - this.kbH - 8;
  }

  // ─── Eventos visuales ───────────────────────────────────────────────
  flash(note: number, rating: Rating, part: Part): void {
    const now = performance.now() / 1000;
    this.judgements.set(note, { rating, born: now });
    if (rating === 'miss') return;
    this.beams.set(note, { part, born: now, good: rating === 'good' });
    const key = this.layout.get(note);
    if (!key) return;
    const c = theme.part[part];
    const cx = key.x + key.w / 2;
    const n = rating === 'perfect' ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const sp = 140 + Math.random() * 260;
      this.sparks.push({
        x: cx + (Math.random() - 0.5) * key.w * 0.6,
        y: this.hitY,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.35 + Math.random() * 0.35,
        color: Math.random() < 0.35 ? theme.amberHot : c.light,
        size: 1.5 + Math.random() * 2.2,
      });
    }
  }

  announce(text: string, color: string = theme.amber): void {
    this.announcement = { text, color, born: performance.now() / 1000 };
  }

  clearEffects(): void {
    this.sparks = [];
    this.judgements.clear();
    this.beams.clear();
    this.announcement = null;
  }

  // ─── Frame ──────────────────────────────────────────────────────────
  render(f: Frame): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - this.lastNow);
    this.lastNow = now;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const hitY = this.hitY;
    const pps = (hitY - LANE_TOP) / (this.fallTime * f.tempo); // píxeles por segundo de canción
    const beatPhase = f.songTime >= -8 ? ((f.songTime / f.beat) % 1 + 1) % 1 : 0;
    const beatPulse = Math.exp(-beatPhase * 5);

    this.drawBackdrop(now, beatPulse, hitY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, LANE_TOP, this.W, this.H - LANE_TOP);
    ctx.clip();
    this.drawKeyLanes(hitY, f);
    this.drawBeatLines(f, hitY, pps);
    this.drawNotes(f, hitY, pps);
    this.drawBeams(now, hitY);
    this.drawMarquee(now, beatPulse, hitY);
    this.drawKeyboard(f, hitY);
    this.drawSparks(dt);
    this.drawJudgements(now, hitY);
    this.drawOverlays(f, now, hitY);
    ctx.restore();
  }

  // ─── Fondo: pared LED de bailanta ───────────────────────────────────
  private buildLedMask(): void {
    const w = Math.max(1, Math.ceil(this.W));
    const h = Math.max(1, Math.ceil(this.H));
    this.ledMask.width = w;
    this.ledMask.height = h;
    this.ledTint.width = w;
    this.ledTint.height = h;
    const m = this.ledMask.getContext('2d')!;
    m.clearRect(0, 0, w, h);
    m.fillStyle = '#fff';
    const pitch = 11;
    for (let y = pitch / 2; y < h; y += pitch) {
      for (let x = pitch / 2; x < w; x += pitch) {
        m.beginPath();
        m.arc(x, y, 1.6, 0, Math.PI * 2);
        m.fill();
      }
    }
  }

  private drawBackdrop(now: number, pulse: number, hitY: number): void {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.fillStyle = theme.night;
    ctx.fillRect(0, 0, W, H);

    // Manchas de color que se mueven por la pared LED. Se mueven lento,
    // así que alcanza con recalcularlas cada 3 frames.
    if (this.frame++ % 3 === 0) {
      const tt = this.reducedMotion ? 0 : now;
      const t = this.ledTint.getContext('2d')!;
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, W, H);
      const blobs: [number, number, number, string][] = [
        [0.22 + Math.sin(tt * 0.21) * 0.18, 0.25 + Math.cos(tt * 0.17) * 0.12, 0.55, '255, 63, 160'],
        [0.78 + Math.cos(tt * 0.19) * 0.16, 0.3 + Math.sin(tt * 0.23) * 0.14, 0.5, '46, 230, 255'],
        [0.5 + Math.sin(tt * 0.13) * 0.3, 0.05 + Math.cos(tt * 0.11) * 0.05, 0.45, '255, 194, 58'],
      ];
      for (const [bx, by, br, rgb] of blobs) {
        const g = t.createRadialGradient(bx * W, by * H, 0, bx * W, by * H, br * Math.max(W, H));
        g.addColorStop(0, `rgba(${rgb}, 1)`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        t.fillStyle = g;
        t.fillRect(0, 0, W, H);
      }
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(this.ledMask, 0, 0);
    }

    ctx.globalAlpha = 0.34 + pulse * 0.16;
    ctx.drawImage(this.ledTint, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // Vidrio oscuro sobre la pista: más transparente arriba, más denso cerca de la línea
    const g = ctx.createLinearGradient(0, 0, 0, hitY);
    g.addColorStop(0, 'rgba(12, 4, 24, 0.5)');
    g.addColorStop(0.55, 'rgba(12, 4, 24, 0.74)');
    g.addColorStop(1, 'rgba(12, 4, 24, 0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hitY);
  }

  // ─── Guías por tecla ────────────────────────────────────────────────
  private drawKeyLanes(hitY: number, f: Frame): void {
    const ctx = this.ctx;
    for (const k of this.layout.keys) {
      if (k.isBlack) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
        ctx.fillRect(k.x, 0, k.w, hitY);
      }
      const part = f.guide.get(k.note);
      if (part) {
        const g = ctx.createLinearGradient(0, hitY - 220, 0, hitY);
        g.addColorStop(0, `rgba(${theme.part[part].glow}, 0)`);
        g.addColorStop(1, `rgba(${theme.part[part].glow}, 0.13)`);
        ctx.fillStyle = g;
        ctx.fillRect(k.x, hitY - 220, k.w, 220);
      }
    }
    for (const k of this.layout.keys) {
      if (k.isBlack || k.note === this.layout.low) continue;
      const p = pc(k.note);
      ctx.fillStyle = p === 0 ? 'rgba(185, 162, 255, 0.2)' : p === 5 ? 'rgba(185, 162, 255, 0.11)' : 'rgba(185, 162, 255, 0.05)';
      ctx.fillRect(Math.round(k.x) - 0.5, 0, 1, hitY);
    }
  }

  private drawBeatLines(f: Frame, hitY: number, pps: number): void {
    const ctx = this.ctx;
    const first = Math.ceil(Math.max(0, f.songTime - 0.2) / f.beat);
    const last = Math.floor((f.songTime + (hitY - LANE_TOP) / pps) / f.beat);
    ctx.font = `600 10px ${theme.font.ui}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let b = first; b <= last; b++) {
      const t = b * f.beat;
      const y = Math.round(hitY - (t - f.songTime) * pps) + 0.5;
      if (y > hitY - 2) continue;
      const bar = b % 4 === 0;
      ctx.fillStyle = bar ? 'rgba(185, 162, 255, 0.2)' : 'rgba(185, 162, 255, 0.07)';
      ctx.fillRect(0, y, this.W, 1);
      if (bar) {
        ctx.fillStyle = 'rgba(185, 162, 255, 0.45)';
        ctx.fillText(`${b / 4 + 1}`, 6, y - 3);
      }
    }
  }

  // ─── Píldoras ───────────────────────────────────────────────────────
  private drawNotes(f: Frame, hitY: number, pps: number): void {
    const notes = f.notes;
    // Búsqueda binaria del primer candidato (las notas vienen ordenadas por tiempo)
    let lo = 0;
    let hi = notes.length;
    const from = f.songTime - 4;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < from) lo = mid + 1;
      else hi = mid;
    }
    const horizon = f.songTime + (hitY - LANE_TOP) / pps + 0.2;
    const whites: LiveNote[] = [];
    const blacks: LiveNote[] = [];
    for (let i = lo; i < notes.length; i++) {
      const n = notes[i];
      if (n.time > horizon) break;
      if (n.time + n.duration < f.songTime - 1) continue;
      if (n.state === 'hit' && !n.isLong) continue;
      (isBlack(n.note) ? blacks : whites).push(n);
    }
    for (const n of whites) this.drawNote(n, f, hitY, pps);
    for (const n of blacks) this.drawNote(n, f, hitY, pps);
  }

  private drawNote(n: LiveNote, f: Frame, hitY: number, pps: number): void {
    const key = this.layout.get(n.note);
    if (!key) return;
    const yHead = hitY - (n.time - f.songTime) * pps;
    const yTail = hitY - (n.time + n.duration - f.songTime) * pps;
    const w = key.isBlack ? key.w * 0.92 : key.w * 0.8;
    const x = key.x + (key.w - w) / 2;
    const colors = theme.part[n.part];
    const fill = key.isBlack ? colors.black : colors.white;
    const gap = 3;

    if (n.state === 'hit') {
      // Nota larga ya tocada: queda la cola por encima de la línea
      const top = yTail + gap / 2;
      const bottom = Math.min(hitY, yHead);
      if (bottom - top < 2) return;
      const ctx = this.ctx;
      const r = Math.min(w / 2, 8);
      if (n.holding) {
        ctx.fillStyle = `rgba(${colors.glow}, 0.25)`;
        this.rr(x - 5, top - 5, w + 10, bottom - top + 10, r + 5);
        ctx.fill();
        ctx.fillStyle = fill;
        this.rr(x, top, w, bottom - top, r);
        ctx.fill();
        ctx.fillStyle = colors.light;
        ctx.fillRect(x + w / 2 - 2, top + 3, 4, Math.max(0, bottom - top - 3));
        if (Math.random() < 0.6) {
          this.sparks.push({
            x: key.x + key.w / 2 + (Math.random() - 0.5) * w * 0.5, y: hitY, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 140,
            life: 0, max: 0.3 + Math.random() * 0.2, color: Math.random() < 0.5 ? colors.light : theme.amberHot, size: 1.2 + Math.random() * 1.5,
          });
        }
      } else {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = fill;
        this.rr(x, top, w, bottom - top, r);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }

    const top = yTail + gap / 2;
    const height = Math.max(yHead - top - gap / 2, Math.min(w * 1.05, 24));
    const missed = n.state === 'missed';
    const near = !missed && n.time - f.songTime < 0.3 * f.tempo;
    this.drawPill(x, yHead - height, w, height, {
      fill: missed ? theme.missGray : fill,
      rim: missed ? '#5a4b6e' : key.isBlack ? colors.white : colors.light,
      glow: near ? colors.glow : null,
      long: n.isLong,
      darkKey: key.isBlack,
      label: missed ? '' : noteName(n.note, f.naming),
      alpha: missed ? Math.max(0.15, 0.75 - Math.max(0, yHead - hitY) / 140) : 1,
    });
  }

  private drawPill(
    x: number, y: number, w: number, h: number,
    o: { fill: string; rim: string; glow: string | null; long: boolean; darkKey: boolean; label: string; alpha: number },
  ): void {
    const ctx = this.ctx;
    const r = Math.min(w / 2, 9);
    const cap = Math.min(h, Math.max(18, w * 0.85));
    ctx.globalAlpha = o.alpha;

    if (o.glow) {
      ctx.fillStyle = `rgba(${o.glow}, 0.22)`;
      this.rr(x - 5, y - 5, w + 10, h + 10, r + 5);
      ctx.fill();
    }
    // Contorno oscuro: separa píldoras vecinas
    ctx.fillStyle = theme.nightDeep;
    this.rr(x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5);
    ctx.fill();

    if (o.long && h > cap + 4) {
      // Cuerpo translúcido + hilo central: "esta se sostiene"
      ctx.globalAlpha = o.alpha * 0.42;
      ctx.fillStyle = o.fill;
      this.rr(x, y, w, h, r);
      ctx.fill();
      ctx.globalAlpha = o.alpha;
      ctx.fillStyle = o.rim;
      ctx.fillRect(x + w / 2 - 1.5, y + 4, 3, h - cap - 2);
      ctx.strokeStyle = o.rim;
      ctx.lineWidth = 1.5;
      this.rr(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
      ctx.stroke();
    }

    // Cabeza: el momento de tocar
    const capY = y + h - cap;
    ctx.fillStyle = o.fill;
    this.rr(x, capY, w, cap, r);
    ctx.fill();
    // Brillo superior + borde
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    this.rr(x + 3, capY + 2.5, w - 6, Math.min(4, cap * 0.2), 2);
    ctx.fill();
    ctx.strokeStyle = o.rim;
    ctx.lineWidth = o.darkKey ? 2 : 1.25;
    this.rr(x + 0.75, capY + 0.75, w - 1.5, cap - 1.5, r);
    ctx.stroke();

    if (o.label && w >= 15) {
      const size = Math.max(9, Math.min(15, w * 0.34));
      ctx.font = `700 ${size}px ${theme.font.ui}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = o.darkKey ? '#ffffff' : '#1b0a2b';
      ctx.fillText(o.label, x + w / 2, capY + cap / 2 + 1, w - 4);
    }
    ctx.globalAlpha = 1;
  }

  // ─── Línea de impacto: marquesina de bombitas ───────────────────────
  private drawMarquee(now: number, pulse: number, hitY: number): void {
    const ctx = this.ctx;
    const W = this.W;
    ctx.fillStyle = 'rgba(8, 2, 16, 0.92)';
    ctx.fillRect(0, hitY - 4, W, 12);

    // Línea con glow
    ctx.fillStyle = `rgba(255, 194, 58, ${0.12 + pulse * 0.12})`;
    ctx.fillRect(0, hitY - 6, W, 8);
    ctx.fillStyle = theme.amber;
    ctx.fillRect(0, hitY - 1, W, 2);

    // Bombitas con chaser
    const spacing = 14;
    const step = this.reducedMotion ? 0 : Math.floor(now * 7);
    const lit: [number, number][] = [];
    for (const [note, b] of this.beams) {
      const age = now - b.born;
      const k = this.layout.get(note);
      if (k && age < 0.35) lit.push([k.x, k.x + k.w]);
    }
    for (let i = 0, x = spacing / 2; x < W; i++, x += spacing) {
      const on = (i + step) % 4 === 0;
      const hot = lit.some(([a, b]) => x >= a && x <= b);
      const y = hitY + 4;
      if (hot) {
        ctx.fillStyle = 'rgba(255, 241, 196, 0.35)';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hot ? theme.amberHot : on ? theme.amber : `rgba(255, 194, 58, ${0.32 + pulse * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, hot ? 2.6 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBeams(now: number, hitY: number): void {
    const ctx = this.ctx;
    for (const [note, b] of this.beams) {
      const age = now - b.born;
      if (age > 0.4) { this.beams.delete(note); continue; }
      const k = this.layout.get(note);
      if (!k) continue;
      const a = (1 - age / 0.4) * 0.55;
      const h = 170;
      const g = ctx.createLinearGradient(0, hitY - h, 0, hitY);
      const rgb = b.good ? '185, 162, 255' : theme.part[b.part].glow;
      g.addColorStop(0, `rgba(${rgb}, 0)`);
      g.addColorStop(1, `rgba(${rgb}, ${a})`);
      ctx.fillStyle = g;
      const spread = 6 * (1 - age / 0.4);
      ctx.fillRect(k.x - spread, hitY - h, k.w + spread * 2, h);
    }
  }

  // ─── Teclado ────────────────────────────────────────────────────────
  private drawKeyboard(f: Frame, hitY: number): void {
    const ctx = this.ctx;
    const top = hitY + 8;
    const h = this.H - top;
    ctx.fillStyle = '#07020e';
    ctx.fillRect(0, top, this.W, h);

    for (const k of this.layout.keys) if (!k.isBlack) this.drawWhiteKey(k, top, h, f);
    for (const k of this.layout.keys) if (k.isBlack) this.drawBlackKey(k, top, h * 0.62, f);

    // Sombra del borde superior (el teclado "entra" bajo la marquesina)
    const g = ctx.createLinearGradient(0, top, 0, top + 10);
    g.addColorStop(0, 'rgba(7, 2, 14, 0.75)');
    g.addColorStop(1, 'rgba(7, 2, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, this.W, 10);
  }

  private drawWhiteKey(k: KeyRect, top: number, h: number, f: Frame): void {
    const ctx = this.ctx;
    const pressed = f.pressed.has(k.note);
    const pressedPart = f.pressed.get(k.note) ?? null;
    const guide = f.guide.get(k.note);
    const x = k.x + 1;
    const w = k.w - 2;
    const depth = pressed ? 2 : 0;

    const g = ctx.createLinearGradient(0, top, 0, top + h);
    if (pressed && pressedPart) {
      g.addColorStop(0, theme.part[pressedPart].light);
      g.addColorStop(1, theme.part[pressedPart].white);
    } else if (pressed) {
      g.addColorStop(0, '#d9cceb');
      g.addColorStop(1, '#bfaed6');
    } else {
      g.addColorStop(0, '#fbf6ff');
      g.addColorStop(0.85, '#eee5f7');
      g.addColorStop(1, '#d9cde6');
    }
    ctx.fillStyle = g;
    this.rrBottom(x, top + depth, w, h - 3 - depth, Math.min(6, w * 0.15));
    ctx.fill();

    if (guide && !pressed) {
      ctx.fillStyle = `rgba(${theme.part[guide].glow}, 0.38)`;
      this.rrBottom(x, top, w, h - 3, Math.min(6, w * 0.15));
      ctx.fill();
      ctx.fillStyle = theme.part[guide].white;
      ctx.fillRect(x, top, w, 4);
    }

    // Nombre de la nota
    if (f.naming !== 'none' && w >= 14) {
      const label = noteName(k.note, f.naming);
      const size = Math.max(9, Math.min(14, w * 0.3));
      ctx.font = `${pc(k.note) === 0 ? 800 : 600} ${size}px ${theme.font.ui}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = pressed ? '#2a1640' : pc(k.note) === 0 ? '#4a3463' : '#8a78a3';
      ctx.fillText(label, x + w / 2, top + h - 12 + depth, w - 2);
    }
    if (k.note === MIDDLE_C) {
      ctx.fillStyle = theme.amber;
      ctx.beginPath();
      ctx.arc(x + w / 2, top + h - 12 - Math.max(9, Math.min(14, w * 0.3)) - 6 + depth, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBlackKey(k: KeyRect, top: number, h: number, f: Frame): void {
    const ctx = this.ctx;
    const pressed = f.pressed.has(k.note);
    const pressedPart = f.pressed.get(k.note) ?? null;
    const guide = f.guide.get(k.note);
    const depth = pressed ? 2 : 0;

    const g = ctx.createLinearGradient(0, top, 0, top + h);
    if (pressed && pressedPart) {
      g.addColorStop(0, theme.part[pressedPart].white);
      g.addColorStop(1, theme.part[pressedPart].black);
    } else if (pressed) {
      g.addColorStop(0, '#4b3a60');
      g.addColorStop(1, '#2c2040');
    } else if (guide) {
      g.addColorStop(0, theme.part[guide].black);
      g.addColorStop(1, '#1d1230');
    } else {
      g.addColorStop(0, '#2c1f3d');
      g.addColorStop(1, '#130a1f');
    }
    ctx.fillStyle = '#05010a';
    this.rrBottom(k.x - 1, top, k.w + 2, h + 1, 4);
    ctx.fill();
    ctx.fillStyle = g;
    this.rrBottom(k.x, top + depth, k.w, h - depth - 2, 3.5);
    ctx.fill();
    // Bisel
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)';
    ctx.fillRect(k.x + 2, top + h - 10 + depth, k.w - 4, 3);
  }

  // ─── Efectos ────────────────────────────────────────────────────────
  private drawSparks(dt: number): void {
    const ctx = this.ctx;
    const alive: Spark[] = [];
    for (const s of this.sparks) {
      s.life += dt;
      if (s.life >= s.max) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 420 * dt;
      alive.push(s);
      const a = 1 - s.life / s.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.sparks = alive.length > 600 ? alive.slice(-600) : alive;
  }

  private drawJudgements(now: number, hitY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const [note, j] of this.judgements) {
      const age = now - j.born;
      const life = 0.5;
      if (age > life || j.rating === 'good') { this.judgements.delete(note); continue; }
      const k = this.layout.get(note);
      if (!k) continue;
      const a = 1 - age / life;
      const y = hitY - 20 - age * 50;
      const cx = k.x + k.w / 2;
      ctx.globalAlpha = a;
      if (j.rating === 'miss') {
        ctx.font = `800 18px ${theme.font.ui}`;
        ctx.strokeStyle = 'rgba(8, 2, 16, 0.85)';
        ctx.lineWidth = 4;
        ctx.strokeText('×', cx, y);
        ctx.fillStyle = theme.missRed;
        ctx.fillText('×', cx, y);
      } else {
        const size = Math.max(11, Math.min(15, this.layout.whiteW * 0.26));
        ctx.font = `${size}px ${theme.font.display}`;
        ctx.strokeStyle = 'rgba(8, 2, 16, 0.9)';
        ctx.lineWidth = 4;
        ctx.strokeText('¡Justo!', cx, y);
        ctx.fillStyle = theme.amber;
        ctx.fillText('¡Justo!', cx, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOverlays(f: Frame, now: number, hitY: number): void {
    const ctx = this.ctx;
    const cx = this.W / 2;

    if (f.countIn) {
      const { label, phase } = f.countIn;
      const scale = 1.25 - Math.min(1, phase * 3) * 0.25;
      const size = Math.min(150, this.W * 0.12) * scale;
      ctx.globalAlpha = Math.max(0, 1 - phase * 0.85);
      ctx.font = `${size}px ${theme.font.display}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 63, 160, 0.55)';
      ctx.fillText(label, cx + 5, LANE_TOP + (hitY - LANE_TOP) * 0.42 + 5);
      ctx.fillStyle = theme.amber;
      ctx.fillText(label, cx, LANE_TOP + (hitY - LANE_TOP) * 0.42);
      ctx.globalAlpha = 1;
    }

    if (this.announcement) {
      const age = now - this.announcement.born;
      if (age > 0.9) this.announcement = null;
      else {
        const pop = 1 + Math.max(0, 0.15 - age) * 2;
        ctx.globalAlpha = Math.min(1, (0.9 - age) * 3);
        ctx.font = `${Math.round(54 * pop)}px ${theme.font.display}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(8, 2, 16, 0.7)';
        ctx.fillText(this.announcement.text, cx + 3, LANE_TOP + (hitY - LANE_TOP) * 0.3 + 3);
        ctx.fillStyle = this.announcement.color;
        ctx.fillText(this.announcement.text, cx, LANE_TOP + (hitY - LANE_TOP) * 0.3);
        ctx.globalAlpha = 1;
      }
    }

    if (f.waiting > 1.2) {
      ctx.globalAlpha = Math.min(1, (f.waiting - 1.2) * 2);
      ctx.font = `600 16px ${theme.font.ui}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = theme.ink;
      ctx.fillText('Tocá las teclas que brillan', cx, hitY - 70);
      ctx.globalAlpha = 1;
    }
  }

  // ─── Helpers de forma ───────────────────────────────────────────────
  private rr(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
  }

  private rrBottom(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [0, 0, rad, rad]);
  }
}
