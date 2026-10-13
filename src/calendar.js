'use strict';

const { badRequest } = require('./errors');

/**
 * Utilitas kalender kerja.
 * Semua tanggal dipertukarkan sebagai string 'YYYY-MM-DD' (disimpan sebagai UTC).
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Parse 'YYYY-MM-DD' menjadi Date (UTC tengah malam). Lempar HttpError 400 bila tidak valid. */
function parseDate(value, field) {
  const label = field || 'date';
  if (typeof value !== 'string') {
    throw badRequest(`Field '${label}' harus berupa string tanggal format YYYY-MM-DD`);
  }
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) {
    throw badRequest(`Field '${label}' harus berformat YYYY-MM-DD (contoh: 2026-01-05)`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw badRequest(`Field '${label}' bukan tanggal yang valid: ${value}`);
  }
  return date;
}

/** Format Date menjadi 'YYYY-MM-DD'. */
function formatDate(date) {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Tambah n hari kalender. */
function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}

/** Hari dalam pekan: 0 = Minggu ... 6 = Sabtu. */
function dayOfWeek(date) {
  return date.getUTCDay();
}

/**
 * Kalender kerja proyek: hari libur pekan (weekend) + hari libur tambahan.
 */
class Calendar {
  /**
   * @param {object} opts
   * @param {string} [opts.weekendDays] daftar '0,6' (0=Minggu..6=Sabtu)
   * @param {string[]} [opts.holidays] daftar tanggal 'YYYY-MM-DD'
   */
  constructor({ weekendDays = '0,6', holidays = [] } = {}) {
    this.weekendDays = parseWeekendDays(weekendDays);
    this.holidays = new Set(
      holidays.map((h) => (typeof h === 'string' ? h : formatDate(parseDate(h.date, 'date'))))
    );
  }

  /** Apakah tanggal adalah hari kerja? */
  isWorkingDay(date) {
    if (this.weekendDays.has(dayOfWeek(date))) return false;
    if (this.holidays.has(formatDate(date))) return false;
    return true;
  }

  /** Hari kerja pertama pada atau setelah tanggal tsb. */
  nextWorkingDay(date) {
    let current = date;
    for (let i = 0; i < 3660; i += 1) {
      if (this.isWorkingDay(current)) return current;
      current = addDays(current, 1);
    }
    throw badRequest('Tidak menemukan hari kerja dalam 10 tahun (periksa setelan weekend/hari libur)');
  }

  /**
   * Maju n hari kerja dari `date`.
   * addWorkingDays(d, 0) = hari kerja pertama pada/ setelah d.
   */
  addWorkingDays(date, n) {
    if (!Number.isInteger(n) || n < 0) {
      throw badRequest(`Jumlah hari kerja harus bilangan bulat >= 0 (diterima: ${n})`);
    }
    let current = this.nextWorkingDay(date);
    let remaining = n;
    while (remaining > 0) {
      current = this.nextWorkingDay(addDays(current, 1));
      remaining -= 1;
    }
    return current;
  }
}

/** Parse string '0,6' / '0, 6' menjadi Set angka 0..6 (validasi ketat). */
function parseWeekendDays(value) {
  let parts;
  if (typeof value === 'string') {
    parts = value === '' ? [] : value.split(',').map((s) => s.trim());
  } else if (Array.isArray(value)) {
    parts = value;
  } else {
    throw badRequest("Field 'weekend_days' harus berupa string hari (contoh: '0,6') atau array");
  }
  const days = new Set();
  for (const raw of parts) {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(num) || num < 0 || num > 6) {
      throw badRequest(`Hari weekend tidak valid: '${raw}' (harus 0=Minggu .. 6=Sabtu)`);
    }
    if (days.has(num)) {
      throw badRequest(`Hari weekend duplikat: ${num}`);
    }
    days.add(num);
  }
  if (days.size === 7) {
    throw badRequest('Semua hari ditandai weekend, tidak ada hari kerja sama sekali');
  }
  return days;
}

module.exports = {
  Calendar,
  parseDate,
  formatDate,
  addDays,
  dayOfWeek,
  parseWeekendDays,
};
