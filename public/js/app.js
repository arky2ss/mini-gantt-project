'use strict';

/* ============================== State ============================== */

const state = {
  projects: [],
  projectId: null,
  project: null,
  schedule: null,
  activities: [],
  resources: [],
  paths: null,
  pert: null,
  creatingProject: false,
  editingActivityId: null,
  editingResourceId: null,
  activeTab: 'gantt',
};

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const $ = (sel) => document.querySelector(sel);

function toast(message, kind) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind || ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.className = 'toast';
  }, 3600);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function weekendSet(project) {
  if (!project) return new Set([0, 6]);
  const raw = project.weekend_days || '';
  return new Set(raw === '' ? [] : raw.split(',').map((s) => Number(s.trim())));
}

function holidaySet(project) {
  if (!project || !project.holidays) return new Set();
  return new Set(project.holidays.map((h) => h.date));
}

/* ============================ Data load ============================ */

async function loadProjects() {
  const res = await api.get('/projects');
  state.projects = res.data || [];
  const select = $('#project-select');
  select.innerHTML = '';
  state.projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.start_date})`;
    select.appendChild(opt);
  });
  if (state.projects.length === 0) {
    state.projectId = null;
    select.innerHTML = '<option value="">— Belum ada proyek —</option>';
  } else if (!state.projects.find((p) => p.id === state.projectId)) {
    state.projectId = state.projects[0].id;
  }
  select.value = state.projectId == null ? '' : String(state.projectId);
}

async function refresh() {
  if (state.projectId == null) {
    state.project = null;
    state.schedule = null;
    state.activities = [];
    state.resources = [];
    renderAll();
    return;
  }
  const [project, schedule, activities, resources] = await Promise.all([
    api.get(`/projects/${state.projectId}`),
    api.get(`/projects/${state.projectId}/schedule`),
    api.get(`/projects/${state.projectId}/activities`),
    api.get(`/projects/${state.projectId}/resources`),
  ]);
  state.project = project.data;
  state.schedule = schedule.data;
  state.activities = activities.data || [];
  state.resources = resources.data || [];
  state.paths = null;
  state.pert = null;
  renderAll();
}

async function loadPaths() {
  if (state.projectId == null) return;
  const res = await api.get(`/projects/${state.projectId}/paths`);
  state.paths = res.data;
  renderPaths();
}

async function loadPert() {
  if (state.projectId == null) return;
  const res = await api.get(`/projects/${state.projectId}/pert`);
  state.pert = res.data;
  renderPertTab();
}

/* ============================= Rendering =========================== */

function renderAll() {
  renderSummary();
  renderGanttTab();
  renderActivities();
  renderResources();
  renderSettings();
  if (state.activeTab === 'paths') loadPaths();
  if (state.activeTab === 'pert') loadPert();
  if (state.activeTab === 'paths') renderPaths();
  if (state.activeTab === 'pert' && state.pert) renderPertTab();
}

function renderSummary() {
  const host = $('#summary-cards');
  const s = state.schedule;
  if (!s) {
    host.innerHTML = '<div class="card"><div class="v small">Pilih atau buat proyek terlebih dahulu.</div></div>';
    return;
  }
  const critical = (s.activities || []).filter((a) => a.critical).map((a) => a.code || a.name);
  host.innerHTML = [
    card('Total hari kerja', `${s.project_duration} hari`),
    card('Tanggal mulai', fmtDate(s.project_start), true),
    card('Tanggal selesai', fmtDate(s.project_end), true),
    card('Durasi kalender', `${s.calendar_days} hari`),
    card('Estimasi biaya', fmtRp(s.estimated_cost), true),
    card('Kegiatan kritis', critical.length ? critical.join(', ') : '-', true, true),
  ].join('');
}

function card(k, v, small, critical) {
  return `<div class="card${critical ? ' critical' : ''}"><div class="k">${esc(k)}</div><div class="v${small ? ' small' : ''}">${esc(v)}</div></div>`;
}

function renderGanttTab() {
  const host = $('#gantt-chart');
  if (!state.schedule || !state.project) {
    host.innerHTML = '<div class="empty" style="padding:24px">Tidak ada proyek untuk ditampilkan.</div>';
    return;
  }
  renderGantt(host, {
    activities: state.schedule.activities || [],
    project_start: state.schedule.project_start,
    project_end: state.schedule.project_end,
    calendar_days: state.schedule.calendar_days,
    weekendDays: weekendSet(state.project),
    holidays: holidaySet(state.project),
  });
}

function schedByActivityId() {
  const map = new Map();
  if (state.schedule) {
    (state.schedule.activities || []).forEach((a) => map.set(a.id, a));
  }
  return map;
}

function renderActivities() {
  const tbody = $('#activity-table tbody');
  const sched = schedByActivityId();
  if (state.activities.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Belum ada kegiatan.</td></tr>';
    return;
  }
  const codeOf = (id) => {
    const a = state.activities.find((x) => x.id === id);
    return a ? a.code || a.name : `#${id}`;
  };

  tbody.innerHTML = state.activities
    .map((a) => {
      const s = sched.get(a.id) || {};
      const preds = (a.predecessors || [])
        .map(
          (p) =>
            `<span class="badge badge-dep">${esc(codeOf(p.id))} ${esc(p.type)}${p.delay ? '+' + p.delay : ''}</span>`
        )
        .join('');
      const resNames = (a.resource_ids || [])
        .map((id) => {
          const r = state.resources.find((x) => x.id === id);
          return r ? r.name : '';
        })
        .filter(Boolean);
      return `
      <tr class="${s.critical ? 'is-critical' : ''}">
        <td><strong>${esc(a.code || '-')}</strong></td>
        <td>${esc(a.name)}</td>
        <td>${a.duration} hari</td>
        <td><div class="chips">${preds || '<span class="hint">-</span>'}</div></td>
        <td>${esc(s.startDate || '-')}</td>
        <td>${esc(s.endDate || '-')}</td>
        <td>${s.float == null ? '-' : s.float}</td>
        <td>${s.critical ? '<span class="badge badge-critical">KRITIS</span>' : '<span class="badge badge-muted">normal</span>'}</td>
        <td><div class="chips">${resNames.map((n) => `<span class="badge badge-ok">${esc(n)}</span>`).join('') || '-'}</div></td>
        <td class="actions">
          <button class="btn btn-sm" data-act="edit" data-id="${a.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${a.id}">Hapus</button>
        </td>
      </tr>`;
    })
    .join('');
}

