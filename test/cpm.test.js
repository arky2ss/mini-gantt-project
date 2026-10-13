'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeSchedule, attachDates, enumeratePaths, assertNoCycle } = require('../src/cpm');
const { Calendar } = require('../src/calendar');
const { CycleError } = require('../src/errors');
const { SAMPLE_ACTIVITIES } = require('../src/seed');

/** Konversi data contoh A..J menjadi model activities (id = kode unik). */
function sampleActivities() {
  const ids = new Map(SAMPLE_ACTIVITIES.map(([code], i) => [code, i + 1]));
  return SAMPLE_ACTIVITIES.map(([code, name, duration, deps]) => ({
    id: ids.get(code),
    code,
    name,
    duration,
    predecessors: deps.map(([pred, type, delay]) => ({
      id: ids.get(pred),
      type,
      delay,
    })),
  }));
}

function nodeOf(schedule, code) {
  return schedule.nodes.find((n) => n.code === code);
}

test('Data contoh A..J: total estimasi proyek = 33 hari kerja', () => {
  const s = computeSchedule(sampleActivities());
  assert.equal(s.projectDuration, 33);
  assert.equal(s.nodes.length, 10);
});

test('Jalur kritis B-E-H-J = 2+7+21+3 = 33 hari', () => {
  const s = computeSchedule(sampleActivities());
  const critical = s.nodes.filter((n) => n.critical).map((n) => n.code);
  assert.deepEqual(critical.sort(), ['B', 'E', 'H', 'J']);
  const total = critical.reduce((sum, code) => sum + nodeOf(s, code).duration, 0);
  assert.equal(total, 33);
});

test('Early start/finish tiap kegiatan sesuai ketergantungan', () => {
  const s = computeSchedule(sampleActivities());
  const expectEs = { A: 0, B: 0, C: 0, D: 1, E: 2, F: 2, G: 3, H: 9, I: 15, J: 30 };
  const expectEf = { A: 1, B: 2, C: 3, D: 6, E: 9, F: 6, G: 15, H: 30, I: 17, J: 33 };
  for (const [code, es] of Object.entries(expectEs)) {
    assert.equal(nodeOf(s, code).es, es, `ES ${code}`);
  }
  for (const [code, ef] of Object.entries(expectEf)) {
    assert.equal(nodeOf(s, code).ef, ef, `EF ${code}`);
  }
});

test('Float (slack) tiap kegiatan sesuai backward pass', () => {
  const s = computeSchedule(sampleActivities());
  const expectFloat = { A: 3, B: 0, C: 13, D: 3, E: 0, F: 24, G: 13, H: 0, I: 13, J: 0 };
  for (const [code, f] of Object.entries(expectFloat)) {
    const node = nodeOf(s, code);
    assert.equal(node.float, f, `float ${code}`);
    assert.equal(node.critical, f === 0, `critical ${code}`);
  }
});

test('Semua jalur ditampilkan, diurutkan dari total terbesar, jalur kritis ditandai', () => {
  const s = computeSchedule(sampleActivities());
  const { paths, truncated } = enumeratePaths(s);
  assert.equal(truncated, false);
  assert.equal(paths.length, 4, 'ada 4 jalur sumber->akhir: A-D-H-J, B-E-H-J, B-F-J, C-G-I-J');
  const sequences = paths.map((p) => p.sequence);
  assert.ok(sequences.includes('A -> D -> H -> J'));
  assert.ok(sequences.includes('B -> E -> H -> J'));
  assert.ok(sequences.includes('B -> F -> J'));
  assert.ok(sequences.includes('C -> G -> I -> J'));

  const top = paths[0];
  assert.equal(top.sequence, 'B -> E -> H -> J');
  assert.equal(top.total, 33);
  assert.equal(top.isCritical, true);
  assert.equal(top.isLongest, true);
  assert.deepEqual(
    top.nodes.map((n) => `${n.code}=${n.duration}`),
    ['B=2', 'E=7', 'H=21', 'J=3']
  );

  const otherCritical = paths.filter((p) => p.isCritical).map((p) => p.sequence);
  assert.deepEqual(otherCritical, ['B -> E -> H -> J'], 'hanya B-E-H-J yang kritis');
});

test('Tipe dependensi SS dan delay dihitung dengan benar', () => {
  const acts = [
    { id: 1, code: 'A', name: 'A', duration: 3, predecessors: [] },
    { id: 2, code: 'B', name: 'B', duration: 4, predecessors: [{ id: 1, type: 'SS', delay: 2 }] },
    { id: 3, code: 'C', name: 'C', duration: 2, predecessors: [{ id: 1, type: 'FS', delay: 4 }] },
    { id: 4, code: 'D', name: 'D', duration: 1, predecessors: [{ id: 2, type: 'FS', delay: 0 }] },
  ];
  const s = computeSchedule(acts);
  assert.equal(nodeOf(s, 'A').es, 0);
  assert.equal(nodeOf(s, 'A').ef, 3);
  assert.equal(nodeOf(s, 'B').es, 2, 'SS: mulai B = mulai A + delay 2');
  assert.equal(nodeOf(s, 'C').es, 7, 'FS: mulai C = selesai A + delay 4');
  assert.equal(nodeOf(s, 'D').es, 6, 'mulai D = selesai B');
  assert.equal(nodeOf(s, 'C').ef, 9, 'C: ES 7 + durasi 2');
  assert.equal(s.projectDuration, 9, 'proyek selesai pada EF terbesar (C)');
});

