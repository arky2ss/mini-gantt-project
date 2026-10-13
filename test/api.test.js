'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');

/** Jalankan aplikasi pada port acak, kembalikan helper fetch + penutup. */
function startApp() {
  const app = createApp(':memory:');
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const api = async (method, path, body) => {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try {
          json = await res.json();
        } catch (_) {
          json = null;
        }
        return { status: res.status, body: json };
      };
      resolve({
        app,
        server,
        base,
        api,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              try {
                app.locals.db.close();
              } catch (_) {
                /* abai */
              }
              done();
            });
          }),
      });
    });
  });
}

test('API: seed data contoh tersedia dan jadwal = 33 hari kerja', async () => {
  const ctx = await startApp();
  try {
    const projects = await ctx.api('GET', '/api/projects');
    assert.equal(projects.status, 200);
    assert.equal(projects.body.data.length, 1);
    const project = projects.body.data[0];
    assert.equal(project.name, 'Sistem Informasi Kelola Pemberkasan');
    assert.equal(project.activity_count, 10);

    const sched = await ctx.api('GET', `/api/projects/${project.id}/schedule`);
    assert.equal(sched.status, 200);
    assert.equal(sched.body.data.project_duration, 33);
    const critical = sched.body.data.activities.filter((a) => a.critical).map((a) => a.code);
    assert.deepEqual(critical.sort(), ['B', 'E', 'H', 'J']);

    const paths = await ctx.api('GET', `/api/projects/${project.id}/paths`);
    assert.equal(paths.status, 200);
    assert.equal(paths.body.data.paths.length, 4);
    assert.equal(paths.body.data.paths[0].sequence, 'B -> E -> H -> J');
    assert.equal(paths.body.data.paths[0].total, 33);
    assert.equal(paths.body.data.paths[0].isCritical, true);

    const pert = await ctx.api('GET', `/api/projects/${project.id}/pert`);
    assert.equal(pert.status, 200);
    assert.equal(pert.body.data.nodes.length, 10);
    assert.ok(pert.body.data.edges.length >= 10);
    assert.ok(pert.body.data.edges.some((e) => e.critical));
  } finally {
    await ctx.close();
  }
});