function renderPaths() {
  const tbody = $('#path-table tbody');
  const note = $('#paths-note');
  const summary = $('#paths-summary');
  if (!state.paths) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Memuat jalur...</td></tr>';
    return;
  }
  const p = state.paths;
  summary.innerHTML =
    `Durasi proyek (jalur kritis): <strong>${p.project_duration} hari kerja</strong> &middot; ` +
    `${fmtDate(p.project_start)} s/d ${fmtDate(p.project_end)} &middot; ` +
    `total jalur ditemukan: <strong>${p.paths.length}</strong>`;
  tbody.innerHTML = p.paths
    .map((path, i) => {
      const status = path.isCritical
        ? '<span class="badge badge-critical">JALUR KRITIS</span>'
        : path.isLongest
          ? '<span class="badge badge-dep">terpanjang</span>'
          : '<span class="badge badge-muted">tidak kritis</span>';
      const durations = path.nodes.map((n) => `${esc(n.code)}=${n.duration}`).join(' + ');
      return `
      <tr class="${path.isCritical ? 'is-critical' : ''}">
        <td>${i + 1}</td>
        <td><strong>${esc(path.sequence)}</strong></td>
        <td>${durations}</td>
        <td><strong>${path.total}</strong> hari</td>
        <td>${status}</td>
      </tr>`;
    })
    .join('');
  note.textContent = p.truncated
    ? `Catatan: hanya ${p.paths.length} jalur pertama ditampilkan (batas ${p.maxPaths}). Total estimasi = jumlah durasi node + delay pada edge.`
    : 'Total estimasi = jumlah durasi setiap node pada jalur + delay antar kegiatan. Jalur kritis = jalur yang seluruh nodenya berfloat 0.';
}

