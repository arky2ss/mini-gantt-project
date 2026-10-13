'use strict';

/** Error dengan status HTTP, ditangani oleh middleware penanganan error. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/** Dependensi melingkar terdeteksi pada graf kegiatan. */
class CycleError extends Error {
  constructor(cyclePath) {
    const seq = cyclePath.join(' -> ');
    super(`Ditemukan dependensi melingkar: ${seq}`);
    this.name = 'CycleError';
    this.cycle = cyclePath;
  }
}

function badRequest(message, details) {
  return new HttpError(400, message, details);
}

function notFound(message) {
  return new HttpError(404, message || 'Data tidak ditemukan');
}

module.exports = { HttpError, CycleError, badRequest, notFound };
