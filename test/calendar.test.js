'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Calendar, parseDate, formatDate, addDays } = require('../src/calendar');

test('parseDate menerima format YYYY-MM-DD', () => {
  assert.equal(formatDate(parseDate('2026-01-05')), '2026-01-05');
  assert.equal(formatDate(parseDate('2026-12-31')), '2026-12-31');
});

test('parseDate menolak format yang salah dengan status 400', () => {
  for (const bad of ['05/01/2026', '2026-13-01', '2026-02-30', 'abc', 42, null]) {
    assert.throws(
      () => parseDate(bad, 'start_date'),
      (err) => err.status === 400,
      `seharusnya menolak ${JSON.stringify(bad)}`
    );
  }
});

test('Calendar menolak semua hari ditandai weekend', () => {
  assert.throws(
    () => new Calendar({ weekendDays: '0,1,2,3,4,5,6' }),
    (err) => err.status === 400
  );
});

test('Calendar menolak hari weekend di luar rentang 0-6', () => {
  assert.throws(() => new Calendar({ weekendDays: '7' }), (err) => err.status === 400);
  assert.throws(() => new Calendar({ weekendDays: '-1' }), (err) => err.status === 400);
});

test('weekend dilewati: Jumat + 1 hari kerja = Senin', () => {
  const cal = new Calendar({ weekendDays: '0,6' });
  const friday = parseDate('2026-01-09');
  assert.equal(formatDate(cal.nextWorkingDay(friday)), '2026-01-09');
  assert.equal(formatDate(cal.addWorkingDays(friday, 0)), '2026-01-09');
  assert.equal(formatDate(cal.addWorkingDays(friday, 1)), '2026-01-12'); // Senin
  assert.equal(formatDate(cal.addWorkingDays(friday, 3)), '2026-01-14'); // Rabu
});

test('addWorkingDays menyeberangi akhir pekan maju dan mundur', () => {
  const cal = new Calendar({ weekendDays: '0,6' });
  const saturday = parseDate('2026-01-10');
  assert.equal(formatDate(cal.nextWorkingDay(saturday)), '2026-01-12'); // Senin
  const sunday = parseDate('2026-01-11');
  assert.equal(formatDate(cal.addWorkingDays(sunday, 0)), '2026-01-12');
});

test('hari libur dilewati saat menghitung hari kerja', () => {
  const cal = new Calendar({
    weekendDays: '0,6',
    holidays: ['2026-01-12'], // Senin
  });
  assert.equal(cal.isWorkingDay(parseDate('2026-01-12')), false);
  const friday = parseDate('2026-01-09');
  assert.equal(formatDate(cal.addWorkingDays(friday, 1)), '2026-01-13'); // Selasa (Senin libur)
  assert.equal(formatDate(cal.addWorkingDays(friday, 4)), '2026-01-16'); // Jumat
});

test('durasi hari kerja: tanggal selesai = mulai + (durasi-1) hari kerja', () => {
  const cal = new Calendar({ weekendDays: '0,6', holidays: ['2026-01-01'] });
  const start = cal.nextWorkingDay(parseDate('2026-01-01')); // libur -> Jumat 2026-01-02
  assert.equal(formatDate(start), '2026-01-02');
  const finish = cal.addWorkingDays(start, 4); // 5 hari kerja: 2,5,6,7,8 Jan
  assert.equal(formatDate(finish), '2026-01-08');
});

test('maju 0 hari kerja tetap mengembalikan hari kerja terdekat', () => {
  const cal = new Calendar({ weekendDays: '0,6' });
  const weekend = parseDate('2026-01-10');
  assert.equal(formatDate(cal.addWorkingDays(weekend, 0)), '2026-01-12');
  assert.equal(formatDate(cal.addDays ? cal.addDays(weekend, 1) : addDays(weekend, 1)), '2026-01-11');
});

test('isWorkingDay mengikuti setelan weekend yang bisa dikonfigurasi', () => {
  const cal = new Calendar({ weekendDays: '5,6' }); // Jumat & Sabtu libur
  assert.equal(cal.isWorkingDay(parseDate('2026-01-09')), false); // Jumat
  assert.equal(cal.isWorkingDay(parseDate('2026-01-10')), false); // Sabtu
  assert.equal(cal.isWorkingDay(parseDate('2026-01-11')), true); // Minggu
  assert.equal(cal.isWorkingDay(parseDate('2026-01-12')), true); // Senin
});
