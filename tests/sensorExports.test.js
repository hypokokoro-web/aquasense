import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { collectPagedReadings, createCsv, prepareExportRecords, protectSpreadsheetText, resolveHistoryBounds, summarizeExportRecords } from '../src/lib/sensorExports.js';
import { createExcelBuffer } from '../src/lib/sensorExcel.js';

const records = [
  { id: 3, aquarium_id: 8, temperature: null, ph_level: 7.2, source: 'manual_test', created_at: '2026-10-20T02:30:00+08:00' },
  { id: 2, aquarium_id: 8, temperature: -2.5, ph_level: '', source: 'esp32', created_at: '2026-10-20T01:30:00Z' },
  { id: 3, aquarium_id: 8, temperature: 25, ph_level: 7.4, source: 'simulation', created_at: '2026-10-20T02:30:00+08:00' },
  { id: 4, aquarium_id: 8, temperature: 25, ph_level: 7, source: 'esp32', created_at: 'not-a-time' },
];

test('normalizes timezone timestamps, sorts oldest-first, removes duplicate IDs, and preserves missing values', () => {
  const prepared = prepareExportRecords(records);
  assert.deepEqual(prepared.map(record => record.id), ['3', '2']);
  assert.equal(prepared[0].created_at, '2026-10-19T18:30:00.000Z');
  assert.equal(prepared[0].temperature, null);
  assert.equal(prepared[0].ph_level, 7.2);
  assert.equal(prepared[1].temperature, -2.5);
  assert.equal(prepared[1].ph_level, null);
});

test('CSV includes a BOM, descriptive ordered headers, escaped text, and protects formula-like text without altering negative readings', () => {
  const { content } = createCsv(records, { aquariumName: '=Reef,\n"One"', aquariumId: 8 });
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /"Reading ID","Aquarium Name","Aquarium ID","Recorded At"/);
  assert.match(content, /"'=Reef,\n""One"""/);
  assert.match(content, /,"-2\.5","","esp32"/);
  assert.match(content, /2026-10-20T01:30:00\.000Z/);
  assert.equal((content.match(/"'=/g) || []).length, 2);
  assert.equal(protectSpreadsheetText('\t=SUM(A1:A2)'), "'\t=SUM(A1:A2)");
  assert.match(createCsv([], { aquariumName: 'Empty', aquariumId: 1 }).content, /"Reading ID".*"Data Source"/s);
});

test('large exports are paged, deduplicated, and rejected rather than silently truncated above the limit', async () => {
  const all = Array.from({ length: 1201 }, (_, index) => ({ id: index + 1 }));
  const pages = [];
  const collected = await collectPagedReadings(async (start, end) => {
    pages.push([start, end]);
    return all.slice(start, end + 1);
  }, all.length);
  assert.equal(collected.length, 1201);
  assert.deepEqual(pages, [[0, 499], [500, 999], [1000, 1200]]);
  await assert.rejects(() => collectPagedReadings(async () => { throw new Error('must not fetch'); }, 501, { maxRows: 500 }), /narrow the date range/);
  await assert.rejects(() => collectPagedReadings(async () => [{ id: 1 }, { id: 1 }], 2), /unique rows were retrieved/);
  await assert.rejects(() => collectPagedReadings(async () => { throw new Error('query failed'); }, 1), /query failed/);
});

test('selected time filters produce exact ISO bounds and reject invalid custom ranges', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const lastHour = resolveHistoryBounds('1H', '', '', now);
  assert.equal(lastHour.startIso, '2026-10-19T23:00:00.000Z');
  assert.equal(lastHour.endIso, '2026-10-20T00:00:00.000Z');
  const custom = resolveHistoryBounds('CUSTOM', '2026-10-20T09:00:00+08:00', '2026-10-20T10:00:00+08:00', now);
  assert.equal(custom.startIso, '2026-10-20T01:00:00.000Z');
  assert.equal(custom.endIso, '2026-10-20T02:00:00.000Z');
  assert.match(resolveHistoryBounds('CUSTOM', 'invalid', '2026-10-20T10:00:00', now).error, /valid date range/);
  assert.match(resolveHistoryBounds('CUSTOM', '2026-10-20T10:00:00', '2026-10-20T09:00:00', now).error, /valid date range/);
});

test('summary statistics ignore missing measurements and return null when a metric has no values', () => {
  const summary = summarizeExportRecords(prepareExportRecords(records));
  assert.equal(summary.count, 2);
  assert.equal(summary.temperature.min, -2.5);
  assert.equal(summary.temperature.max, -2.5);
  assert.equal(summary.temperature.avg, -2.5);
  assert.equal(summary.ph.min, 7.2);
  assert.equal(summary.ph.max, 7.2);
  assert.equal(summary.ph.avg, 7.2);
  assert.equal(summarizeExportRecords([]).temperature.avg, null);
});

test('Excel workbook has styled, frozen, filtered records and an actual summary sheet', async () => {
  const exportedAt = new Date('2026-10-20T03:00:00Z');
  const { buffer, workbook: sourceWorkbook } = await createExcelBuffer(records, {
    aquariumName: 'Reef, "One"', aquariumId: 8,
    dateRangeLabel: '2026-10-19T00:00:00.000Z to 2026-10-20T03:00:00.000Z', exportedAt,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const data = workbook.getWorksheet('Sensor Readings');
  const summary = workbook.getWorksheet('Summary');
  assert.equal(sourceWorkbook.getWorksheet('Sensor Readings').autoFilter.to, 'G6');
  assert.ok(data);
  assert.ok(summary);
  assert.equal(data.getCell('A4').value, 'Reading ID');
  assert.equal(data.getCell('D5').type, ExcelJS.ValueType.Date);
  assert.equal(data.getCell('E5').value, null);
  assert.equal(data.getCell('F5').value, 7.2);
  assert.equal(data.getCell('A5').value, '3');
  assert.equal(data.getCell('B5').value, 'Reef, "One"');
  assert.equal(data.getCell('E6').value, -2.5);
  assert.equal(data.views[0].ySplit, 4);
  assert.equal(data.getCell('A4').fill.fgColor.argb, 'FF66FDEC');
  assert.equal(summary.getCell('B7').value, 2);
  assert.equal(summary.getCell('B10').value, -2.5);
  assert.equal(summary.getCell('C10').value, 7.2);
  assert.equal(summary.getCell('B14').type, ExcelJS.ValueType.Date);
});

test('empty Excel export has zero rows and blank measurement statistics', async () => {
  const { buffer } = await createExcelBuffer([], { aquariumName: 'Home Aquarium', aquariumId: 1, dateRangeLabel: 'empty' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const data = workbook.getWorksheet('Sensor Readings');
  const summary = workbook.getWorksheet('Summary');
  assert.equal(data.rowCount, 4);
  assert.equal(summary.getCell('B7').value, 0);
  assert.equal(summary.getCell('B10').value, null);
  assert.equal(summary.getCell('C10').value, null);
  assert.equal(summary.getCell('B14').value, 'No data');
});
