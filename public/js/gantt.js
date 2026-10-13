'use strict';

/**
 * Renderer Gantt chart (bar timeline + garis ketergantungan).
 *
 * data = {
 *   activities: [{id, code, name, duration, startDayIndex, endDayIndex,
 *                 startDate, endDate, critical, predecessors, resources}],
 *   project_start, project_end, calendar_days,
 *   weekendDays: Set<number>, holidays: Set<'YYYY-MM-DD'>
 * }
 */
function renderGantt(host, data) {
  host.innerHTML = '';
  const acts = (data.activities || []).slice().sort((a, b) => {
    if (a.startDayIndex !== b.startDayIndex) return a.startDayIndex - b.startDayIndex;
    return a.id - b.id;
  });

  if (acts.length === 0) {
    host.innerHTML = '<div class="empty" style="padding:24px">Belum ada kegiatan. Tambahkan pada tab Kegiatan.</div>';
    return;
  }

  const COL = 26;
  const ROW = 34;
  const start = data.project_start;
  const totalDays = Math.max(data.calendar_days || 1, 1);
  const weekend = data.weekendDays instanceof Set ? data.weekendDays : new Set([0, 6]);
  const holidays = data.holidays instanceof Set ? data.holidays : new Set();

  const dayList = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(startDate.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    dayList.push({
      index: i,
      date: d,
      iso,
      dow: d.getUTCDay(),
      day: d.getUTCDate(),
      month: d.getUTCMonth(),
      year: d.getUTCFullYear(),
      isWeekend: weekend.has(d.getUTCDay()),
      isHoliday: holidays.has(iso),
    });
  }

  const gridWidth = totalDays * COL;

  // ------- label kiri -------
  const labels = document.createElement('div');
  labels.className = 'gantt-labels';
  const lhead = document.createElement('div');
  lhead.className = 'lhead';
  lhead.textContent = `Kegiatan (${acts.length})`;
  labels.appendChild(lhead);
  acts.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'lrow' + (a.critical ? ' critical' : '');
    row.title = a.name;
    row.innerHTML = `<span class="code">${esc(a.code)}</span><span class="nm">${esc(a.name)}</span>`;
    labels.appendChild(row);
  });

  // ------- area timeline -------
  const scroll = document.createElement('div');
  scroll.className = 'gantt-grid';
  scroll.style.width = `${gridWidth}px`;
  scroll.style.setProperty('--col', `${COL}px`);

  // header
  const head = document.createElement('div');
  head.className = 'gantt-head';

  const monthsRow = document.createElement('div');
  monthsRow.className = 'months';
  let i = 0;
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  while (i < dayList.length) {
    const m = dayList[i].month;
    let span = 0;
    while (i + span < dayList.length && dayList[i + span].month === m) span += 1;
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    cell.style.width = `${span * COL}px`;
    cell.style.flex = `0 0 ${span * COL}px`;
    cell.textContent = `${MONTHS[m]} ${dayList[i].year}`;
    monthsRow.appendChild(cell);
    i += span;
  }
  head.appendChild(monthsRow);

  const daysRow = document.createElement('div');
  daysRow.className = 'days';
  const HARI = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];
  dayList.forEach((d) => {
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (d.isHoliday ? ' holiday' : d.isWeekend ? ' we' : '');
    cell.innerHTML = `<b>${d.day}</b>${HARI[d.dow]}`;
    daysRow.appendChild(cell);
  });
  head.appendChild(daysRow);
  scroll.appendChild(head);

  // body rows
  const body = document.createElement('div');
  body.className = 'gantt-body';
  body.style.height = `${acts.length * ROW}px`;

  acts.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'gantt-row' + (a.critical ? ' critical' : '');
    row.dataset.activityId = String(a.id);
    dayList.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'cell' + (d.isHoliday ? ' holiday' : d.isWeekend ? ' we' : '');
      cell.style.left = `${d.index * COL}px`;
      row.appendChild(cell);
    });

    const bar = document.createElement('div');
    const startIdx = dayIndexOfDay(a.startDate, start);
    const endIdx = dayIndexOfDay(a.endDate, start);
    const left = Math.max(0, startIdx) * COL;
    const width = Math.max(COL * 0.5, (endIdx - Math.max(0, startIdx) + 1) * COL);
    bar.className = 'bar' + (a.critical ? ' critical' : '');
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;
    bar.style.top = '7px';
    bar.title = `${a.code} - ${a.name}\n${a.startDate} s/d ${a.endDate} (${a.duration} hari kerja)` +
      (a.critical ? '\nJalur KRITIS' : '') +
      (a.resources && a.resources.length ? `\nResource: ${a.resources.map((r) => r.name).join(', ')}` : '');
    bar.innerHTML = `<span class="bar-label">${esc(a.code)} &middot; ${a.duration}h</span>`;
    row.appendChild(bar);
    body.appendChild(row);
  });

  // overlay garis ketergantungan
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'gantt-deps');
  svg.setAttribute('width', gridWidth);
  svg.setAttribute('height', acts.length * ROW);
  svg.style.width = `${gridWidth}px`;
  svg.style.height = `${acts.length * ROW}px`;

  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML =
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8a93ab"></path></marker>' +
    '<marker id="arrow-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#e5484d"></path></marker>';
  svg.appendChild(defs);

  const rowIndex = new Map(acts.map((a, idx) => [a.id, idx]));

  acts.forEach((a) => {
    (a.predecessors || []).forEach((p) => {
      const pred = acts.find((x) => x.id === p.id);
      if (!pred) return;
      const y1 = (rowIndex.get(pred.id) + 0.5) * ROW;
      const y2 = (rowIndex.get(a.id) + 0.5) * ROW;
      const predStart = dayIndexOfDay(pred.startDate, start);
      const predEnd = dayIndexOfDay(pred.endDate, start);
      const succStart = dayIndexOfDay(a.startDate, start);

      let x1;
      let x2;
      if (p.type === 'SS') {
        x1 = Math.max(0, predStart) * COL + COL / 2;
        x2 = Math.max(0, succStart) * COL + COL / 2;
      } else {
        x1 = (Math.max(0, predEnd) + 1) * COL;
        x2 = Math.max(0, succStart) * COL;
      }
      if (x2 < x1) x2 = x1 + 6;

      const midX = x1 + Math.max(8, (x2 - x1) / 2);
      const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
      const isCriticalEdge = pred.critical && a.critical;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'dep-path' + (isCriticalEdge ? ' critical' : ''));
      path.setAttribute('marker-end', isCriticalEdge ? 'url(#arrow-critical)' : 'url(#arrow)');
      path.setAttribute('stroke-dasharray', p.type === 'SS' ? '5 3' : 'none');
      path.setAttribute(
        'aria-label',
        `${pred.code} -> ${a.code} (${p.type}, delay ${p.delay})`
      );
      svg.appendChild(path);
    });
  });

  body.appendChild(svg);
  scroll.appendChild(body);

  const wrap = document.createElement('div');
  wrap.className = 'gantt';
  wrap.appendChild(labels);
  wrap.appendChild(scroll);
  host.appendChild(wrap);
}

/** Offset hari kalender dari tanggal proyek menuju tanggal tsb. */
function dayIndexOfDay(iso, projectStart) {
  if (!iso) return 0;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${projectStart}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}
