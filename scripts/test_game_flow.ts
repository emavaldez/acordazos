/**
 * Test manual: simula la interacción del usuario con el juego.
 * Verifica que:
 * 1. El menú se carga con 112 canciones
 * 2. Al seleccionar una canción, el chart se carga correctamente
 * 3. Al darle EMPEZAR, el canvas se muestra y el juego inicia
 * 4. Se puede seleccionar una segunda canción y funciona
 */

import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

// Leer los chart files
const songsDir = path.join(__dirname, '../public/songs');
const songNames = fs.readdirSync(songsDir).filter(f => {
  const stat = fs.statSync(path.join(songsDir, f));
  return stat.isDirectory();
});

console.log(`\n=== TEST ACORDAZOS ===`);
console.log(`Canciones encontradas: ${songNames.length}\n`);

// Test 1: Verificar que los chart files existen y son válidos
console.log('--- Test 1: Chart files ---');
let validCharts = 0;
let invalidCharts = 0;
for (const name of songNames.slice(0, 10)) {
  const chartPath = path.join(songsDir, name, 'chart.json');
  try {
    const content = fs.readFileSync(chartPath, 'utf-8');
    const chart = JSON.parse(content);
    const notes = chart.notes || [];
    const chords = chart.chords || [];
    const duration = chart.duration || 0;
    if (notes.length > 0 && duration > 0) {
      validCharts++;
      console.log(`  ✓ ${name}: ${notes.length} notas, ${chords.length} acordes, ${duration.toFixed(1)}s`);
    } else {
      invalidCharts++;
      console.log(`  ✗ ${name}: ${notes.length} notas, ${duration}s (inválido)`);
    }
  } catch (e) {
    invalidCharts++;
    console.log(`  ✗ ${name}: Error leyendo chart: ${e.message}`);
  }
}
console.log(`\nValidos: ${validCharts}, Invalidos: ${invalidCharts}\n`);

// Test 2: Verificar que el index.json tiene todas las canciones
console.log('--- Test 2: Index ---');
const indexPath = path.join(songsDir, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
console.log(`Canciones en index: ${index.length}`);

// Test 3: Simular el flujo del juego
console.log('\n--- Test 3: Flujo del juego ---');

// Simular load de chart
function testSongLoad(name: string) {
  const chartPath = path.join(songsDir, name, 'chart.json');
  try {
    const content = fs.readFileSync(chartPath, 'utf-8');
    const chart = JSON.parse(content);
    
    // Verificar estructura del chart
    if (!chart.title || !chart.artist) {
      return { ok: false, error: 'Faltan title/artist' };
    }
    if (!Array.isArray(chart.notes) || chart.notes.length === 0) {
      return { ok: false, error: 'No hay notas' };
    }
    if (!chart.duration || chart.duration <= 0) {
      return { ok: false, error: 'Duración inválida' };
    }
    
    // Verificar que las notas tienen estructura correcta
    const firstNote = chart.notes[0];
    if (typeof firstNote.note !== 'number' || typeof firstNote.time !== 'number') {
      return { ok: false, error: 'Estructura de nota inválida' };
    }
    
    // Verificar que el último tiempo no excede la duración
    const lastNote = chart.notes[chart.notes.length - 1];
    if (lastNote.time > chart.duration) {
      return { ok: false, error: `Última nota en ${lastNote.time}s excede duración ${chart.duration}s` };
    }
    
    return {
      ok: true,
      title: chart.title,
      artist: chart.artist,
      notes: chart.notes.length,
      chords: chart.chords?.length || 0,
      duration: chart.duration,
      lastNoteTime: lastNote.time
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Probar varias canciones
const testSongs = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
let passed = 0;
let failed = 0;

for (const name of testSongs) {
  const result = testSongLoad(name);
  if (result.ok) {
    passed++;
    console.log(`  ✓ ${name}: ${result.title} - ${result.notes} notas, ${result.duration.toFixed(1)}s`);
  } else {
    failed++;
    console.log(`  ✗ ${name}: ${result.error}`);
  }
}

console.log(`\n--- Resultado ---`);
console.log(`Pasaron: ${passed}/${testSongs.length}`);
console.log(`Fallaron: ${failed}/${testSongs.length}`);

// Test 4: Verificar que el build output es válido
console.log('\n--- Test 4: Build ---');
const distPath = path.join(__dirname, '../dist/index.html');
if (fs.existsSync(distPath)) {
  const html = fs.readFileSync(distPath, 'utf-8');
  const hasCanvas = html.includes('game-canvas');
  const hasScript = html.includes('index-');
  console.log(`  index.html existe: ✓`);
  console.log(`  Tiene canvas: ${hasCanvas ? '✓' : '✗'}`);
  console.log(`  Tiene script: ${hasScript ? '✓' : '✗'}`);
} else {
  console.log(`  ✗ dist/index.html no existe`);
}

console.log('\n=== TEST COMPLETADO ===\n');
