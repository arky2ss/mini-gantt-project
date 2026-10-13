'use strict';

const { CycleError, badRequest } = require('./errors');
const { addDays, formatDate } = require('./calendar');

/**
 * Mesin penjadwalan CPM (Critical Path Method).
 *
 * Semua perhitungan dilakukan dalam satuan *hari kerja* (offset integer),
 * sehingga hasilnya konsisten terlepas dari weekend/hari libur.
 * Pemetaan offset -> tanggal dilakukan oleh attachDates() dengan objek Calendar.
 *
 * Tipe dependensi:
 *  - FS (Finish-Start): mulai penerus >= selesai pendahulu + delay
 *  - SS (Start-Start):  mulai penerus >= mulai pendahulu  + delay
 */

const TYPES = new Set(['FS', 'SS']);

/** Validasi struktur activities + bangun peta successor. */
function buildGraph(activities) {
  if (!Array.isArray(activities)) {
    throw badRequest('Daftar kegiatan tidak valid');
  }
  const byId = new Map();
  const successors = new Map();
  const indegree = new Map();

  for (const a of activities) {
    if (a == null || typeof a !== 'object' || a.id == null) {
      throw badRequest('Setiap kegiatan harus memiliki id');
    }
    if (byId.has(a.id)) {
      throw badRequest(`Id kegiatan duplikat: ${a.id}`);
    }
    const duration = Number(a.duration);
    if (!Number.isInteger(duration) || duration <= 0) {
      throw badRequest(`Durasi kegiatan '${a.name || a.id}' harus bilangan bulat > 0`);
    }
    byId.set(a.id, { ...a, duration, predecessors: [] });
    successors.set(a.id, []);
    indegree.set(a.id, 0);
  }

  for (const a of activities) {
    const preds = a.predecessors || [];
    if (!Array.isArray(preds)) {
      throw badRequest(`Predecessor kegiatan '${a.name || a.id}' tidak valid`);
    }
    const seen = new Set();
    for (const raw of preds) {
      const p = typeof raw === 'object' ? raw : { id: raw };
      const pid = p.id;
      const type = (p.type || 'FS').toUpperCase();
      const delay = p.delay == null ? 0 : Number(p.delay);
      if (pid === a.id) {
        throw badRequest(`Kegiatan '${a.name || a.id}' tidak boleh menjadi pendahulunya sendiri`);
      }
      if (!byId.has(pid)) {
        throw badRequest(`Pendahulu dengan id ${pid} tidak ditemukan (kegiatan '${a.name || a.id}')`);
      }
      if (!TYPES.has(type)) {
        throw badRequest(`Tipe dependensi tidak valid: '${type}' (harus FS atau SS)`);
      }
      if (!Number.isInteger(delay) || delay < 0) {
        throw badRequest(`Delay harus bilangan bulat >= 0 (diterima: ${p.delay})`);
      }
      const key = `${pid}`;
      if (seen.has(key)) {
        throw badRequest(`Pendahulu duplikat pada kegiatan '${a.name || a.id}'`);
      }
      seen.add(key);
      const edge = { id: pid, type, delay };
      byId.get(a.id).predecessors.push(edge);
      successors.get(pid).push({ id: a.id, type, delay });
      indegree.set(a.id, indegree.get(a.id) + 1);
    }
  }

  return { byId, successors, indegree };
}

/** Urutan topologis (Kahn). Lempar CycleError bila graf melingkar. */
function topoSort({ byId, successors, indegree }) {
  const indeg = new Map(indegree);
  const queue = [];
  for (const [id, deg] of indeg) {
    if (deg === 0) queue.push(id);
  }
  queue.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const s of successors.get(id)) {
      indeg.set(s.id, indeg.get(s.id) - 1);
      if (indeg.get(s.id) === 0) queue.push(s.id);
    }
  }
  if (order.length !== byId.size) {
    const remaining = new Set([...indeg.entries()].filter(([, d]) => d > 0).map(([id]) => id));
    throw new CycleError(findCyclePath(remaining, successors));
  }
  return order;
}

