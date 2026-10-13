'use strict';

const { all, get, run } = require('./db');
const { notFound, badRequest } = require('./errors');
const { Calendar } = require('./calendar');
const { computeSchedule, attachDates, enumeratePaths } = require('./cpm');

/* ----------------------------- Proyek ----------------------------- */

function listProjects(db) {
  return all(
    db,
    `SELECT p.*,
            (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id) AS activity_count,
            (SELECT COUNT(*) FROM holidays h WHERE h.project_id = p.id) AS holiday_count
     FROM projects p
     ORDER BY p.id`
  );
}

function getProjectOr404(db, id) {
  const project = get(db, 'SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) throw notFound(`Proyek dengan id ${id} tidak ditemukan`);
  return project;
}

function getProject(db, id) {
  const project = getProjectOr404(db, id);
  project.holidays = listHolidays(db, id);
  return project;
}

function createProject(db, data) {
  const id = run(db, 'INSERT INTO projects (name, start_date, weekend_days) VALUES (?, ?, ?)', [
    data.name,
    data.start_date,
    data.weekend_days,
  ]).lastInsertRowid;
  return getProject(db, id);
}

function updateProject(db, id, data) {
  getProjectOr404(db, id);
  run(db, 'UPDATE projects SET name = ?, start_date = ?, weekend_days = ? WHERE id = ?', [
    data.name,
    data.start_date,
    data.weekend_days,
    id,
  ]);
  return getProject(db, id);
}

function deleteProject(db, id) {
  getProjectOr404(db, id);
  run(db, 'DELETE FROM projects WHERE id = ?', [id]);
  return { deleted: true };
}

/* --------------------------- Hari libur --------------------------- */

function listHolidays(db, projectId) {
  return all(db, 'SELECT * FROM holidays WHERE project_id = ? ORDER BY date', [projectId]);
}

function addHoliday(db, projectId, data) {
  getProjectOr404(db, projectId);
  const exists = get(db, 'SELECT id FROM holidays WHERE project_id = ? AND date = ?', [
    projectId,
    data.date,
  ]);
  if (exists) throw badRequest(`Tanggal ${data.date} sudah terdaftar sebagai hari libur`);
  const id = run(db, 'INSERT INTO holidays (project_id, date, name) VALUES (?, ?, ?)', [
    projectId,
    data.date,
    data.name,
  ]).lastInsertRowid;
  return get(db, 'SELECT * FROM holidays WHERE id = ?', [id]);
}

function deleteHoliday(db, holidayId) {
  const row = get(db, 'SELECT * FROM holidays WHERE id = ?', [holidayId]);
  if (!row) throw notFound(`Hari libur dengan id ${holidayId} tidak ditemukan`);
  run(db, 'DELETE FROM holidays WHERE id = ?', [holidayId]);
  return { deleted: true, id: holidayId, project_id: row.project_id };
}

/* --------------------------- Kegiatan ----------------------------- */

function listActivities(db, projectId) {
  const rows = all(
    db,
    'SELECT id, project_id, code, name, duration FROM activities WHERE project_id = ? ORDER BY id',
    [projectId]
  );
  const deps = all(
    db,
    `SELECT d.activity_id, d.predecessor_id AS id, d.type, d.delay
     FROM dependencies d
     JOIN activities a ON a.id = d.activity_id
     WHERE a.project_id = ?
     ORDER BY d.predecessor_id`,
    [projectId]
  );
  const assignments = all(
    db,
    `SELECT ra.activity_id, ra.resource_id
     FROM assignments ra
     JOIN activities a ON a.id = ra.activity_id
     WHERE a.project_id = ?`,
    [projectId]
  );
  const byActivity = new Map(rows.map((r) => [r.id, []]));
  for (const d of deps) {
    if (byActivity.has(d.activity_id)) byActivity.get(d.activity_id).push(d);
  }
  const resByActivity = new Map();
  for (const a of assignments) {
    if (!resByActivity.has(a.activity_id)) resByActivity.set(a.activity_id, []);
    resByActivity.get(a.activity_id).push(a.resource_id);
  }
  return rows.map((r) => ({
    ...r,
    predecessors: byActivity.get(r.id) || [],
    resource_ids: resByActivity.get(r.id) || [],
  }));
}

function createActivity(db, projectId, data) {
  getProjectOr404(db, projectId);
  const id = run(
    db,
    'INSERT INTO activities (project_id, code, name, duration) VALUES (?, ?, ?, ?)',
    [projectId, data.code, data.name, data.duration]
  ).lastInsertRowid;
  replacePredecessors(db, id, projectId, data.predecessors);
  return getActivity(db, id);
}

function getActivity(db, activityId) {
  const row = get(
    db,
    'SELECT id, project_id, code, name, duration FROM activities WHERE id = ?',
    [activityId]
  );
  if (!row) throw notFound(`Kegiatan dengan id ${activityId} tidak ditemukan`);
  row.predecessors = all(
    db,
    'SELECT predecessor_id AS id, type, delay FROM dependencies WHERE activity_id = ? ORDER BY predecessor_id',
    [activityId]
  );
  row.resource_ids = all(db, 'SELECT resource_id FROM assignments WHERE activity_id = ?', [
    activityId,
  ]).map((r) => r.resource_id);
  return row;
}

function updateActivity(db, activityId, data) {
  const existing = getActivity(db, activityId);
  run(db, 'UPDATE activities SET code = ?, name = ?, duration = ? WHERE id = ?', [
    data.code,
    data.name,
    data.duration,
    activityId,
  ]);
  replacePredecessors(db, activityId, existing.project_id, data.predecessors);
  return getActivity(db, activityId);
}

function deleteActivity(db, activityId) {
  getActivity(db, activityId);
  run(db, 'DELETE FROM activities WHERE id = ?', [activityId]);
  return { deleted: true, id: activityId };
}

/** Ganti seluruh predecessor sebuah kegiatan (validasi lintas proyek). */
function replacePredecessors(db, activityId, projectId, predecessors) {
  const unique = new Map();
  for (const p of predecessors) {
    if (p.id === activityId) {
      throw badRequest('Kegiatan tidak boleh menjadi pendahulunya sendiri');
    }
    if (unique.has(p.id)) {
      throw badRequest(`Pendahulu duplikat: kegiatan id ${p.id}`);
    }
    const target = get(
      db,
      'SELECT id, project_id, code, name FROM activities WHERE id = ?',
      [p.id]
    );
    if (!target) throw notFound(`Kegiatan pendahulu dengan id ${p.id} tidak ditemukan`);
    if (Number(target.project_id) !== Number(projectId)) {
      throw badRequest('Kegiatan pendahulu harus berasal dari proyek yang sama');
    }
    unique.set(p.id, { ...p, label: target.code || target.name });
  }
  db.prepare('BEGIN').run();
  try {
    run(db, 'DELETE FROM dependencies WHERE activity_id = ?', [activityId]);
    for (const p of unique.values()) {
      run(
        db,
        'INSERT INTO dependencies (activity_id, predecessor_id, type, delay) VALUES (?, ?, ?, ?)',
        [activityId, p.id, p.type, p.delay]
      );
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    try {
      db.prepare('ROLLBACK').run();
    } catch (_) {
      /* abai */
    }
    throw err;
  }
}

/* --------------------------- Resources ---------------------------- */

function listResources(db, projectId) {
  const resources = all(
    db,
    'SELECT * FROM resources WHERE project_id = ? ORDER BY id',
    [projectId]
  );
  const acts = all(
    db,
    `SELECT ra.resource_id, ra.activity_id, a.code, a.name, a.duration
     FROM assignments ra
     JOIN activities a ON a.id = ra.activity_id
     JOIN resources r ON r.id = ra.resource_id
     WHERE r.project_id = ?
     ORDER BY a.id`,
    [projectId]
  );
  const byResource = new Map(resources.map((r) => [r.id, []]));
  for (const a of acts) {
    if (byResource.has(a.resource_id)) byResource.get(a.resource_id).push(a);
  }
  return resources.map((r) => ({
    ...r,
    activities: byResource.get(r.id) || [],
    workload_days: (byResource.get(r.id) || []).reduce((s, a) => s + a.duration, 0),
  }));
}

function getResource(db, resourceId) {
  const row = get(db, 'SELECT * FROM resources WHERE id = ?', [resourceId]);
  if (!row) throw notFound(`Resource dengan id ${resourceId} tidak ditemukan`);
  return row;
}

function createResource(db, projectId, data) {
  getProjectOr404(db, projectId);
  const id = run(
    db,
    'INSERT INTO resources (project_id, name, email, phone, position, daily_rate) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, data.name, data.email, data.phone, data.position, data.daily_rate]
  ).lastInsertRowid;
  return getResource(db, id);
}

function updateResource(db, resourceId, data) {
  getResource(db, resourceId);
  run(
    db,
    'UPDATE resources SET name = ?, email = ?, phone = ?, position = ?, daily_rate = ? WHERE id = ?',
    [data.name, data.email, data.phone, data.position, data.daily_rate, resourceId]
  );
  return getResource(db, resourceId);
}

function deleteResource(db, resourceId) {
  getResource(db, resourceId);
  run(db, 'DELETE FROM resources WHERE id = ?', [resourceId]);
  return { deleted: true, id: resourceId };
}

function assignResource(db, activityId, resourceId) {
  const activity = getActivity(db, activityId);
  const resource = getResource(db, resourceId);
  if (Number(resource.project_id) !== Number(activity.project_id)) {
    throw badRequest('Resource dan kegiatan harus berada pada proyek yang sama');
  }
  const dup = get(
    db,
    'SELECT 1 AS x FROM assignments WHERE activity_id = ? AND resource_id = ?',
    [activityId, resourceId]
  );
  if (dup) throw badRequest('Resource sudah ditugaskan pada kegiatan ini');
  run(db, 'INSERT INTO assignments (activity_id, resource_id) VALUES (?, ?)', [
    activityId,
    resourceId,
  ]);
  return { activity_id: activityId, resource_id: resourceId, assigned: true };
}

function unassignResource(db, activityId, resourceId) {
  getActivity(db, activityId);
  const res = run(db, 'DELETE FROM assignments WHERE activity_id = ? AND resource_id = ?', [
    activityId,
    resourceId,
  ]);
  if (res.changes === 0) throw notFound('Penugasan tidak ditemukan');
  return { removed: true, activity_id: activityId, resource_id: resourceId };
}

/* --------------------------- Penjadwalan -------------------------- */

/** Kalender kerja proyek (weekend + hari libur). */
function getCalendar(db, project) {
  const holidays = listHolidays(db, project.id).map((h) => h.date);
  return new Calendar({ weekendDays: project.weekend_days, holidays });
}

/** Bangun model activities (untuk mesin CPM) dari database. */
function activityGraph(db, projectId) {
  return listActivities(db, projectId).map((a) => ({
    id: a.id,
    code: a.code || a.name,
    name: a.name,
    duration: a.duration,
    predecessors: a.predecessors.map((p) => ({ id: p.id, type: p.type, delay: p.delay })),
  }));
}

/** Jadwal lengkap sebuah proyek (CPM + tanggal + resource). */
function scheduleProject(db, projectId) {
  const project = getProject(db, projectId);
  const calendar = getCalendar(db, project);
  const activities = listActivities(db, projectId);
  const graph = activityGraph(db, projectId);
  const raw = computeSchedule(graph);
  const schedule = attachDates(raw, calendar, project.start_date);
  const resources = listResources(db, projectId);

  const resourceByActivity = new Map();
  for (const r of resources) {
    for (const a of r.activities) {
      if (!resourceByActivity.has(a.activity_id)) {
        resourceByActivity.set(a.activity_id, []);
      }
      resourceByActivity.get(a.activity_id).push({
        id: r.id,
        name: r.name,
        daily_rate: r.daily_rate,
      });
    }
  }

  const rows = schedule.nodes.map((n) => {
    const meta = activities.find((a) => a.id === n.id) || {};
    const assigned = resourceByActivity.get(n.id) || [];
    const rate = assigned.reduce((s, r) => s + Number(r.daily_rate || 0), 0);
    return {
      ...n,
      resource_ids: meta.resource_ids || [],
      resources: assigned,
      daily_rate: rate,
      cost: rate * n.duration,
    };
  });

  const estimatedCost = rows.reduce((s, r) => s + r.cost, 0);

  return {
    project,
    calendar,
    schedule: { ...schedule, nodes: rows },
    rows,
    estimatedCost,
  };
}

/** Tabel semua jalur + penanda jalur kritis. */
function pathsProject(db, projectId, opts) {
  const { schedule } = scheduleProject(db, projectId);
  const result = enumeratePaths(schedule, opts);
  return {
    project_duration: schedule.projectDuration,
    project_start: schedule.projectStartDate,
    project_end: schedule.projectEndDate,
    ...result,
  };
}

/** Data diagram PERT (node + panah) beserta layer untuk layout. */
function pertProject(db, projectId) {
  const { schedule } = scheduleProject(db, projectId);
  const nodes = schedule.nodes;

  // Layer = jarak terpanjang dari node sumber (longest-path layering)
  const layer = new Map();
  for (const id of schedule.order) {
    const node = nodes.find((n) => n.id === id);
    const preds = node.predecessors;
    layer.set(id, preds.length === 0 ? 0 : Math.max(...preds.map((p) => layer.get(p.id) + 1)));
  }

  const edges = [];
  for (const node of nodes) {
    for (const s of node.successors) {
      const target = nodes.find((n) => n.id === s.id);
      const onChain =
        s.type === 'SS'
          ? node.es + s.delay === target.es
          : node.ef + s.delay === target.es;
      edges.push({
        from: node.id,
        to: s.id,
        type: s.type,
        delay: s.delay,
        critical: Boolean(node.critical && target.critical && onChain),
      });
    }
  }

  const maxLayer = nodes.reduce((m, n) => Math.max(m, layer.get(n.id)), 0);
  return {
    project_duration: schedule.projectDuration,
    nodes: nodes.map((n) => ({ ...n, layer: layer.get(n.id) })),
    edges,
    layers: maxLayer + 1,
  };
}

/** Ringkasan proyek: total hari, estimasi biaya, beban per resource. */
function summaryProject(db, projectId) {
  const { schedule, rows, estimatedCost } = scheduleProject(db, projectId);
  const byResource = {};
  for (const row of rows) {
    for (const r of row.resources) {
      if (!byResource[r.id]) {
        byResource[r.id] = { id: r.id, name: r.name, days: 0, cost: 0 };
      }
      byResource[r.id].days += row.duration;
      byResource[r.id].cost += row.duration * Number(r.daily_rate || 0);
    }
  }
  return {
    activity_count: rows.length,
    working_days: schedule.projectDuration,
    start_date: schedule.projectStartDate,
    end_date: schedule.projectEndDate,
    estimated_cost: estimatedCost,
    critical_activities: rows.filter((r) => r.critical).map((r) => r.code || r.name),
    by_resource: Object.values(byResource),
  };
}

module.exports = {
  listProjects,
  getProject,
  getProjectOr404,
  createProject,
  updateProject,
  deleteProject,
  listHolidays,
  addHoliday,
  deleteHoliday,
  listActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  assignResource,
  unassignResource,
  getCalendar,
  activityGraph,
  scheduleProject,
  pathsProject,
  pertProject,
  summaryProject,
};
