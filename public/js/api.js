'use strict';

/** Helper fetch ke REST API /api/* dengan pesan error yang ramah. */
const api = {
  async request(method, path, body) {
    const init = { method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`/api${path}`, init);
    } catch (err) {
      throw new Error('Tidak dapat terhubung ke server');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const error = new Error(
        (data && data.error) || `Permintaan gagal (HTTP ${res.status})`
      );
      error.status = res.status;
      error.details = data ? data.details : undefined;
      throw error;
    }
    return data;
  },
  get(path) {
    return this.request('GET', path);
  },
  post(path, body) {
    return this.request('POST', path, body);
  },
  put(path, body) {
    return this.request('PUT', path, body);
  },
  del(path) {
    return this.request('DELETE', path);
  },
};

/** Format angka sebagai rupiah. */
function fmtRp(value) {
  const n = Number(value) || 0;
  return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

/** Format tanggal ISO menjadi tampilan Indonesia. */
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d.getUTCDate()} ${bulan[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Escape teks untuk dimasukkan ke innerHTML. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