test('Dependensi melingkar terdeteksi dan memuat urutan siklus', () => {
  const cyclic = [
    { id: 1, code: 'A', name: 'A', duration: 1, predecessors: [{ id: 3, type: 'FS', delay: 0 }] },
    { id: 2, code: 'B', name: 'B', duration: 1, predecessors: [{ id: 1, type: 'FS', delay: 0 }] },
    { id: 3, code: 'C', name: 'C', duration: 1, predecessors: [{ id: 2, type: 'FS', delay: 0 }] },
  ];
  assert.throws(() => computeSchedule(cyclic), (err) => {
    assert.ok(err instanceof CycleError);
    assert.match(err.message, /melingkar/);
    assert.ok(err.cycle.length >= 3, 'menyertakan node siklus');
    return true;
  });
  assert.throws(() => assertNoCycle(cyclic), CycleError);
});

test('Diri sendiri tidak boleh jadi pendahulu (self-loop)', () => {
  const self = [{ id: 1, code: 'A', name: 'A', duration: 1, predecessors: [{ id: 1, type: 'FS', delay: 0 }] }];
  assert.throws(() => computeSchedule(self), (err) => err.status === 400 || err.name === 'CycleError');
});

test('Proyek kosong aman (durasi 0, tanpa jalur)', () => {
  const s = computeSchedule([]);
  assert.equal(s.projectDuration, 0);
  const { paths } = enumeratePaths(s);
  assert.deepEqual(paths, []);
});

test('attachDates memetakan offset ke tanggal kerja (lewati weekend & hari libur)', () => {
  const s = computeSchedule(sampleActivities());
  const cal = new Calendar({ weekendDays: '0,6', holidays: ['2026-02-16'] });
  const dated = attachDates(s, cal, '2026-01-05'); // Senin

  assert.equal(dated.projectStartDate, '2026-01-05');
  assert.equal(dated.projectDuration, 33);

  // Semua tanggal mulai & selesai adalah hari kerja
  for (const n of dated.nodes) {
    assert.equal(cal.isWorkingDay(new Date(Date.parse(`${n.startDate}T00:00:00Z`))), true, `${n.code} start`);
    assert.equal(cal.isWorkingDay(new Date(Date.parse(`${n.endDate}T00:00:00Z`))), true, `${n.code} end`);
    assert.ok(n.endDate >= n.startDate, `${n.code} end >= start`);
  }

  // Durasi kalender minimal = durasi kerja (mis. A 1 hari)
  const a = nodeOf(dated, 'A');
  assert.equal(a.startDate, '2026-01-05');
  assert.equal(a.endDate, '2026-01-05');

  // D: ES=1, durasi 5 -> Selasa 6 Jan s/d Senin 12 Jan
  const d = nodeOf(dated, 'D');
  assert.equal(d.startDate, '2026-01-06');
  assert.equal(d.endDate, '2026-01-12');

  // Akhir proyek = ES terakhir (J: ES=30, durasi 3) dalam hari kerja
  const j = nodeOf(dated, 'J');
  assert.equal(j.ef, 33);
  assert.equal(dated.projectEndDate, j.endDate);

  // Hari libur 16 Feb 2026 jatuh di dalam rentang dan tidak dipakai sebagai tanggal kerja
  assert.equal(cal.isWorkingDay(new Date(Date.parse('2026-02-16T00:00:00Z'))), false);
});

test('attachDates menyesuaikan tanggal mulai proyek yang jatuh di hari libur pekan', () => {
  const s = computeSchedule(sampleActivities());
  const cal = new Calendar({ weekendDays: '0,6' });
  const dated = attachDates(s, cal, '2026-01-10'); // Sabtu -> geser ke Senin
  assert.equal(dated.projectStartDate, '2026-01-12');
});

test('Graf dengan SS lintas jalur tetap menghasilkan float non-negatif', () => {
  const acts = [
    { id: 1, code: 'A', name: 'A', duration: 5, predecessors: [] },
    { id: 2, code: 'B', name: 'B', duration: 5, predecessors: [] },
    { id: 3, code: 'C', name: 'C', duration: 2, predecessors: [{ id: 1, type: 'FS', delay: 0 }] },
    { id: 4, code: 'D', name: 'D', duration: 3, predecessors: [{ id: 3, type: 'SS', delay: 1 }, { id: 2, type: 'FS', delay: 0 }] },
  ];
  const s = computeSchedule(acts);
  for (const n of s.nodes) {
    assert.ok(n.float >= 0, `float ${n.code} tidak negatif`);
    assert.ok(n.ls >= n.es, `LS ${n.code} >= ES`);
    assert.ok(n.lf >= n.ef, `LF ${n.code} >= EF`);
  }
});
