/**
 * @file pdfTable.js
 * @description Helper compartido para dibujar una tabla simple (encabezado + filas) en
 * un documento jsPDF. jsPDF no trae soporte de tablas integrado (no está instalado
 * `jspdf-autotable`), así que el layout de columnas se calcula a mano. Usado por
 * ReportesPage (exportación de analítica) y ComprasPage (PDF de una requisición).
 * @author Dicrejart Dev Team
 */

/**
 * Dibuja una tabla en el documento, partiendo en una nueva página y repitiendo el
 * encabezado cuando se acaba el espacio vertical.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {Object} params
 * @param {string} params.title - Título arriba de la tabla
 * @param {Array<string>} params.headers - Encabezados de columna
 * @param {Array<Array<string|number>>} params.rows - Filas de la tabla
 * @param {number} params.startY - Posición vertical inicial (mm)
 * @returns {number} Posición vertical donde continuar dibujando después de la tabla
 */
export const addPdfTable = (doc, { title, headers, rows, startY }) => {
  const marginLeft = 14;
  const pageWidth = 182;
  const colWidth = pageWidth / headers.length;
  const lineHeight = 6;
  let y = startY;

  if (title) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(title, marginLeft, y);
    y += 7;
  }

  const printRow = (cells, bold) => {
    doc.setFontSize(9);
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    cells.forEach((cell, i) => {
      doc.text(String(cell ?? ''), marginLeft + i * colWidth, y, { maxWidth: colWidth - 2 });
    });
    y += lineHeight;
  };

  const printHeader = () => {
    printRow(headers, true);
    doc.setDrawColor(200);
    doc.line(marginLeft, y - 4, marginLeft + pageWidth, y - 4);
  };

  printHeader();
  rows.forEach((row) => {
    if (y > 280) {
      doc.addPage();
      y = 20;
      printHeader();
    }
    printRow(row, false);
  });

  return y + 10;
};