test('API: CRUD proyek + pengaturan weekend & hari libur', async () => {
  const ctx = await startApp();
  try {
    const created = await ctx.api('POST', '/api/projects', {
      name: 'Proyek Uji',
      start_date: '2026-06-01',
      weekend_days: [5, 6],
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal(created.body.data.weekend_days, '5,6');

    const updated = await ctx.api('PUT', `/api/projects/${id}`, {
      name: 'Proyek Uji Diubah',
      start_date: '2026-06-01',
      weekend_days: '0,6',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.name, 'Proyek Uji Diubah');

    const holiday = await ctx.api('POST', `/api/projects/${id}/holidays`, {
      date: '2026-06-17',
      name: 'Hari Libur',
    });
    assert.equal(holiday.status, 201);

    const dup = await ctx.api('POST', `/api/projects/${id}/holidays`, {
      date: '2026-06-17',
      name: 'Duplikat',
    });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error, /sudah terdaftar/);

    const holidays = await ctx.api('GET', `/api/projects/${id}/holidays`);
    assert.equal(holidays.body.data.length, 1);

    const del = await ctx.api('DELETE', `/api/holidays/${holiday.body.data.id}`);
    assert.equal(del.status, 200);

    const delProject = await ctx.api('DELETE', `/api/projects/${id}`);
    assert.equal(delProject.status, 200);
    const gone = await ctx.api('GET', `/api/projects/${id}`);
    assert.equal(gone.status, 404);
  } finally {
    await ctx.close();
  }
});

test('API: validasi input ditolak dengan pesan jelas (400)', async () => {
  const ctx = await startApp();
  try {
    const noName = await ctx.api('POST', '/api/projects', { start_date: '2026-06-01' });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/);

    const badDate = await ctx.api('POST', '/api/projects', {
      name: 'X',
      start_date: '31-06-2026',
    });
    assert.equal(badDate.status, 400);

    const badProject = await ctx.api('POST', '/api/projects/9999/activities', {
      name: 'Kegiatan',
      duration: 3,
    });
    assert.equal(badProject.status, 404);

    const badResource = await ctx.api('POST', '/api/projects/1/resources', {
      name: 'Tanpa Email',
      email: 'bukan-email',
      daily_rate: -5,
    });
    assert.equal(badResource.status, 400);

    const badJson = await fetch(`${ctx.base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{tidak valid',
    });
    assert.equal(badJson.status, 400);
  } finally {
    await ctx.close();
  }
});

test('API: CRUD kegiatan + dependensi terhitung otomatis', async () => {
  const ctx = await startApp();
  try {
    const a = await ctx.api('POST', '/api/projects/1/activities', {
      code: 'X',
      name: 'Kegiatan X',
      duration: 4,
    });
    assert.equal(a.status, 201);
    const b = await ctx.api('POST', '/api/projects/1/activities', {
      code: 'Y',
      name: 'Kegiatan Y',
      duration: 2,
      predecessors: [{ id: a.body.data.id, type: 'FS', delay: 1 }],
    });
    assert.equal(b.status, 201);

    const sched = await ctx.api('GET', '/api/projects/1/schedule');
    const acts = sched.body.data.activities;
    const xa = acts.find((x) => x.code === 'X');
    const yb = acts.find((x) => x.code === 'Y');
    assert.equal(yb.es, xa.ef + 1, 'delay 1 hari kerja diterapkan');

    const updated = await ctx.api('PUT', `/api/activities/${b.body.data.id}`, {
      name: 'Kegiatan Y Diubah',
      duration: 5,
      predecessors: [],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.duration, 5);
    assert.deepEqual(updated.body.data.predecessors, []);

    const invalidDuration = await ctx.api('PUT', `/api/activities/${a.body.data.id}`, {
      name: 'X',
      duration: 0,
      predecessors: [],
    });
    assert.equal(invalidDuration.status, 400);

    const unknownPred = await ctx.api('PUT', `/api/activities/${a.body.data.id}`, {
      name: 'X',
      duration: 3,
      predecessors: [{ id: 424242, type: 'FS', delay: 0 }],
    });
    assert.equal(unknownPred.status, 404);

    const del = await ctx.api('DELETE', `/api/activities/${b.body.data.id}`);
    assert.equal(del.status, 200);
    const delA = await ctx.api('DELETE', `/api/activities/${a.body.data.id}`);
    assert.equal(delA.status, 200);
  } finally {
    await ctx.close();
  }
});

test('API: dependensi melingkar ditolak dengan 400 + daftar siklus', async () => {
  const ctx = await startApp();
  try {
    const a = await ctx.api('POST', '/api/projects/1/activities', { name: 'Siklus A', duration: 1 });
    const b = await ctx.api('POST', '/api/projects/1/activities', { name: 'Siklus B', duration: 1 });
    const aId = a.body.data.id;
    const bId = b.body.data.id;

    // A <- B dulu (aman), lalu B <- A -> melingkar
    const first = await ctx.api('PUT', `/api/activities/${aId}`, {
      name: 'Siklus A',
      duration: 1,
      predecessors: [{ id: bId, type: 'FS', delay: 0 }],
    });
    assert.equal(first.status, 200);

    const cycle = await ctx.api('PUT', `/api/activities/${bId}`, {
      name: 'Siklus B',
      duration: 1,
      predecessors: [{ id: aId, type: 'FS', delay: 0 }],
    });
    assert.equal(cycle.status, 400);
    assert.match(cycle.body.error, /melingkar/);
    assert.ok(Array.isArray(cycle.body.details.cycle));

    const self = await ctx.api('PUT', `/api/activities/${aId}`, {
      name: 'Siklus A',
      duration: 1,
      predecessors: [{ id: aId, type: 'FS', delay: 0 }],
    });
    assert.equal(self.status, 400);
  } finally {
    await ctx.close();
  }
});

test('API: CRUD resource + penugasan ke kegiatan + estimasi biaya', async () => {
  const ctx = await startApp();
  try {
    const res = await ctx.api('POST', '/api/projects/1/resources', {
      name: 'Uji Resource',
      email: 'uji@example.com',
      phone: '0812-0000-1111',
      position: 'Developer',
      daily_rate: 500000,
    });
    assert.equal(res.status, 201);
    const resId = res.body.data.id;

    const activities = await ctx.api('GET', '/api/projects/1/activities');
    const target = activities.body.data[0];

    const assign = await ctx.api('POST', `/api/activities/${target.id}/resources`, {
      resource_id: resId,
    });
    assert.equal(assign.status, 201);

    const dupAssign = await ctx.api('POST', `/api/activities/${target.id}/resources`, {
      resource_id: resId,
    });
    assert.equal(dupAssign.status, 400);

    const resources = await ctx.api('GET', '/api/projects/1/resources');
    const found = resources.body.data.find((r) => r.id === resId);
    assert.equal(found.activities.length, 1);

    const summary = await ctx.api('GET', '/api/projects/1/summary');
    assert.equal(summary.status, 200);
    assert.ok(summary.body.data.estimated_cost > 0);
    assert.ok(summary.body.data.by_resource.some((r) => r.id === resId));

    const unassign = await ctx.api(
      'DELETE',
      `/api/activities/${target.id}/resources/${resId}`
    );
    assert.equal(unassign.status, 200);

    const updated = await ctx.api('PUT', `/api/resources/${resId}`, {
      name: 'Uji Resource 2',
      email: 'uji2@example.com',
      phone: '0812-0000-2222',
      position: 'Lead',
      daily_rate: 600000,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.daily_rate, 600000);

    const del = await ctx.api('DELETE', `/api/resources/${resId}`);
    assert.equal(del.status, 200);
  } finally {
    await ctx.close();
  }
});

test('API: endpoint tidak dikenal mengembalikan 404 JSON', async () => {
  const ctx = await startApp();
  try {
    const res = await ctx.api('GET', '/api/tidak-ada');
    assert.equal(res.status, 404);
    assert.match(res.body.error, /tidak ditemukan/);
  } finally {
    await ctx.close();
  }
});

test('Frontend disajikan di /', async () => {
  const ctx = await startApp();
  try {
    const res = await fetch(`${ctx.base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Mini Gantt/i);
  } finally {
    await ctx.close();
  }
});
