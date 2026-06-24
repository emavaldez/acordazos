import type { ChartData } from '../types';

/**
 * Carga charts desde el servidor (directorio public/songs/).
 */
export class SongLoader {
  /**
   * Escanea el directorio public/songs/ y devuelve los nombres de las canciones disponibles.
   * Busca subdirectorios que contengan chart.json.
   */
  static async listSongs(): Promise<string[]> {
    try {
      // Intentar cargar un índice de canciones (si existe)
      const resp = await fetch('/songs/index.json');
      if (resp.ok) {
        const index = await resp.json();
        return index.songs || [];
      }
    } catch {
      // No hay índice, intentar con lista hardcodeada
    }
    return [];
  }

  /**
   * Lista canciones buscando directamente los chart.json conocidos.
   */
  static async discoverSongs(): Promise<{ name: string; chart: ChartData | null }[]> {
    // Lista de canciones pre-configuradas (se actualiza cuando se prepara una nueva)
    const knownSongs = [
      'never-gonna',
      'test-song',
    ];

    const results: { name: string; chart: ChartData | null }[] = [];

    for (const name of knownSongs) {
      const chart = await SongLoader.loadChart(name);
      if (chart) {
        results.push({ name, chart });
      }
    }

    return results;
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
   * Devuelve la URL del audio para una canción
   */
  static getAudioUrl(songName: string, chart: ChartData): string {
    if (chart.audioFile) return `/${chart.audioFile}`;
    return `/songs/${songName}/audio.mp3`;
  }
}