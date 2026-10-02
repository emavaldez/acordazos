// Toda la interfaz HTML: menú, ajustes, HUD, pausa, resultados y avisos.
// El juego (Game.ts) le pasa estado y recibe acciones por callbacks.

import type { Difficulty, GameMode, SongMeta } from '../types';
import type { Arrangement } from '../game/Arrangement';
import type { MIDIStatus } from '../midi/MIDIManager';
import type { FallSpeed, RecordEntry, Settings } from './Settings';
import { bestStars } from './Settings';
import { theme } from '../theme';
import { KeyboardLayout } from '../game/KeyboardLayout';
import { KEYBOARD_MAX, KEYBOARD_MIN } from '../music/notes';

export interface UICallbacks {
  selectSong: (name: string) => void;
  changeSettings: (patch: Partial<Settings>) => void;
  start: () => void;
  retryMIDI: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  quit: () => void;
  tempoStep: (delta: number) => void;
}

export interface HUDData {
  score: number;
  multiplier: number;
  combo: number;
  progress: number;
  elapsed: number;
  total: number;
  tempo: number;
}

export interface ResultsData {
  title: string;
  artist: string;
  practice: boolean;
  score: number;
  stars: number;
  accuracy: number;
  perfects: number;
  goods: number;
  misses: number;
  maxCombo: number;
  sustainPct: number | null;
  totalNotes: number;
  newRecord: boolean;
  previousBest: number | null;
  timingBias: number | null;
  playSeconds: number;
  waits: number;
  latencyMs: number;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

const formatScore = (n: number) => Math.round(n).toLocaleString('es-AR');

/** 1 a 5 según notas de melodía por segundo */
export function heatLevel(density: number): number {
  return density < 2 ? 1 : density < 3.5 ? 2 : density < 5 ? 3 : density < 7 ? 4 : 5;
}

const MODE_OPTIONS: [GameMode, string][] = [['notes', 'Melodía'], ['chords', 'Acordes'], ['both', 'Las dos']];
const DIFF_OPTIONS: [Difficulty, string][] = [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']];
const FALL_OPTIONS: [FallSpeed, string][] = [['slow', 'Lenta'], ['medium', 'Media'], ['fast', 'Rápida']];

function segmented<T extends string>(name: string, options: [T, string][], current: T): string {
  return `<div class="seg" role="group" data-setting="${name}">${options
    .map(([v, label]) => `<button type="button" data-value="${v}" aria-pressed="${v === current}">${label}</button>`)
    .join('')}</div>`;
}

export class UIManager {
  private cb: UICallbacks;
  private root: HTMLElement;
  private menu!: HTMLElement;
  private hud!: HTMLElement;
  private pauseEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private settingsDialog!: HTMLDialogElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;

  private songs: SongMeta[] = [];
  private selected: string | null = null;
  private lastHUD: Partial<HUDData> = {};

  constructor(root: HTMLElement, cb: UICallbacks) {
    this.root = root;
    this.cb = cb;
    this.build();
  }

  // ─── Construcción ───────────────────────────────────────────────────
  private build(): void {
    this.menu = this.el(`
      <section id="menu" class="screen" aria-label="Menú">
        <header class="menu-head">
          <h1 class="sign"><span class="sign-text">Acordazos</span></h1>
          <p class="tagline">Las cumbias de siempre, en tu teclado.</p>
          <div class="head-tools">
            <div class="midi-pill" data-state="checking" role="status" aria-live="polite">
              <i class="dot"></i><span class="midi-text">Buscando teclado…</span>
              <button type="button" class="link-btn midi-retry" hidden>Reintentar</button>
            </div>
            <button type="button" class="ghost-btn" id="open-settings">Ajustes</button>
          </div>
        </header>
        <div class="menu-body">
          <section class="songs" aria-label="Temas">
            <label class="search">
              <span class="sr-only">Buscar</span>
              <input type="search" id="song-search" placeholder="Buscar tema o artista" autocomplete="off" spellcheck="false">
            </label>
            <p class="song-count" aria-live="polite"></p>
            <ol class="song-list" id="song-list"></ol>
          </section>
          <section class="stage" aria-label="Tema elegido">
            <div class="stage-head">
              <h2 class="stage-title">Elegí un tema</h2>
              <p class="stage-artist"></p>
            </div>
            <div class="preview-wrap">
              <canvas class="preview" id="preview" aria-hidden="true"></canvas>
              <div class="preview-legend"><span class="lg melody">Melodía</span><span class="lg chords">Acordes</span></div>
            </div>
            <dl class="facts">
              <div><dt>Duración</dt><dd data-fact="duration">–</dd></div>
              <div><dt>Notas a tocar</dt><dd data-fact="notes">–</dd></div>
              <div><dt>Tu récord</dt><dd data-fact="record">–</dd></div>
            </dl>
            <div class="controls">
              <div class="control"><span class="control-label">Qué tocás</span>${segmented('mode', MODE_OPTIONS, 'notes')}</div>
              <div class="control"><span class="control-label">Dificultad</span>${segmented('difficulty', DIFF_OPTIONS, 'normal')}</div>
              <div class="control">
                <label class="control-label" for="tempo">Tempo <output id="tempo-out">100 %</output></label>
                <input type="range" id="tempo" min="40" max="150" step="5" value="100">
              </div>
              <div class="control switch-row">
                <button type="button" role="switch" aria-checked="false" id="practice" class="switch"><i></i></button>
                <label for="practice"><b>Modo práctica</b><span>Las notas te esperan hasta que las tocás.</span></label>
              </div>
            </div>
            <button type="button" class="play-btn" id="play">Tocar</button>
          </section>
        </div>
      </section>`);

    this.hud = this.el(`
      <header id="hud" class="hud" hidden>
        <div class="hud-song">
          <p class="hud-title"></p>
          <div class="hud-progress" aria-hidden="true"><i></i></div>
          <p class="hud-time"></p>
        </div>
        <div class="hud-score">
          <span class="score-num">0</span>
          <span class="mult" data-m="1">x1</span>
        </div>
        <div class="hud-right">
          <p class="combo"><b>0</b> seguidas</p>
          <span class="chip practice-chip" hidden>Práctica</span>
          <canvas class="hud-map" title="Parte del teclado que se ve" aria-hidden="true"></canvas>
          <div class="tempo-ctl" role="group" aria-label="Tempo">
            <button type="button" data-step="-0.1" aria-label="Más lento">−</button>
            <output class="tempo-val">100 %</output>
            <button type="button" data-step="0.1" aria-label="Más rápido">+</button>
          </div>
          <button type="button" class="pause-btn" aria-label="Pausa (Esc)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>
          </button>
        </div>
      </header>`);

    this.pauseEl = this.el(`
      <div id="pause" class="overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" hidden>
        <div class="sheet">
          <h2 id="pause-title" class="sheet-title">Pausa</h2>
          <div class="sheet-actions">
            <button type="button" class="play-btn" data-act="resume">Seguir <kbd>Esc</kbd></button>
            <button type="button" class="ghost-btn" data-act="restart">Empezar de nuevo <kbd>R</kbd></button>
            <button type="button" class="ghost-btn" data-act="quit">Elegir otro tema</button>
          </div>
        </div>
      </div>`);

    this.resultsEl = this.el(`<div id="results" class="overlay" role="dialog" aria-modal="true" aria-labelledby="results-title" hidden></div>`);

    this.settingsDialog = this.el(`
      <dialog id="settings" class="settings" aria-labelledby="settings-title">
        <form method="dialog">
          <h2 id="settings-title" class="sheet-title">Ajustes</h2>
          <div class="control"><span class="control-label">Velocidad de caída</span>${segmented('fallSpeed', FALL_OPTIONS, 'medium')}</div>
          <div class="control"><span class="control-label">Nombre de las notas</span>${segmented('naming', [['solfege', 'Do Re Mi'], ['letters', 'C D E'], ['none', 'Sin nombre']], 'solfege')}</div>
          <div class="control"><span class="control-label">Teclado en pantalla</span>${segmented('keyboard', [['fit', 'Solo lo que usa el tema'], ['full', 'Las 61 teclas']], 'fit')}</div>
          <div class="control"><span class="control-label">Pista de fondo</span>${segmented('backing', [['all', 'Todo el tema'], ['others', 'Sin lo que tocás vos']], 'all')}</div>
          <div class="control">
            <label class="control-label" for="volume">Volumen <output id="volume-out">70 %</output></label>
            <input type="range" id="volume" min="0" max="100" step="5" value="70">
          </div>
          <div class="control">
            <label class="control-label" for="latency">Latencia <output id="latency-out">0 ms</output></label>
            <input type="range" id="latency" min="-250" max="350" step="5" value="0">
            <p class="help">Si te marca tarde aunque sentís que vas a tiempo, subila. Al terminar un tema te sugerimos un valor.</p>
          </div>
          <button class="play-btn" value="close">Listo</button>
        </form>
      </dialog>`) as HTMLDialogElement;

    this.toastEl = this.el(`<div class="toast" role="status" aria-live="polite" hidden></div>`);

    this.wireMenu();
    this.wireHUD();
    this.wirePause();
    this.wireSettings();
  }

  private el(html: string): HTMLElement {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    const node = t.content.firstElementChild as HTMLElement;
    this.root.appendChild(node);
    return node;
  }

  // ─── Menú ───────────────────────────────────────────────────────────
  private wireMenu(): void {
    const search = this.menu.querySelector<HTMLInputElement>('#song-search')!;
    search.addEventListener('input', () => this.filterSongs(search.value));

    this.menu.querySelector('#song-list')!.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.song-row');
      if (btn?.dataset.song) this.cb.selectSong(btn.dataset.song);
    });
    this.menu.querySelector('#song-list')!.addEventListener('keydown', e => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'ArrowDown' && ke.key !== 'ArrowUp') return;
      const rows = [...this.menu.querySelectorAll<HTMLButtonElement>('.song-row:not([hidden])')].filter(r => !r.closest('li')?.hidden);
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (ke.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { ke.preventDefault(); next.focus(); this.cb.selectSong(next.dataset.song!); }
    });

