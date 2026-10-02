// Genera public/songs/index.json con los metadatos de cada tema, para que el
// menú arranque sin bajar todos los charts.  Uso: npm run songs:index
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SONGS_DIR = join(import.meta.dirname, '..', 'public', 'songs');

// Misma regla que src/game/SongLoader.ts → normalizeTitle
function normalizeTitle(name, title, artist) {
  const letters = s => (s.match(/[a-záéíóúñü]/gi) ?? []).length;
  if (letters(title) >= 3) return { title, artist };
  if (letters(artist) >= 3) {
    const part = /^\d+$/.test(name) ? ` (${name})` : '';
    return { title: `${artist}${part}`, artist: '' };
  }
  return { title: title || name, artist };
}

const songs = [];
const meta = {};
for (const name of readdirSync(SONGS_DIR).sort()) {
  const file = join(SONGS_DIR, name, 'chart.json');
  if (!existsSync(file)) continue;
  let chart;
  try {
    chart = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`Salteo ${name}: ${e.message}`);
    continue;
  }
  if (!chart.title || !chart.bpm || !Array.isArray(chart.notes)) {
    console.warn(`Salteo ${name}: chart incompleto`);
    continue;
  }
  const { title, artist } = normalizeTitle(name, chart.title, chart.artist ?? '');
  const duration = Number(chart.duration) || 0;
  songs.push(name);
  meta[name] = {
    title,
    artist,
    duration: Math.round(duration * 100) / 100,
    bpm: chart.bpm,
    melodyCount: chart.notes.length,
    chordCount: Array.isArray(chart.chords) ? chart.chords.length : 0,
    density: duration > 0 ? Math.round((chart.notes.length / duration) * 100) / 100 : 0,
  };
}

writeFileSync(join(SONGS_DIR, 'index.json'), JSON.stringify({ songs, meta }, null, 2) + '\n');
console.log(`index.json: ${songs.length} temas`);
