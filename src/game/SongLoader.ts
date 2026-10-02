import type { ChartData, SongMeta } from '../types';

interface SongIndex {
  songs: string[];
  meta?: Record<string, Omit<SongMeta, 'name'>>;
}

/** Títulos que el OCR de partituras dejó rotos ("2", "Dm", "ú"): se usa el otro campo. */
export function normalizeTitle(name: string, title: string, artist: string): { title: string; artist: string } {
  const letters = (s: string) => (s.match(/[a-záéíóúñü]/gi) ?? []).length;
  if (letters(title) >= 3) return { title, artist };
  if (letters(artist) >= 3) {
    const part = /^\d+$/.test(name) ? ` (${name})` : '';
    return { title: `${artist}${part}`, artist: '' };
  }
  return { title: title || name, artist };
}

export function metaFromChart(name: string, chart: ChartData): SongMeta {
  const { title, artist } = normalizeTitle(name, chart.title, chart.artist);
  const duration = chart.duration || 0;
  return {
    name,
    title,
    artist,
    duration,
    bpm: chart.bpm,
    melodyCount: chart.notes?.length ?? 0,
    chordCount: chart.chords?.length ?? 0,
    density: duration > 0 ? (chart.notes?.length ?? 0) / duration : 0,
  };
}

/**
 * Carga canciones desde public/songs/. El índice trae los metadatos para
 * armar el menú sin bajar los 112 charts; el chart se baja al elegir el tema.
 */
export class SongLoader {
  private static cache = new Map<string, ChartData>();

  static async listSongs(): Promise<SongMeta[]> {
    let index: SongIndex | null = null;
    try {
      const resp = await fetch('/songs/index.json');
      if (resp.ok) index = await resp.json();
    } catch {
      /* sin índice */
    }
    if (!index?.songs?.length) return [];

    const out: SongMeta[] = [];
    const missing: string[] = [];
    for (const name of index.songs) {
      const m = index.meta?.[name];
      if (m) out.push({ name, ...m });
      else missing.push(name);
    }
    // Temas agregados sin regenerar el índice: se leen del chart
    const extra = await Promise.all(missing.map(async name => {
      const chart = await SongLoader.loadChart(name);
      return chart ? metaFromChart(name, chart) : null;
    }));
    for (const m of extra) if (m) out.push(m);

    return out.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
  }

  /** Carga public/songs/<name>/chart.json (con caché). */
  static async loadChart(songName: string): Promise<ChartData | null> {
    const cached = SongLoader.cache.get(songName);
    if (cached) return cached;
    try {
      const resp = await fetch(`/songs/${encodeURIComponent(songName)}/chart.json`);
      if (!resp.ok) return null;
      const chart: ChartData = await resp.json();
      if (!chart.title || !chart.bpm || !Array.isArray(chart.notes)) {
        console.warn(`Chart inválido: ${songName}`);
        return null;
      }
      chart.chords = Array.isArray(chart.chords) ? chart.chords : [];
      SongLoader.cache.set(songName, chart);
      return chart;
    } catch (err) {
      console.warn(`No se pudo cargar ${songName}:`, err);
      return null;
    }
  }

  /** URL del MP3 si el chart trae uno; null = se sintetiza. */
  static getAudioUrl(_songName: string, chart: ChartData): string | null {
    if (chart.audioFile) return chart.audioFile.startsWith('/') ? chart.audioFile : `/${chart.audioFile}`;
    return null;
  }
}
