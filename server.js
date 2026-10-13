'use strict';

const path = require('node:path');
const express = require('express');
const { openDb, DEFAULT_DB_PATH } = require('./src/db');
const { seedIfEmpty } = require('./src/seed');
const { createApiRouter } = require('./src/routes');
const { HttpError, CycleError } = require('./src/errors');

const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * Bangun aplikasi Express (tanpa listen) — dipakai server.js dan unit test.
 * @param {string} [dbPath] path SQLite atau ':memory:'
 */
function createApp(dbPath = DEFAULT_DB_PATH) {
  const db = openDb(dbPath);
  const seedResult = seedIfEmpty(db);

  const app = express();
  app.locals.db = db;
  app.locals.seeded = seedResult.seeded;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', createApiRouter(db));

  app.use(express.static(PUBLIC_DIR));

  // 404 untuk rute API yang tidak dikenal
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Endpoint tidak ditemukan: ${req.method} ${req.originalUrl}` });
  });

  // 404 untuk halaman di luar frontend
  app.use((req, res) => {
    res.status(404).send('404 - Halaman tidak ditemukan');
  });

  // Penanganan error terpusat
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof CycleError) {
      return res.status(400).json({ error: err.message, details: { cycle: err.cycle } });
    }
    if (err instanceof HttpError) {
      return res
        .status(err.status)
        .json({ error: err.message, details: err.details === undefined ? undefined : err.details });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Body JSON tidak valid' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Body request terlalu besar' });
    }
    if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.message || 'Permintaan tidak valid' });
    }
    console.error('[ERROR]', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Mini Gantt Project berjalan di http://localhost:${port}`);
    console.log(
      app.locals.seeded
        ? 'Database baru dibuat, data contoh (kegiatan A..J) dimasukkan.'
        : 'Menggunakan database yang sudah ada.'
    );
  });

  const shutdown = () => {
    server.close(() => {
      try {
        app.locals.db.close();
      } catch (_) {
        /* abai */
      }
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
