export const SENSOR_EXPORT_HEADERS = [
  'Reading ID', 'Aquarium Name', 'Aquarium ID', 'Recorded At',
  'Temperature (°C)', 'pH Level', 'Data Source',
];

export function validMeasurement(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolveHistoryBounds(range, customStart, customEnd, now = Date.now()) {
  let startMs, endMs = now;
  if (range === '1H') startMs = now - 60 * 60 * 1000;
  else if (range === '24H') startMs = now - 24 * 60 * 60 * 1000;
  else if (range === '7D') startMs = now - 7 * 86400000;
  else if (range === '30D') startMs = now - 30 * 86400000;
  else if (range === 'CUSTOM') {
    const start = new Date(customStart).getTime();
    const end = new Date(customEnd).getTime();
    startMs = Number.isFinite(start) ? start : NaN;
    endMs = Number.isFinite(end) ? end : NaN;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return { error: 'Choose a valid date range where the start comes before the end.' };
  return { startMs, endMs, startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export function prepareExportRecords(readings) {
  const seen = new Set();
  return [...(readings || [])]
    .filter(reading => reading?.created_at && Number.isFinite(new Date(reading.created_at).getTime()))
    .filter(reading => {
      const id = String(reading.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(reading => ({
      id: String(reading.id ?? ''),
      aquarium_id: String(reading.aquarium_id ?? ''),
      created_at: new Date(reading.created_at).toISOString(),
      temperature: validMeasurement(reading.temperature),
      ph_level: validMeasurement(reading.ph_level),
      source: reading.source == null ? '' : String(reading.source),
    }))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export async function collectPagedReadings(fetchPage, expectedCount, { pageSize = 500, maxRows = 50000 } = {}) {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) throw new Error('Supabase did not return a valid row count, so the export was stopped to avoid an incomplete file.');
  if (expectedCount > maxRows) throw new Error(`${expectedCount.toLocaleString()} records match this range. To avoid an incomplete or memory-heavy file, narrow the date range to ${maxRows.toLocaleString()} records or fewer and export again.`);
  const rows = [];
  const seen = new Set();
  for (let offset = 0; offset < expectedCount; offset += pageSize) {
    const end = Math.min(offset + pageSize, expectedCount) - 1;
    const page = await fetchPage(offset, end);
    for (const row of page || []) {
      const id = String(row.id);
      if (!seen.has(id)) { seen.add(id); rows.push(row); }
    }
  }
  if (rows.length !== expectedCount) {
    throw new Error(`The database reported ${expectedCount.toLocaleString()} matching rows, but ${rows.length.toLocaleString()} unique rows were retrieved. No file was created. Retry the export or narrow the date range.`);
  }
  return rows;
}

export function protectSpreadsheetText(value) {
  const text = String(value ?? '');
  return /^[\t\r\n ]*[=+@-]/.test(text) ? `'${text}` : text;
}

function csvField(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function createCsv(readings, { aquariumName, aquariumId }) {
  const records = prepareExportRecords(readings);
  const rows = [SENSOR_EXPORT_HEADERS];
  for (const reading of records) {
    rows.push([
      protectSpreadsheetText(reading.id),
      protectSpreadsheetText(aquariumName),
      protectSpreadsheetText(reading.aquarium_id || aquariumId),
      reading.created_at,
      reading.temperature,
      reading.ph_level,
      protectSpreadsheetText(reading.source),
    ]);
  }
  const csv = rows.map(row => row.map(csvField).join(',')).join('\r\n');
  return { records, content: `\uFEFF${csv}` };
}

export function summarizeExportRecords(records) {
  const statistics = key => {
    const values = records.map(record => record[key]).filter(Number.isFinite);
    if (!values.length) return { min: null, max: null, avg: null };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  };
  const latest = records.length ? records[records.length - 1].created_at : null;
  return { temperature: statistics('temperature'), ph: statistics('ph_level'), count: records.length, latest };
}

