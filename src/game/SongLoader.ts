import type { ChartData } from '../types';

/**
 * Carga charts desde el servidor (directorio public/songs/).
 * También puede buscar canciones preparadas vía API remota.
 */
export class SongLoader {
  private static serverBase = 'http://157.151.235.227';

  /**
   * Descubre canciones: primero busca localmente (public/songs/),
   * después intenta desde el servidor remoto.
   */
  static async discoverSongs(): Promise<{ name: string; chart: ChartData | null }[]> {
    const localNames = await this.listLocalSongs();
    const results: { name: string; chart: ChartData | null }[] = [];

    // Cargar locales
    for (const name of localNames) {
      const chart = await SongLoader.loadChart(name);
      if (chart) {
        results.push({ name, chart });
      }
    }

    // También probar canciones del servidor remoto (con timeout corto)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${SongLoader.serverBase}/api/songs`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.songs)) {
          for (const remoteName of data.songs) {
            if (results.some(r => r.name === remoteName)) continue;
            const chart = await SongLoader.loadRemoteChart(remoteName);
            if (chart) {
              results.push({ name: remoteName, chart });
            }
          }
        }
      }
    } catch {
      // Servidor no disponible, solo locales
    }

    return results;
  }

  /**
   * Lista canciones conocidas localmente
   */
  static async listLocalSongs(): Promise<string[]> {
    try {
      const resp = await fetch('/songs/index.json');
      if (resp.ok) {
        const index = await resp.json();
        return index.songs || [];
      }
    } catch {
      // No hay índice
    }
    // Fallback: canciones pre-configuradas
    return [];
  }

  /**
   * Carga un chart JSON del directorio public/songs/<name>/chart.json
   */
  static async loadChart(songName: string): Promise<ChartData | null> {
    try {
      const resp = await fetch(`/songs/${songName}/chart.json`);
      if (!resp.ok) return null;
      const chart: ChartData = await resp.json();

      // Validar estructura básica
      if (!chart.title || !chart.bpm || !Array.isArray(chart.notes)) {
        console.warn(`Chart inválido: ${songName}`);
        return null;
      }

      return chart;
    } catch (err) {
      console.warn(`No se pudo cargar ${songName}:`, err);
      return null;
    }
  }

  /**
   * Carga chart desde el servidor remoto
   */
  static async loadRemoteChart(songName: string): Promise<ChartData | null> {
    try {
      const resp = await fetch(`${SongLoader.serverBase}/songs/${songName}/chart.json`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  /**
   * Devuelve la URL del audio para una canción
   */
  static getAudioUrl(songName: string, chart: ChartData): string {
    if (chart.audioFile) return `/${chart.audioFile}`;
    return `/songs/${songName}/audio.mp3`;
  }
}