    this.menu.querySelectorAll<HTMLElement>('.seg').forEach(seg => this.wireSeg(seg));

    const tempo = this.menu.querySelector<HTMLInputElement>('#tempo')!;
    tempo.addEventListener('input', () => {
      this.menu.querySelector('#tempo-out')!.textContent = `${tempo.value} %`;
      this.cb.changeSettings({ tempo: Number(tempo.value) / 100 });
    });

    const practice = this.menu.querySelector<HTMLButtonElement>('#practice')!;
    practice.addEventListener('click', () => this.cb.changeSettings({ practice: practice.getAttribute('aria-checked') !== 'true' }));

    this.menu.querySelector('#play')!.addEventListener('click', () => this.cb.start());
    this.menu.querySelector('#open-settings')!.addEventListener('click', () => this.openSettings());
    this.menu.querySelector('.midi-retry')!.addEventListener('click', () => this.cb.retryMIDI());

    window.addEventListener('resize', () => this.redrawPreview());
  }

  private wireSeg(seg: HTMLElement): void {
    seg.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
      if (!btn) return;
      const key = seg.dataset.setting as keyof Settings;
      this.cb.changeSettings({ [key]: btn.dataset.value } as Partial<Settings>);
    });
  }

  setSongs(songs: SongMeta[]): void {
    this.songs = songs;
    const list = this.menu.querySelector('#song-list')!;
    if (!songs.length) {
      list.innerHTML = `<li class="empty">No hay temas en <code>public/songs</code>. Corré el pipeline para generar uno.</li>`;
      return;
    }
    list.innerHTML = songs.map(s => {
      const heat = heatLevel(s.density);
      const stars = bestStars(s.name);
      return `<li data-q="${esc(fold(`${s.title} ${s.artist}`))}">
        <button type="button" class="song-row" data-song="${esc(s.name)}" aria-current="${s.name === this.selected}">
          <span class="song-title">${esc(s.title)}</span>
          <span class="song-artist">${esc(s.artist || 'Sin artista')}</span>
          <span class="song-len">${formatTime(s.duration)}</span>
          <span class="heat" title="Intensidad ${heat} de 5" aria-label="Intensidad ${heat} de 5">${'<i class="on"></i>'.repeat(heat)}${'<i></i>'.repeat(5 - heat)}</span>
          ${stars ? `<span class="row-stars" aria-label="${stars} estrellas">${'★'.repeat(stars)}</span>` : ''}
        </button></li>`;
    }).join('');
    this.updateCount(songs.length);
  }

  private filterSongs(q: string): void {
    const needle = fold(q.trim());
    let shown = 0;
    this.menu.querySelectorAll<HTMLLIElement>('#song-list li[data-q]').forEach(li => {
      const ok = !needle || li.dataset.q!.includes(needle);
      li.hidden = !ok;
      if (ok) shown++;
    });
    this.updateCount(shown, needle.length > 0);
  }

  private updateCount(n: number, filtered = false): void {
    const p = this.menu.querySelector('.song-count')!;
    p.textContent = filtered ? (n ? `${n} de ${this.songs.length} temas` : 'Ningún tema coincide. Probá con otra palabra.') : `${n} temas`;
  }

  setSelected(name: string): void {
    this.selected = name;
    this.menu.querySelectorAll<HTMLButtonElement>('.song-row').forEach(r => r.setAttribute('aria-current', String(r.dataset.song === name)));
    const row = this.menu.querySelector<HTMLButtonElement>(`.song-row[data-song="${CSS.escape(name)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  private previewArr: Arrangement | null = null;

  setDetail(meta: SongMeta | null, arr: Arrangement | null, record: RecordEntry | null): void {
    const q = (sel: string) => this.menu.querySelector(sel)!;
    q('.stage-title').textContent = meta ? meta.title : 'Elegí un tema';
    q('.stage-artist').textContent = meta?.artist ?? '';
    q('[data-fact="duration"]').textContent = meta ? formatTime(meta.duration) : '–';
    q('[data-fact="notes"]').textContent = arr ? `${arr.notes.length}` : '–';
    q('[data-fact="record"]').innerHTML = record ? `${formatScore(record.score)} <span class="fact-stars" aria-label="${record.stars} estrellas">${'★'.repeat(record.stars)}</span>` : 'Todavía no';
    (q('#play') as HTMLButtonElement).disabled = !arr || arr.notes.length === 0;
    this.previewArr = arr;
    this.redrawPreview();
  }

  private redrawPreview(): void {
    const canvas = this.menu.querySelector<HTMLCanvasElement>('#preview');
    if (!canvas || this.menu.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const arr = this.previewArr;
    if (!arr || !arr.notes.length) return;
    const start = Math.max(0, arr.notes[0].time - arr.beat);
    const span = Math.max(8, arr.beat * 32);
    const lo = arr.lowest - 2;
    const hi = arr.highest + 2;
    const rowH = h / (hi - lo + 1);
    const pps = w / span;

    for (let b = 0; b * arr.beat < span; b++) {
      const x = Math.round(b * arr.beat * pps) + 0.5;
      ctx.fillStyle = b % 4 === 0 ? 'rgba(185,162,255,0.16)' : 'rgba(185,162,255,0.05)';
      ctx.fillRect(x, 0, 1, h);
    }
    for (const n of arr.notes) {
      if (n.time > start + span) break;
      if (n.time < start) continue;
      const x = (n.time - start) * pps;
      const y = h - (n.note - lo + 1) * rowH;
      const len = Math.max(3, n.duration * pps - 1.5);
      ctx.fillStyle = n.part === 'melody' ? theme.part.melody.white : theme.part.chords.white;
      ctx.beginPath();
      ctx.roundRect(x, y + 0.5, len, Math.max(2, rowH - 1), Math.min(3, rowH / 2));
      ctx.fill();
    }
  }

  /** Refleja los ajustes en todos los controles. */
  syncSettings(s: Settings): void {
    const all = [this.menu, this.settingsDialog];
    for (const scope of all) {
      scope.querySelectorAll<HTMLElement>('.seg').forEach(seg => {
        const key = seg.dataset.setting as keyof Settings;
        seg.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(String(s[key]) === b.dataset.value)));
      });
    }
    const tempo = this.menu.querySelector<HTMLInputElement>('#tempo')!;
    tempo.value = String(Math.round(s.tempo * 100));
    this.menu.querySelector('#tempo-out')!.textContent = `${Math.round(s.tempo * 100)} %`;
    this.menu.querySelector('#practice')!.setAttribute('aria-checked', String(s.practice));
    this.menu.querySelector('#play')!.textContent = s.practice ? 'Practicar' : 'Tocar';
    const legend = this.menu.querySelector<HTMLElement>('.preview-legend')!;
    legend.dataset.mode = s.mode;

    const vol = this.settingsDialog.querySelector<HTMLInputElement>('#volume')!;
    vol.value = String(Math.round(s.volume * 100));
    this.settingsDialog.querySelector('#volume-out')!.textContent = `${vol.value} %`;
    const lat = this.settingsDialog.querySelector<HTMLInputElement>('#latency')!;
    lat.value = String(s.latencyMs);
    this.settingsDialog.querySelector('#latency-out')!.textContent = `${s.latencyMs} ms`;
  }

  setMIDI(status: MIDIStatus | null): void {
    const pill = this.menu.querySelector<HTMLElement>('.midi-pill')!;
    const text = pill.querySelector('.midi-text')!;
    const retry = pill.querySelector<HTMLButtonElement>('.midi-retry')!;
    retry.hidden = true;
    if (!status) {
      pill.dataset.state = 'checking';
      text.textContent = 'Buscando teclado…';
    } else if (!status.supported) {
      pill.dataset.state = 'off';
      text.textContent = 'Este navegador no lee MIDI. Abrilo en Chrome o Edge.';
    } else if (!status.allowed) {
      pill.dataset.state = 'off';
      text.textContent = 'Sin permiso para usar el teclado.';
      retry.hidden = false;
    } else if (!status.devices.length) {
      pill.dataset.state = 'warn';
      text.textContent = 'Conectá el teclado por USB';
    } else {
      pill.dataset.state = 'ok';
      text.textContent = status.devices.length > 1 ? `${status.devices[0]} y ${status.devices.length - 1} más` : status.devices[0];
    }
  }

  /** `focus`: al volver de una partida, dejar el foco en el tema (para seguir con teclado). */
  showMenu(focus = false): void {
    this.menu.hidden = false;
    this.redrawPreview();
    if (!focus) return;
    const current = this.menu.querySelector<HTMLButtonElement>('.song-row[aria-current="true"]');
    (current ?? this.menu.querySelector<HTMLButtonElement>('#play'))?.focus({ preventScroll: true });
  }

  hideMenu(): void {
    this.menu.hidden = true;
  }

  get menuVisible(): boolean {
    return !this.menu.hidden;
  }

  // ─── Ajustes ────────────────────────────────────────────────────────
  private wireSettings(): void {
    this.settingsDialog.querySelectorAll<HTMLElement>('.seg').forEach(seg => this.wireSeg(seg));
    const vol = this.settingsDialog.querySelector<HTMLInputElement>('#volume')!;
    vol.addEventListener('input', () => this.cb.changeSettings({ volume: Number(vol.value) / 100 }));
    const lat = this.settingsDialog.querySelector<HTMLInputElement>('#latency')!;
    lat.addEventListener('input', () => this.cb.changeSettings({ latencyMs: Number(lat.value) }));
  }

  openSettings(): void {
    if (!this.settingsDialog.open) this.settingsDialog.showModal();
  }

  get settingsOpen(): boolean {
    return this.settingsDialog.open;
  }

  // ─── HUD ────────────────────────────────────────────────────────────
  private wireHUD(): void {
    this.hud.querySelector('.pause-btn')!.addEventListener('click', () => this.cb.pause());
    this.hud.querySelectorAll<HTMLButtonElement>('.tempo-ctl button').forEach(b =>
      b.addEventListener('click', () => this.cb.tempoStep(Number(b.dataset.step))));
  }

  showHUD(title: string, artist: string, practice: boolean): void {
    this.hud.hidden = false;
    this.hud.querySelector('.hud-title')!.textContent = artist ? `${title} — ${artist}` : title;
    this.hud.querySelector<HTMLElement>('.practice-chip')!.hidden = !practice;
    this.hud.querySelector<HTMLElement>('.combo')!.hidden = practice;
    this.hud.querySelector<HTMLElement>('.hud-score')!.hidden = practice;
    this.lastHUD = {};
  }

  /** Mini teclado de 61 teclas con la porción visible marcada (solo si hay zoom). */
  setKeyboardRange(lo: number, hi: number): void {
    const canvas = this.hud.querySelector<HTMLCanvasElement>('.hud-map')!;
    const full = lo === KEYBOARD_MIN && hi === KEYBOARD_MAX;
    canvas.hidden = full;
    if (full) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 190;
    const h = 22;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = 3;
    const kb = new KeyboardLayout(KEYBOARD_MIN, KEYBOARD_MAX, w - pad * 2);
    const top = pad;
    const kh = h - pad * 2;
    for (const k of kb.keys) {
      if (k.isBlack) continue;
      const inView = k.note >= lo && k.note <= hi;
      ctx.fillStyle = inView ? '#f3ebfa' : '#4a3d5c';
      ctx.fillRect(pad + k.x + 0.4, top, k.w - 0.8, kh);
    }
    for (const k of kb.keys) {
      if (!k.isBlack) continue;
      ctx.fillStyle = '#140827';
      ctx.fillRect(pad + k.x, top, k.w, kh * 0.6);
    }
    const a = kb.get(lo)!;
    const b = kb.get(hi)!;
    ctx.strokeStyle = theme.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(pad + a.x - 1.5, 1, b.x + b.w - a.x + 3, h - 2, 3);
    ctx.stroke();
  }

  hideHUD(): void {
    this.hud.hidden = true;
  }

  updateHUD(d: HUDData): void {
    const last = this.lastHUD;
    if (last.score !== d.score) this.hud.querySelector('.score-num')!.textContent = formatScore(d.score);
    if (last.multiplier !== d.multiplier) {
      const m = this.hud.querySelector<HTMLElement>('.mult')!;
      m.textContent = `x${d.multiplier}`;
      m.dataset.m = String(d.multiplier);
    }
    if (last.combo !== d.combo) this.hud.querySelector('.combo b')!.textContent = String(d.combo);
    const pct = Math.round(d.progress * 1000);
    if (Math.round((last.progress ?? -1) * 1000) !== pct) {
      this.hud.querySelector<HTMLElement>('.hud-progress i')!.style.transform = `scaleX(${Math.max(0, Math.min(1, d.progress))})`;
    }
    const sec = Math.floor(d.elapsed);
    if (Math.floor(last.elapsed ?? -1) !== sec) this.hud.querySelector('.hud-time')!.textContent = `${formatTime(d.elapsed)} / ${formatTime(d.total)}`;
    if (last.tempo !== d.tempo) this.hud.querySelector('.tempo-val')!.textContent = `${Math.round(d.tempo * 100)} %`;
    this.lastHUD = { ...d };
  }

  // ─── Pausa ──────────────────────────────────────────────────────────
  private wirePause(): void {
    this.pauseEl.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
      if (act === 'resume') this.cb.resume();
      else if (act === 'restart') this.cb.restart();
      else if (act === 'quit') this.cb.quit();
    });
  }

  showPause(): void {
    this.pauseEl.hidden = false;
    this.pauseEl.querySelector<HTMLButtonElement>('[data-act="resume"]')!.focus();
  }

  hidePause(): void {
    this.pauseEl.hidden = true;
  }

  get pauseVisible(): boolean {
    return !this.pauseEl.hidden;
  }

  // ─── Resultados ─────────────────────────────────────────────────────
  showResults(r: ResultsData, onApplyLatency: (ms: number) => void): void {
    const headline = r.practice
      ? 'Práctica terminada'
      : ['A practicar', 'Vas mejorando', 'Bien ahí', '¡Muy bien!', '¡Impecable!'][Math.max(0, r.stars - 1)];

    const bulbs = Array.from({ length: 5 }, (_, i) => `<i class="${i < r.stars ? 'on' : ''}" style="--i:${i}"></i>`).join('');
    let latencyHint = '';
    if (!r.practice && r.timingBias !== null && Math.abs(r.timingBias) >= 25) {
      const late = r.timingBias > 0;
      const suggested = Math.round((r.latencyMs + r.timingBias) / 5) * 5;
      latencyHint = `<p class="latency-hint">Venís tocando ${Math.round(Math.abs(r.timingBias))} ms ${late ? 'tarde' : 'antes'} en promedio.
        <button type="button" class="link-btn" data-latency="${suggested}">Compensar latencia (${suggested} ms)</button></p>`;
    }

    const stats = r.practice
      ? `<div><dt>Notas tocadas</dt><dd>${r.totalNotes}</dd></div>
         <div><dt>Tiempo</dt><dd>${formatTime(r.playSeconds)}</dd></div>
         <div><dt>Veces que te esperó</dt><dd>${r.waits}</dd></div>`
      : `<div><dt>Acertadas</dt><dd>${Math.round(r.accuracy * 100)} %</dd></div>
         <div><dt>Justas</dt><dd class="c-amber">${r.perfects}</dd></div>
         <div><dt>Bien</dt><dd class="c-lilac">${r.goods}</dd></div>
         <div><dt>Pifiadas</dt><dd class="c-red">${r.misses}</dd></div>
         <div><dt>Mejor racha</dt><dd>${r.maxCombo}</dd></div>
         ${r.sustainPct !== null ? `<div><dt>Notas largas sostenidas</dt><dd>${Math.round(r.sustainPct * 100)} %</dd></div>` : ''}`;

    this.resultsEl.innerHTML = `
      <div class="sheet results-sheet">
        ${r.practice ? '' : `<div class="bulbs" aria-label="${r.stars} de 5 estrellas">${bulbs}</div>`}
        <h2 id="results-title" class="sheet-title">${headline}</h2>
        <p class="results-song">${esc(r.title)}${r.artist ? ` <span>${esc(r.artist)}</span>` : ''}</p>
        ${r.practice ? '' : `<p class="results-score">${formatScore(r.score)}</p>
        <p class="results-record">${r.newRecord ? '<b>Récord nuevo</b>' : r.previousBest !== null ? `Tu récord: ${formatScore(r.previousBest)}` : ''}</p>`}
        <dl class="results-stats">${stats}</dl>
        ${latencyHint}
        <div class="sheet-actions">
          <button type="button" class="play-btn" data-act="restart">Otra vez</button>
          <button type="button" class="ghost-btn" data-act="quit">Elegir otro tema</button>
        </div>
      </div>`;
    this.resultsEl.hidden = false;
    this.resultsEl.querySelector<HTMLButtonElement>('[data-act="restart"]')!.focus();

    this.resultsEl.onclick = e => {
      const t = e.target as HTMLElement;
      const lat = t.closest<HTMLButtonElement>('[data-latency]');
      if (lat) {
        onApplyLatency(Number(lat.dataset.latency));
        lat.closest('.latency-hint')!.textContent = `Listo: latencia en ${lat.dataset.latency} ms.`;
        return;
      }
      const act = t.closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
      if (act === 'restart') this.cb.restart();
      else if (act === 'quit') this.cb.quit();
    };
  }

  hideResults(): void {
    this.resultsEl.hidden = true;
  }

  get resultsVisible(): boolean {
    return !this.resultsEl.hidden;
  }

  // ─── Avisos ─────────────────────────────────────────────────────────
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toastEl.hidden = true; }, 2600);
  }
}