function renderPertTab() {
  const host = $('#pert-chart');
  if (!state.pert) {
    host.innerHTML = '<div class="empty" style="padding:24px">Memuat diagram...</div>';
    return;
  }
  renderPert(host, state.pert);
}

function renderResources() {
  const tbody = $('#resource-table tbody');
  if (state.resources.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Belum ada resource.</td></tr>';
  } else {
    tbody.innerHTML = state.resources
      .map((r) => {
        const cost = r.workload_days * Number(r.daily_rate || 0);
        return `
      <tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td>${esc(r.email || '-')}</td>
        <td>${esc(r.phone || '-')}</td>
        <td>${esc(r.position || '-')}</td>
        <td>${fmtRp(r.daily_rate)}</td>
        <td>${r.workload_days} hari</td>
        <td>${fmtRp(cost)}</td>
        <td class="actions">
          <button class="btn btn-sm" data-act="edit-res" data-id="${r.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="delete-res" data-id="${r.id}">Hapus</button>
        </td>
      </tr>`;
      })
      .join('');
  }

  const select = $('#assign-activity');
  const current = select.value;
  select.innerHTML =
    '<option value="">— pilih kegiatan —</option>' +
    state.activities
      .map((a) => `<option value="${a.id}">${esc(a.code || '')} - ${esc(a.name)}</option>`)
      .join('');
  if (current) select.value = current;
  renderAssignList();
}

function renderAssignList() {
  const host = $('#assign-list');
  const activityId = Number($('#assign-activity').value);
  if (!activityId) {
    host.innerHTML = '<div class="empty">Pilih kegiatan untuk melihat/mengatur penugasan resource.</div>';
    return;
  }
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity || state.resources.length === 0) {
    host.innerHTML = '<div class="empty">Belum ada resource. Tambahkan resource terlebih dahulu.</div>';
    return;
  }
  const assigned = new Set(activity.resource_ids || []);
  host.innerHTML = state.resources
    .map((r) => {
      const on = assigned.has(r.id);
      return `
      <label class="assign-item">
        <input type="checkbox" data-res="${r.id}" ${on ? 'checked' : ''} />
        <span class="meta">
          <span class="nm">${esc(r.name)}</span>
          <span class="sub">${esc(r.position || '-')} &middot; ${fmtRp(r.daily_rate)}/hari</span>
        </span>
      </label>`;
    })
    .join('');
}

