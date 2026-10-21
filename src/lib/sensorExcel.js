import ExcelJS from 'exceljs';
import { prepareExportRecords, summarizeExportRecords } from './sensorExports.js';

export async function createExcelBuffer(readings, { aquariumName, aquariumId, dateRangeLabel, exportedAt = new Date() }) {
  const records = prepareExportRecords(readings);
  const summary = summarizeExportRecords(records);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AquaSense';
  workbook.subject = 'Historical aquarium sensor readings';
  workbook.title = 'AquaSense Sensor Readings';
  workbook.created = exportedAt;
  workbook.modified = exportedAt;

  const text = value => String(value ?? '');
  const dataSheet = workbook.addWorksheet('Sensor Readings', { properties: { defaultRowHeight: 20 } });
  dataSheet.columns = [
    { key: 'id', width: 20 }, { key: 'aquariumName', width: 30 }, { key: 'aquariumId', width: 17 },
    { key: 'createdAt', width: 28 }, { key: 'temperature', width: 19 }, { key: 'ph', width: 14 }, { key: 'source', width: 20 },
  ];
  dataSheet.mergeCells('A1:G1');
  dataSheet.getCell('A1').value = 'AquaSense Sensor Readings';
  dataSheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  dataSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF071A28' } };
  dataSheet.getRow(1).height = 34;
  dataSheet.mergeCells('A2:G2');
  dataSheet.getCell('A2').value = `Aquarium: ${text(aquariumName || 'Home Aquarium')}  ·  Date range: ${dateRangeLabel}`;
  dataSheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF31535F' } };
  dataSheet.getRow(3).height = 8;

  const headers = ['Reading ID', 'Aquarium Name', 'Aquarium ID', 'Recorded At', 'Temperature (°C)', 'pH Level', 'Data Source'];
  const headerRow = dataSheet.getRow(4);
  headerRow.values = headers;
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF071A28' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF66FDEC' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF40E0D0' } } };
  });

  for (const [index, reading] of records.entries()) {
    const row = dataSheet.addRow([
      text(reading.id), text(aquariumName || 'Home Aquarium'), text(reading.aquarium_id || aquariumId),
      new Date(reading.created_at), reading.temperature, reading.ph_level, text(reading.source),
    ]);
    row.getCell(4).numFmt = 'yyyy-mm-dd hh:mm:ss "UTC"';
    row.getCell(5).numFmt = '0.00 "°C"';
    row.getCell(6).numFmt = '0.00';
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF203643' } };
      cell.alignment = { vertical: 'middle' };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1FAFA' } };
    });
  }
  dataSheet.autoFilter = { from: 'A4', to: `G${Math.max(4, records.length + 4)}` };
  dataSheet.views = [{ state: 'frozen', ySplit: 4, topLeftCell: 'A5', activeCell: 'A5' }];

  const summarySheet = workbook.addWorksheet('Summary', { properties: { defaultRowHeight: 21 } });
  summarySheet.columns = [{ width: 32 }, { width: 28 }, { width: 28 }];
  summarySheet.mergeCells('A1:C1');
  summarySheet.getCell('A1').value = 'AquaSense Historical Readings Report';
  summarySheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF071A28' } };
  summarySheet.getRow(1).height = 35;
  const metadata = [
    ['Exported at (UTC)', exportedAt, 'yyyy-mm-dd hh:mm:ss "UTC"'],
    ['Aquarium', text(aquariumName || 'Home Aquarium'), null],
    ['Aquarium ID', text(aquariumId), null],
    ['Selected date range', dateRangeLabel, null],
    ['Exported records', summary.count, '#,##0'],
  ];
  metadata.forEach(([label, value, numFmt], index) => {
    const row = summarySheet.getRow(index + 3);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: 'FF31535F' } };
    row.getCell(2).value = value ?? '';
    if (numFmt) row.getCell(2).numFmt = numFmt;
  });
  const statHeader = summarySheet.getRow(9);
  statHeader.values = ['Measurement summary', 'Temperature (°C)', 'pH Level'];
  statHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF071A28' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF66FDEC' } };
  });
  [
    ['Minimum', summary.temperature.min, summary.ph.min],
    ['Maximum', summary.temperature.max, summary.ph.max],
    ['Average', summary.temperature.avg, summary.ph.avg],
  ].forEach((values, index) => {
    const row = summarySheet.getRow(index + 10);
    row.values = values;
    row.getCell(2).numFmt = '0.00';
    row.getCell(3).numFmt = '0.00';
  });
  const latestRow = summarySheet.getRow(14);
  latestRow.getCell(1).value = 'Latest recorded timestamp (UTC)';
  latestRow.getCell(1).font = { bold: true, color: { argb: 'FF31535F' } };
  latestRow.getCell(2).value = summary.latest ? new Date(summary.latest) : 'No data';
  if (summary.latest) latestRow.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss "UTC"';
  summarySheet.getCell('A16').value = 'All timestamps are stored and displayed in UTC. Empty measurement cells indicate missing sensor values.';
  summarySheet.getCell('A16').font = { italic: true, size: 9, color: { argb: 'FF66818A' } };
  summarySheet.mergeCells('A16:C16');

  return { buffer: await workbook.xlsx.writeBuffer(), records, summary, workbook };
}
