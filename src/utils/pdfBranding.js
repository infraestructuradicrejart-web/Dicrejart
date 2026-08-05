/**
 * @file pdfBranding.js
 * @description Helpers compartidos para dar formato de marca (logo + figuras del Manual
 * de Identidad) a los PDFs generados con jsPDF — extraído de ComprasPage.jsx para que
 * otras páginas (ej. las solicitudes de materiales en ProduccionPage.jsx) generen PDFs
 * con el mismo estilo visual, sin duplicar esta lógica.
 * @author Dicrejart Dev Team
 */

import { BRAND_SHAPES } from '../components/ui/BrandShape';
import logoUrl from '../assets/login/dicrejart-logo-hd.png';

export { logoUrl };

/**
 * Carga cualquier imagen (PNG del logo o una figura SVG del manual de identidad
 * convertida a data URL) y la rasteriza en un <canvas> oculto para obtener un PNG en
 * base64 que jsPDF sí pueda insertar con `doc.addImage` (jsPDF no soporta SVG directo).
 * Devuelve también el tamaño natural para poder escalarla sin deformarla en el PDF.
 */
export const rasterizeImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${src}`));
    img.src = src;
  });

/**
 * Construye el markup SVG de una figura del manual de identidad (`BrandShape.jsx`) con
 * un color sólido, como data URL — mismo set de "Gráficos Auxiliares" que ya se usa en
 * el resto de la app.
 */
export const brandShapeToDataUrl = (shapeKey, colorHex, opacity = 1) => {
  const { viewBox, transform, d } = BRAND_SHAPES[shapeKey];
  const [, , w, h] = viewBox.split(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}"><g transform="${transform}"><path d="${d}" fill="${colorHex}" fill-opacity="${opacity}"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
