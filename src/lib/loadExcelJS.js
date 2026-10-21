let excelJsPromise;

export default function loadExcelJS() {
  if (window.ExcelJS?.Workbook) return Promise.resolve(window.ExcelJS);
  if (excelJsPromise) return excelJsPromise;

  excelJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/exceljs.min.js`;
    script.async = true;
    script.onload = () => {
      if (window.ExcelJS?.Workbook) resolve(window.ExcelJS);
      else {
        excelJsPromise = null;
        reject(new Error('The XLSX exporter loaded but was unavailable.'));
      }
    };
    script.onerror = () => {
      excelJsPromise = null;
      reject(new Error('Could not load the XLSX exporter.'));
    };
    document.head.appendChild(script);
  });

  return excelJsPromise;
}