function renderSettings() {
  const p = state.project;
  $('#project-name').value = p && !state.creatingProject ? p.name : $('#project-name').value;
  if (p && !state.creatingProject) {
    $('#project-start').value = p.start_date;
    const wk = weekendSet(p);
    document.querySelectorAll('#weekend-picker input').forEach((cb) => {
      cb.checked = wk.has(Number(cb.value));
    });
    const tbody = $('#holiday-table tbody');
    const holidays = p.holidays || [];
    tbody.innerHTML = holidays.length
      ? holidays
          .map(
            (h) => `
        <tr>
          <td>${esc(h.date)}</td>
          <td>${esc(h.name)}</td>
          <td class="actions"><button class="btn btn-sm btn-danger" data-act="delete-holiday" data-id="${h.id}">Hapus</button></td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="3" class="empty">Belum ada hari libur.</td></tr>';
  }
}

/* ============================ Activity form ======================== */

function openActivityForm(activity) {
  state.editingActivityId = activity ? activity.id : null;
  const form = $('#activity-form');
  form.classList.remove('hidden');
  $('#activity-code').value = activity ? activity.code || '' : '';
  $('#activity-name').value = activity ? activity.name : '';
  $('#activity-duration').value = activity ? activity.duration : 1;
  $('#pred-list').innerHTML = '';
  (activity ? activity.predecessors : []).forEach((p) => addPredRow(p));
  $('#activity-name').focus();
}

function closeActivityForm() {
  state.editingActivityId = null;
  $('#activity-form').classList.add('hidden');
  $('#activity-form').reset();
  $('#pred-list').innerHTML = '';
}

function addPredRow(value) {
  const currentId = state.editingActivityId;
  const options = state.activities
    .filter((a) => a.id !== currentId)
    .map((a) => `<option value="${a.id}">${esc(a.code || a.id)} - ${esc(a.name)}</option>`)
    .join('');
  const row = document.createElement('div');
  row.className = 'pred-row';
  row.innerHTML = `
    <select class="pred-target">${options}</select>
    <select class="pred-type">
      <option value="FS">FS</option>
      <option value="SS">SS</option>
    </select>
    <input class="pred-delay" type="number" min="0" max="3650" value="0" title="Delay (hari kerja)" />
    <button class="btn btn-sm btn-danger pred-remove" type="button">x</button>`;
  $('#pred-list').appendChild(row);
  if (value) {
    row.querySelector('.pred-target').value = String(value.id);
    row.querySelector('.pred-type').value = value.type || 'FS';
    row.querySelector('.pred-delay').value = String(value.delay || 0);
  }
  row.querySelector('.pred-remove').addEventListener('click', () => row.remove());
}

function collectPreds() {
  return [...document.querySelectorAll('#pred-list .pred-row')].map((row) => ({
    id: Number(row.querySelector('.pred-target').value),
    type: row.querySelector('.pred-type').value,
    delay: Number(row.querySelector('.pred-delay').value || 0),
  }));
}

/* ============================== Tabs =============================== */

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
  if (name === 'paths') loadPaths();
  if (name === 'pert') loadPert();
}

/* ============================== Events ============================= */

function bindEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(btn.dataset.tab);
  });

  $('#project-select').addEventListener('change', async (e) => {
    state.projectId = Number(e.target.value) || null;
    state.creatingProject = false;
    try {
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-new-project').addEventListener('click', () => {
    state.creatingProject = true;
    $('#project-name').value = '';
    $('#project-start').value = todayIso();
    document.querySelectorAll('#weekend-picker input').forEach((cb) => {
      cb.checked = ['0', '6'].includes(cb.value);
    });
    $('#holiday-table tbody').innerHTML = '<tr><td colspan="3" class="empty">Simpan proyek terlebih dahulu.</td></tr>';
    switchTab('settings');
    $('#project-name').focus();
  });

  // ---- Kegiatan ----
  $('#btn-add-activity').addEventListener('click', () => openActivityForm(null));
  $('#btn-cancel-activity').addEventListener('click', closeActivityForm);
  $('#btn-add-pred').addEventListener('click', () => addPredRow());

  $('#activity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      code: $('#activity-code').value.trim(),
      name: $('#activity-name').value.trim(),
      duration: Number($('#activity-duration').value),
      predecessors: collectPreds(),
    };
    try {
      if (state.editingActivityId) {
        await api.put(`/activities/${state.editingActivityId}`, payload);
        toast('Kegiatan diperbarui', 'ok');
      } else {
        await api.post(`/projects/${state.projectId}/activities`, payload);
        toast('Kegiatan ditambahkan', 'ok');
      }
      closeActivityForm();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#activity-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const activity = state.activities.find((a) => a.id === id);
    if (btn.dataset.act === 'edit') {
      openActivityForm(activity);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (btn.dataset.act === 'delete') {
      if (!confirm(`Hapus kegiatan "${activity.name}"?`)) return;
      try {
        await api.del(`/activities/${id}`);
        toast('Kegiatan dihapus', 'ok');
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ---- Resource ----
  $('#btn-add-resource').addEventListener('click', () => {
    state.editingResourceId = null;
    $('#resource-form').classList.remove('hidden');
    $('#resource-form').reset();
    $('#resource-rate').value = '0';
    $('#resource-name').focus();
  });
  $('#btn-cancel-resource').addEventListener('click', () => {
    state.editingResourceId = null;
    $('#resource-form').classList.add('hidden');
    $('#resource-form').reset();
  });

  $('#resource-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: $('#resource-name').value.trim(),
      email: $('#resource-email').value.trim(),
      phone: $('#resource-phone').value.trim(),
      position: $('#resource-position').value.trim(),
      daily_rate: Number($('#resource-rate').value || 0),
    };
    try {
      if (state.editingResourceId) {
        await api.put(`/resources/${state.editingResourceId}`, payload);
        toast('Resource diperbarui', 'ok');
      } else {
        await api.post(`/projects/${state.projectId}/resources`, payload);
        toast('Resource ditambahkan', 'ok');
      }
      state.editingResourceId = null;
      $('#resource-form').classList.add('hidden');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#resource-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const resource = state.resources.find((r) => r.id === id);
    if (btn.dataset.act === 'edit-res') {
      state.editingResourceId = id;
      $('#resource-form').classList.remove('hidden');
      $('#resource-name').value = resource.name;
      $('#resource-email').value = resource.email || '';
      $('#resource-phone').value = resource.phone || '';
      $('#resource-position').value = resource.position || '';
      $('#resource-rate').value = String(resource.daily_rate || 0);
      $('#resource-name').focus();
    } else if (btn.dataset.act === 'delete-res') {
      if (!confirm(`Hapus resource "${resource.name}"?`)) return;
      try {
        await api.del(`/resources/${id}`);
        toast('Resource dihapus', 'ok');
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  $('#assign-activity').addEventListener('change', renderAssignList);

  $('#assign-list').addEventListener('change', async (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-res]');
    if (!cb) return;
    const activityId = Number($('#assign-activity').value);
    const resourceId = Number(cb.dataset.res);
    try {
      if (cb.checked) {
        await api.post(`/activities/${activityId}/resources`, { resource_id: resourceId });
        toast('Resource ditugaskan', 'ok');
      } else {
        await api.del(`/activities/${activityId}/resources/${resourceId}`);
        toast('Penugasan dilepas', 'ok');
      }
      await refresh();
      $('#assign-activity').value = String(activityId);
      renderAssignList();
    } catch (err) {
      toast(err.message, 'error');
      cb.checked = !cb.checked;
    }
  });

  // ---- Pengaturan ----
  $('#project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const weekend = [...document.querySelectorAll('#weekend-picker input:checked')].map(
      (cb) => Number(cb.value)
    );
    const payload = {
      name: $('#project-name').value.trim(),
      start_date: $('#project-start').value,
      weekend_days: weekend.join(','),
    };
    try {
      if (state.creatingProject || state.projectId == null) {
        const res = await api.post('/projects', payload);
        state.projectId = res.data.id;
        state.creatingProject = false;
        toast('Proyek dibuat', 'ok');
      } else {
        await api.put(`/projects/${state.projectId}`, payload);
        toast('Proyek diperbarui', 'ok');
      }
      await loadProjects();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-delete-project').addEventListener('click', async () => {
    if (state.projectId == null) return;
    const p = state.project;
    if (!confirm(`Hapus proyek "${p ? p.name : ''}" beserta seluruh kegiatan, resource, dan hari liburnya?`)) return;
    try {
      await api.del(`/projects/${state.projectId}`);
      toast('Proyek dihapus', 'ok');
      state.projectId = null;
      await loadProjects();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#holiday-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${state.projectId}/holidays`, {
        date: $('#holiday-date').value,
        name: $('#holiday-name').value.trim() || 'Hari Libur',
      });
      $('#holiday-date').value = '';
      $('#holiday-name').value = '';
      toast('Hari libur ditambahkan', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#holiday-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act="delete-holiday"]');
    if (!btn) return;
    try {
      await api.del(`/holidays/${btn.dataset.id}`);
      toast('Hari libur dihapus', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ============================== Init =============================== */

function renderWeekendPicker() {
  $('#weekend-picker').innerHTML = HARI.map(
    (h, i) =>
      `<label><input type="checkbox" value="${i}" ${i === 0 || i === 6 ? 'checked' : ''}/> ${h}</label>`
  ).join('');
}

async function init() {
  renderWeekendPicker();
  bindEvents();
  try {
    await loadProjects();
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
