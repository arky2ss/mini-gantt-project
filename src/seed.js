'use strict';

/**
 * Data contoh bawaan:
 * Proyek "Nexus Realm: Online RPG" — game development dengan 15 kegiatan (A..O).
 *
 * Jalur kritis utama: A → D → G → J → M → N → O
 * = 3 + 8 + 10 + 12 + 5 + 4 + 5 = 47 hari kerja
 */

const { openDb, all, run, DEFAULT_DB_PATH } = require('./db');

const SAMPLE_PROJECT = {
  name: 'Nexus Realm: Online RPG',
  start_date: '2026-01-05', // Senin
  weekend_days: '0,6',
};

const SAMPLE_HOLIDAYS = [
  { date: '2026-01-28', name: 'Tahun Baru Imlek 2577' },
  { date: '2026-03-19', name: 'Hari Raya Nyepi' },
  { date: '2026-03-20', name: 'Cuti Bersama Nyepi' },
  { date: '2026-04-02', name: 'Wafat Isa Almasih' },
];

/**
 * [kode, nama, durasi_hari_kerja, [[kode_pendahulu, tipe, delay], ...]]
 *
 * Struktur dependensi:
 *  A  → D, E
 *  B  → E, F
 *  C  → F, H
 *  D  → G, H
 *  E  → G
 *  F  → I
 *  G  → J, K
 *  H  → J
 *  I  → K, L
 *  J  → M
 *  K  → M, L
 *  L  → N
 *  M  → N
 *  N  → O
 */
const SAMPLE_ACTIVITIES = [
  // kode  nama                                    dur  pendahulu
  ['A', 'Game Design Document (GDD)',               3,  []],
  ['B', 'Riset Pasar & Analisis Kompetitor',        2,  []],
  ['C', 'Desain Karakter & Aset Visual',            5,  []],
  ['D', 'Arsitektur Game Engine & Server',          8,  [['A', 'FS', 0]]],
  ['E', 'Desain Mekanik Gameplay',                  6,  [['A', 'FS', 0], ['B', 'FS', 0]]],
  ['F', 'Desain UI/UX & HUD',                      4,  [['B', 'FS', 0], ['C', 'FS', 1]]],
  ['G', 'Pengembangan Core Engine',                10,  [['D', 'FS', 0], ['E', 'FS', 0]]],
  ['H', 'Pembuatan Aset 3D & Animasi',              9,  [['C', 'FS', 0], ['D', 'SS', 2]]],
  ['I', 'Pengembangan UI Front-End',               5,  [['F', 'FS', 0]]],
  ['J', 'Pengembangan Sistem Multiplayer',         12,  [['G', 'FS', 0], ['H', 'FS', 0]]],
  ['K', 'Integrasi Aset ke Engine',                6,  [['G', 'FS', 0], ['I', 'FS', 0]]],
  ['L', 'Pengembangan Backend & Database',          8,  [['I', 'FS', 0], ['K', 'SS', 2]]],
  ['M', 'Quality Assurance & Bug Fixing',           5,  [['J', 'FS', 0], ['K', 'FS', 0]]],
  ['N', 'Beta Test & Optimasi Performa',            4,  [['L', 'FS', 0], ['M', 'FS', 0]]],
  ['O', 'Rilis & Deployment ke Platform',           5,  [['N', 'FS', 0]]],
];

const SAMPLE_RESOURCES = [
  ['Rizky Nugraha',    'rizky.nugraha@nexusrealm.id',    '0811-2222-3333', 'Game Director',        1200000],
  ['Sari Wulandari',   'sari.wulandari@nexusrealm.id',   '0811-4444-5555', 'Game Engineer',        1000000],
  ['Bimo Adityawan',   'bimo.adityawan@nexusrealm.id',   '0811-6666-7777', 'Senior Artist',         850000],
  ['Fera Kusumastuti', 'fera.kusumastuti@nexusrealm.id', '0811-8888-9999', 'UI/UX Designer',        750000],
  ['Dimas Prasetyo',   'dimas.prasetyo@nexusrealm.id',   '0812-1010-2020', 'QA Engineer',           700000],
];

/** resource name → kode kegiatan yang ditugaskan */
const SAMPLE_ASSIGNMENTS = [
  ['Rizky Nugraha',    ['A', 'B', 'E', 'N', 'O']],
  ['Sari Wulandari',   ['D', 'G', 'J', 'L', 'M']],
  ['Bimo Adityawan',   ['C', 'H', 'K']],
  ['Fera Kusumastuti', ['C', 'F', 'I', 'K']],
  ['Dimas Prasetyo',   ['M', 'N', 'O']],
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
    console.log('Database di-reset dan diisi ulang dengan data contoh: Nexus Realm: Online RPG (kegiatan A..O, 15 kegiatan).');
  } else {
    const res = seedIfEmpty(db);
    console.log(res.seeded ? 'Data contoh Nexus Realm dimasukkan.' : 'Database sudah berisi, tidak ada perubahan.');
  }
  db.close();
}
