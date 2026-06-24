/**
 * Acordazos Server — Sirve el frontend y expone API para preparar canciones.
 *
 * Usar: node scripts/server.mjs
 * Luego abrir http://localhost:3000
 */

import express from 'express';
import { spawn } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir archivos estáticos (frontend build)
app.use(express.static(join(ROOT, 'dist')));
app.use('/songs', express.static(join(ROOT, 'public', 'songs')));

// ─── API: Listar canciones ─────────────────────────────────────────
app.get('/api/songs', (req, res) => {
  const songsDir = join(ROOT, 'public', 'songs');
  if (!existsSync(songsDir)) return res.json({ songs: [] });

  const songs = readdirSync(songsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => existsSync(join(songsDir, name, 'chart.json')));

  res.json({ songs });
});

// ─── API: Preparar canción desde YouTube ────────────────────────────
app.post('/api/prepare', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL requerida' });

  console.log(`🎬 Preparando: ${url}`);

  const python = '/usr/bin/python3';
  const script = join(ROOT, 'scripts', 'prepare_song.py');
  const args = [script, url];
  if (name) args.push('--name', name);

  const proc = spawn(python, args, { cwd: ROOT });
  let output = '';
  let error = '';

  proc.stdout.on('data', (data) => { output += data.toString(); });
  proc.stderr.on('data', (data) => { error += data.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`❌ Error (código ${code}): ${error.slice(0, 500)}`);
      return res.json({ success: false, error: error.slice(0, 500) });
    }

    // Extraer el nombre de la canción del output
    const songMatch = output.match(/✅ Listo: songs\/([^/]+)/);
    const song = songMatch ? songMatch[1] : 'unknown';

    console.log(`✅ Canción preparada: ${song}`);
    res.json({ success: true, song, output: output.slice(-500) });
  });

  proc.on('error', (err) => {
    res.json({ success: false, error: err.message });
  });
});

// ─── Fallback: SPA routing ──────────────────────────────────────────
app.use((req, res) => {
  const indexPath = join(ROOT, 'dist', 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('Acordazos — corré `npm run build` primero');
  }
});

app.listen(PORT, () => {
  console.log(`🎸 Acordazos corriendo en http://localhost:${PORT}`);
});