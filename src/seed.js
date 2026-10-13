'use strict';

/**
 * Data contoh bawaan:
 * Proyek "Sistem Informasi Kelola Pemberkasan" dengan kegiatan A..J
 * sehingga jalur kritis B-E-H-J = 2 + 7 + 21 + 3 = 33 hari.
 */

const { openDb, all, run, DEFAULT_DB_PATH } = require('./db');

const SAMPLE_PROJECT = {
  name: 'Sistem Informasi Kelola Pemberkasan',
  start_date: '2026-01-05', // Senin
  weekend_days: '0,6',
};

const SAMPLE_HOLIDAYS = [
  { date: '2026-02-16', name: 'Hari Libur Nasional (contoh)' },
  { date: '2026-03-29', name: 'Hari Libur (contoh)' },
];

/** [kode, nama, durasi, [[pendahulu, tipe, delay], ...]] */
const SAMPLE_ACTIVITIES = [
  ['A', 'Analisis Kebutuhan', 1, []],
  ['B', 'Perancangan Basis Data', 2, []],
  ['C', 'Perancangan Antarmuka', 3, []],
  ['D', 'Pengembangan Modul Input', 5, [['A', 'FS', 0]]],
  ['E', 'Pengembangan Modul Proses', 7, [['B', 'FS', 0]]],
  ['F', 'Pengembangan Modul Laporan', 4, [['B', 'FS', 0]]],
  ['G', 'Integrasi Modul', 12, [['C', 'FS', 0]]],
  ['H', 'Pengujian Integrasi', 21, [['D', 'FS', 0], ['E', 'FS', 0]]],
  ['I', 'Penyusunan Dokumentasi', 2, [['G', 'FS', 0]]],
  ['J', 'Implementasi dan Serah Terima', 3, [['H', 'FS', 0], ['F', 'FS', 0], ['I', 'FS', 0]]],
];

const SAMPLE_RESOURCES = [
  ['Andi Pratama', 'andi.pratama@example.com', '0812-1111-2222', 'Project Manager', 900000],
  ['Budi Santoso', 'budi.santoso@example.com', '0812-3333-4444', 'Backend Developer', 750000],
  ['Citra Lestari', 'citra.lestari@example.com', '0812-5555-6666', 'Frontend Developer', 700000],
  ['Dewi Anggraini', 'dewi.anggraini@example.com', '0812-7777-8888', 'QA Engineer', 650000],
];

/** resource name -> kode kegiatan yang ditugaskan */
const SAMPLE_ASSIGNMENTS = [
  ['Andi Pratama', ['A', 'B', 'J']],
  ['Budi Santoso', ['B', 'D', 'E', 'G']],
  ['Citra Lestari', ['C', 'F', 'I']],
  ['Dewi Anggraini', ['H', 'I']],
];

function tableCount(db, table) {
  return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0].c);
}

/** Isi data contoh bila tabel projects masih kosong. */
function seedIfEmpty(db) {
  if (tableCount(db, 'projects') > 0) return { seeded: false };
  seedSample(db);
  return { seeded: true };
}

/** (Re)isi seluruh database dengan data contoh. */
function seedSample(db) {
  const tx = db.prepare('BEGIN');
  try {
    tx.run();
    run(db, 'DELETE FROM assignments');
    run(db, 'DELETE FROM dependencies');
    run(db, 'DELETE FROM activities');
    run(db, 'DELETE FROM resources');
    run(db, 'DELETE FROM holidays');
    run(db, 'DELETE FROM projects');

    const projectId = run(
      db,
      'INSERT INTO projects (name, start_date, weekend_days) VALUES (?, ?, ?)',
      [SAMPLE_PROJECT.name, SAMPLE_PROJECT.start_date, SAMPLE_PROJECT.weekend_days]
    ).lastInsertRowid;

    for (const h of SAMPLE_HOLIDAYS) {
      run(db, 'INSERT INTO holidays (project_id, date, name) VALUES (?, ?, ?)', [
        projectId,
        h.date,
        h.name,
      ]);
    }

    const idByCode = new Map();
    for (const [code, name, duration] of SAMPLE_ACTIVITIES) {
      const id = run(
        db,
        'INSERT INTO activities (project_id, code, name, duration) VALUES (?, ?, ?, ?)',
        [projectId, code, name, duration]
      ).lastInsertRowid;
      idByCode.set(code, id);
    }

    for (const [code, , , deps] of SAMPLE_ACTIVITIES) {
      const activityId = idByCode.get(code);
      for (const [predCode, type, delay] of deps) {
        run(
          db,
          'INSERT INTO dependencies (activity_id, predecessor_id, type, delay) VALUES (?, ?, ?, ?)',
          [activityId, idByCode.get(predCode), type, delay]
        );
      }
    }

    const resourceIdByCode = new Map();
    for (const [name, email, phone, position, rate] of SAMPLE_RESOURCES) {
      const id = run(
        db,
        'INSERT INTO resources (project_id, name, email, phone, position, daily_rate) VALUES (?, ?, ?, ?, ?, ?)',
        [projectId, name, email, phone, position, rate]
      ).lastInsertRowid;
      resourceIdByCode.set(name, id);
    }

    for (const [resourceName, codes] of SAMPLE_ASSIGNMENTS) {
      const resourceId = resourceIdByCode.get(resourceName);
      for (const code of codes) {
        run(db, 'INSERT INTO assignments (activity_id, resource_id) VALUES (?, ?)', [
          idByCode.get(code),
          resourceId,
        ]);
      }
    }

    db.prepare('COMMIT').run();
    return { seeded: true, projectId };
  } catch (err) {
    try {
      db.prepare('ROLLBACK').run();
    } catch (_) {
      /* abai */
    }
    throw err;
  }
}

module.exports = {
  seedIfEmpty,
  seedSample,
  SAMPLE_PROJECT,
  SAMPLE_ACTIVITIES,
  SAMPLE_RESOURCES,
};

if (require.main === module) {
  const db = openDb(process.argv.includes('--memory') ? ':memory:' : DEFAULT_DB_PATH);
  const action = process.argv.includes('--reset') ? 'reset' : 'seed';
  if (action === 'reset') {
    seedSample(db);
    console.log('Database di-reset dan diisi ulang dengan data contoh (kegiatan A..J).');
  } else {
    const res = seedIfEmpty(db);
    console.log(res.seeded ? 'Data contoh dimasukkan.' : 'Database sudah berisi, tidak ada perubahan.');
  }
  db.close();
}