/** Cari satu siklus di antara node yang tersisa (DFS, kembalikan urutan node). */
function findCyclePath(remaining, successors) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const id of remaining) color.set(id, WHITE);

  const stack = [];

  function dfs(id) {
    color.set(id, GRAY);
    stack.push(id);
    for (const s of successors.get(id) || []) {
      if (!remaining.has(s.id)) continue;
      const c = color.get(s.id);
      if (c === GRAY) {
        const start = stack.indexOf(s.id);
        return stack.slice(start).concat(s.id);
      }
      if (c === WHITE) {
        const found = dfs(s.id);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const id of remaining) {
    if (color.get(id) === WHITE) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return [...remaining];
}

/**
 * Hitung jadwal CPM (offset hari kerja, early/late pass, float, jalur kritis).
 * @param {Array} activities [{id, name, duration, predecessors:[{id,type,delay}]}]
 * @returns {{nodes:Array, byId:Map, order:number[], projectDuration:number}}
 */
function computeSchedule(activities) {
  const graph = buildGraph(activities);
  const { byId, successors } = graph;
  const order = topoSort(graph);

  // Forward pass (ES/EF)
  const es = new Map();
  const ef = new Map();
  for (const id of order) {
    const a = byId.get(id);
    let earliest = 0;
    for (const p of a.predecessors) {
      const cand = (p.type === 'SS' ? es.get(p.id) : ef.get(p.id)) + p.delay;
      if (cand > earliest) earliest = cand;
    }
    es.set(id, earliest);
    ef.set(id, earliest + a.duration);
  }

  let projectDuration = 0;
  for (const value of ef.values()) {
    if (value > projectDuration) projectDuration = value;
  }

  // Backward pass (LF/LS)
  const lf = new Map();
  const sinks = order.filter((id) => successors.get(id).length === 0);
  for (const id of order) lf.set(id, Infinity);
  for (const id of sinks) lf.set(id, projectDuration);

  const reversed = order.slice().reverse();
  for (const id of reversed) {
    const a = byId.get(id);
    for (const s of successors.get(id)) {
      // Karena order dibalik, late-nya penerus sudah final.
      const lsSucc = lf.get(s.id) - byId.get(s.id).duration;
      // FS: LS_pred = LS_succ - delay - dur_pred ; SS: LS_pred = LS_succ - delay
      const lsPred = s.type === 'SS' ? lsSucc - s.delay : lsSucc - s.delay - a.duration;
      const candidate = lsPred + a.duration;
      if (candidate < lf.get(id)) lf.set(id, candidate);
    }
  }

  const nodes = order.map((id) => {
    const a = byId.get(id);
    const ls = lf.get(id) - a.duration;
    const float = ls - es.get(id);
    const predecessors = a.predecessors.map((p) => ({ ...p }));
    const successorsOf = successors.get(id).map((s) => ({ ...s }));
    return {
      id,
      name: a.name,
      code: a.code != null ? a.code : a.name,
      duration: a.duration,
      es: es.get(id),
      ef: ef.get(id),
      ls,
      lf: lf.get(id),
      float,
      critical: float === 0,
      predecessors,
      successors: successorsOf,
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, byId: nodeById, order, projectDuration };
}

/**
 * Petakan offset hari kerja ke tanggal nyata memakai Calendar.
 * @param {object} schedule hasil computeSchedule()
 * @param {Calendar} calendar
 * @param {string} projectStartIso tanggal mulai proyek 'YYYY-MM-DD'
 */
function attachDates(schedule, calendar, projectStartIso) {
  const rawStart = calendar.nextWorkingDay(
    typeof projectStartIso === 'string'
      ? new Date(Date.parse(`${projectStartIso}T00:00:00Z`))
      : projectStartIso
  );
  const nodes = schedule.nodes.map((n) => {
    const startDate = calendar.addWorkingDays(rawStart, n.es);
    const endDate = calendar.addWorkingDays(startDate, n.duration - 1);
    return {
      ...n,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      startDayIndex: n.es,
      endDayIndex: n.ef - 1,
    };
  });
  const projectDuration = schedule.projectDuration;
  const projectEndDate =
    projectDuration > 0
      ? formatDate(calendar.addWorkingDays(rawStart, projectDuration - 1))
      : formatDate(rawStart);
  return {
    ...schedule,
    nodes,
    projectDuration,
    projectStartDate: formatDate(rawStart),
    projectEndDate,
    calendarDays:
      projectDuration > 0
        ? Math.round((Date.parse(projectEndDate) - Date.parse(formatDate(rawStart))) / 86_400_000) + 1
        : 1,
  };
}

/**
 * Enumerasi semua jalur sumber -> akhir beserta total estimasinya.
 *
 * total = jumlah durasi setiap node pada jalur + jumlah delay pada edge antar node.
 * Jalur ditandai kritis jika seluruh nodenya berfloat 0.
 */
function enumeratePaths(schedule, { maxPaths = 2000 } = {}) {
  const { nodes, byId } = schedule;
  const successorMap = new Map(nodes.map((n) => [n.id, n.successors]));
  const predecessorCount = new Map(nodes.map((n) => [n.id, n.predecessors.length]));
  const sources = nodes.filter((n) => predecessorCount.get(n.id) === 0).map((n) => n.id);

  const paths = [];
  let truncated = false;

  const walk = (id, acc, total) => {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    const node = byId.get(id);
    const nextTotal = total + node.duration;
    const nextAcc = acc.concat(id);
    const succ = successorMap.get(id) || [];
    if (succ.length === 0) {
      paths.push({ ids: nextAcc, total: nextTotal });
      return;
    }
    for (const s of succ) {
      walk(s.id, nextAcc, nextTotal + s.delay);
    }
  };

  for (const s of sources) walk(s, [], 0);

  const detailed = paths.map((p) => {
    const chain = p.ids.map((id) => byId.get(id));
    return {
      ids: p.ids,
      sequence: chain.map((n) => n.code || n.name).join(' -> '),
      nodes: chain.map((n) => ({ id: n.id, code: n.code || n.name, name: n.name, duration: n.duration })),
      total: p.total,
      isCritical: chain.length > 0 && chain.every((n) => n.critical),
    };
  });

  detailed.sort((a, b) => b.total - a.total || a.sequence.localeCompare(b.sequence));
  const maxTotal = detailed.reduce((max, p) => Math.max(max, p.total), 0);
  for (const p of detailed) p.isLongest = p.total === maxTotal && maxTotal > 0;

  return { paths: detailed, truncated, maxPaths };
}

/** Validasi cepat dependensi antar kegiatan (deteksi melingkar) tanpa menghitung jadwal. */
function assertNoCycle(activities) {
  const graph = buildGraph(activities);
  topoSort(graph);
  return true;
}

module.exports = {
  computeSchedule,
  attachDates,
  enumeratePaths,
  assertNoCycle,
  buildGraph,
  topoSort,
  findCyclePath,
  CycleError,
  addDays,
};
