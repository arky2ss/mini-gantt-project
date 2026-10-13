'use strict';

const { badRequest } = require('./errors');
const { parseDate, parseWeekendDays } = require('./calendar');

const NAME_MAX = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\-\s]{5,20}$/;
const DEP_TYPES = new Set(['FS', 'SS']);

/** String wajib/opsional dengan panjang maksimum. */
function cleanString(value, field, { required = true, max = NAME_MAX } = {}) {
  if (value == null || value === '') {
    if (required) throw badRequest(`Field '${field}' wajib diisi`);
    return '';
  }
  if (typeof value !== 'string') {
    throw badRequest(`Field '${field}' harus berupa teks`);
  }
  const trimmed = value.trim();
  if (required && trimmed === '') {
    throw badRequest(`Field '${field}' wajib diisi`);
  }
  if (trimmed.length > max) {
    throw badRequest(`Field '${field}' maksimal ${max} karakter`);
  }
  return trimmed;
}

/** Bilangan bulat >= min dan <= max. */
function parseIntField(value, field, { min = 0, max = 1_000_000, required = true, fallback } = {}) {
  if (value == null || value === '') {
    if (required) throw badRequest(`Field '${field}' wajib diisi`);
    return fallback;
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw badRequest(`Field '${field}' harus berupa bilangan bulat`);
  }
  if (num < min) throw badRequest(`Field '${field}' minimal ${min}`);
  if (num > max) throw badRequest(`Field '${field}' maksimal ${max}`);
  return num;
}

/** Bilangan desimal >= min. */
function parseFloatField(value, field, { min = 0, max = 1e12, required = true, fallback = 0 } = {}) {
  if (value == null || value === '') {
    if (required) throw badRequest(`Field '${field}' wajib diisi`);
    return fallback;
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(/,/g, ''));
  if (!Number.isFinite(num)) {
    throw badRequest(`Field '${field}' harus berupa angka`);
  }
  if (num < min) throw badRequest(`Field '${field}' minimal ${min}`);
  if (num > max) throw badRequest(`Field '${field}' maksimal ${max}`);
  return num;
}

/** Validasi objek proyek (create). */
function validateProjectInput(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body request tidak valid');
  const name = cleanString(body.name, 'name');
  const start_date = parseDate(body.start_date, 'start_date') && body.start_date;
  const weekend_days = body.weekend_days == null
    ? '0,6'
    : Array.isArray(body.weekend_days)
      ? body.weekend_days.join(',')
      : String(body.weekend_days);
  parseWeekendDays(weekend_days); // melempar 400 bila tidak valid
  return { name, start_date, weekend_days };
}

/** Validasi update proyek (semua field wajib ada). */
function validateProjectUpdate(body) {
  return validateProjectInput(body);
}

/** Validasi hari libur. */
function validateHolidayInput(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body request tidak valid');
  const date = parseDate(body.date, 'date') && body.date;
  const name = cleanString(body.name, 'name', { required: false, max: 120 }) || 'Hari Libur';
  return { date, name };
}

/**
 * Validasi kegiatan.
 * predecessors diterima sebagai array of {id, type, delay} atau array of id.
 */
function validateActivityInput(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body request tidak valid');
  const name = cleanString(body.name, 'name');
  const duration = parseIntField(body.duration, 'duration', { min: 1, max: 3650 });
  const code = cleanString(body.code, 'code', { required: false, max: 10 });

  const raw = body.predecessors == null ? [] : body.predecessors;
  if (!Array.isArray(raw)) {
    throw badRequest("Field 'predecessors' harus berupa array");
  }
  if (raw.length > 50) throw badRequest('Maksimal 50 pendahulu per kegiatan');

  const predecessors = raw.map((item, idx) => {
    const p = typeof item === 'object' && item !== null ? item : { id: item };
    const id = typeof p.id === 'number' ? p.id : Number(p.id);
    if (!Number.isInteger(id)) {
      throw badRequest(`Predecessor ke-${idx + 1}: id harus berupa angka`);
    }
    const type = p.type == null || p.type === '' ? 'FS' : String(p.type).toUpperCase();
    if (!DEP_TYPES.has(type)) {
      throw badRequest(`Predecessor ke-${idx + 1}: tipe '${type}' tidak dikenal (harus FS atau SS)`);
    }
    const delay = p.delay == null || p.delay === '' ? 0 : parseIntField(p.delay, `predecessors[${idx}].delay`, { min: 0, max: 3650 });
    return { id, type, delay };
  });

  return { name, duration, code, predecessors };
}

/** Validasi resource/anggota tim. */
function validateResourceInput(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body request tidak valid');
  const name = cleanString(body.name, 'name');
  const email = cleanString(body.email, 'email', { required: false, max: 120 });
  if (email && !EMAIL_RE.test(email)) {
    throw badRequest(`Email tidak valid: '${email}'`);
  }
  const phone = cleanString(body.phone, 'phone', { required: false, max: 25 });
  if (phone && !PHONE_RE.test(phone)) {
    throw badRequest(`Nomor telepon tidak valid: '${phone}' (contoh: 0812-3456-7890)`);
  }
  const position = cleanString(body.position, 'position', { required: false, max: 80 });
  const daily_rate = parseFloatField(body.daily_rate, 'daily_rate', { min: 0, fallback: 0 });
  return { name, email, phone, position, daily_rate };
}

/** Validasi penugasan resource ke kegiatan. */
function validateAssignmentInput(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body request tidak valid');
  const resource_id = parseIntField(body.resource_id, 'resource_id', { min: 1 });
  return { resource_id };
}

module.exports = {
  cleanString,
  parseIntField,
  parseFloatField,
  validateProjectInput,
  validateProjectUpdate,
  validateHolidayInput,
  validateActivityInput,
  validateResourceInput,
  validateAssignmentInput,
  NAME_MAX,
  EMAIL_RE,
  PHONE_RE,
};
