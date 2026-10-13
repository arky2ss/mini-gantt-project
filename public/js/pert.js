'use strict';

/**
 * Renderer diagram PERT (node + panah).
 *
 * data = {
 *   nodes: [{id, code, name, duration, startDate, endDate, es, ef, critical, layer}],
 *   edges: [{from, to, type, delay, critical}],
 *   layers: number
 * }
 */
function renderPert(host, data) {
  host.innerHTML = '';
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  if (nodes.length === 0) {
    host.innerHTML = '<div class="empty" style="padding:24px">Belum ada kegiatan untuk diagram PERT.</div>';
    return;
  }

  const COL_W = 250;
  const NODE_W = 180;
  const NODE_H = 74;
  const ROW_H = 104;
  const PAD_X = 30;
  const PAD_Y = 40;

  // Susun node per layer (kolom), urut berdasarkan early start di dalam layer.
  const byLayer = new Map();
  nodes.forEach((n) => {
    const layer = n.layer || 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(n);
  });
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(...layerKeys.map((k) => byLayer.get(k).length), 1);

  const pos = new Map();
  layerKeys.forEach((layer) => {
    const list = byLayer.get(layer).sort((a, b) => a.es - b.es || a.id - b.id);
    list.forEach((n, idx) => {
      pos.set(n.id, {
        x: PAD_X + layer * COL_W,
        y: PAD_Y + idx * ROW_H,
        layer,
        indexInLayer: idx,
      });
    });
  });

  const width = PAD_X * 2 + (layerKeys.length - 1) * COL_W + NODE_W;
  const height = PAD_Y * 2 + maxRows * ROW_H;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'pert-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;

  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML =
    '<marker id="pert-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8a93ab"></path></marker>' +
    '<marker id="pert-arrow-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#e5484d"></path></marker>';
  svg.appendChild(defs);

  // Label layer
  layerKeys.forEach((layer) => {
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('class', 'pert-layer-label');
    text.setAttribute('x', PAD_X + layer * COL_W);
    text.setAttribute('y', 22);
    text.textContent = `Tahap ${layer + 1}`;
    svg.appendChild(text);
  });

  // Panah
  edges.forEach((e) => {
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) return;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const dx = Math.max(40, (x2 - x1) / 2);
    const d =
      x2 > x1
        ? `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1 + 60} ${y1 + 60}, ${x2 - 60} ${y2 - 60}, ${x2} ${y2}`;

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'pert-edge' + (e.critical ? ' critical' : ''));
    path.setAttribute('marker-end', e.critical ? 'url(#pert-arrow-critical)' : 'url(#pert-arrow)');
    path.setAttribute('stroke-dasharray', e.type === 'SS' ? '6 4' : 'none');
    svg.appendChild(path);

    const label = document.createElementNS(svgNS, 'text');
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 6;
    label.setAttribute('class', 'pert-edge-label' + (e.critical ? ' critical' : ''));
    label.setAttribute('x', mx);
    label.setAttribute('y', my);
    label.setAttribute('text-anchor', 'middle');
    label.textContent = `${e.type}${e.delay ? '+' + e.delay : ''}`;
    svg.appendChild(label);
  });

  // Node
  nodes.forEach((n) => {
    const p = pos.get(n.id);
    if (!p) return;
    const g = document.createElementNS(svgNS, 'g');

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('class', 'pert-node' + (n.critical ? ' critical' : ''));
    rect.setAttribute('x', p.x);
    rect.setAttribute('y', p.y);
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 9);
    g.appendChild(rect);

    const title = document.createElementNS(svgNS, 'text');
    title.setAttribute('class', 'pert-node-title');
    title.setAttribute('x', p.x + 12);
    title.setAttribute('y', p.y + 22);
    title.textContent = truncate(`${n.code || ''} - ${n.name}`, 24);
    g.appendChild(title);

    const sub = document.createElementNS(svgNS, 'text');
    sub.setAttribute('class', 'pert-node-sub');
    sub.setAttribute('x', p.x + 12);
    sub.setAttribute('y', p.y + 41);
    sub.textContent = `Durasi: ${n.duration} hari  |  Float: ${n.float}`;
    g.appendChild(sub);

    const dates = document.createElementNS(svgNS, 'text');
    dates.setAttribute('class', 'pert-node-sub');
    dates.setAttribute('x', p.x + 12);
    dates.setAttribute('y', p.y + 59);
    dates.textContent = `${n.startDate} s/d ${n.endDate}` + (n.critical ? '  (KRITIS)' : '');
    g.appendChild(dates);

    svg.appendChild(g);
  });

  host.appendChild(svg);
}

function truncate(text, max) {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
