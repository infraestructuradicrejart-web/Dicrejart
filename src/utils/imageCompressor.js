/**
 * @file imageCompressor.js
 * @description Utilidad para comprimir y redimensionar imágenes en el cliente
 * antes de subirlas a Firebase Storage. Reduce el tamaño en disco en más de un 90%
 * conservando la legibilidad.
 * @author Dicrejart Dev Team
 */

/**
 * Comprime y redimensiona una imagen provista por un input de tipo file.
 * 
 * @param {File} file - El archivo original (imagen) a comprimir.
 * @param {Object} options - Parámetros de optimización.
 * @param {number} [options.maxWidth=1280] - Ancho máximo de la imagen resultante.
 * @param {number} [options.maxHeight=1280] - Alto máximo de la imagen resultante.
 * @param {number} [options.quality=0.75] - Calidad de compresión (0.0 a 1.0).
 * @param {string} [options.outputType='image/jpeg'] - Formato resultante (image/jpeg o image/webp).
 * 
 * @returns {Promise<Blob>} Un objeto Blob de la imagen optimizada listo para subirse.
 */
export const compressImage = (file, options = {}) => {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.75,
    outputType = 'image/jpeg'
  } = options;

  return new Promise((resolve, reject) => {
    // Si el navegador no soporta FileReader, rechazar la promesa
    if (!window.FileReader) {
      return reject(new Error('FileReader no está soportado en este navegador.'));
    }

    // Si el archivo no es una imagen, retornar el archivo original
    if (!file.type.startsWith('image/')) {
      return resolve(file);
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

      img.onload = () => {
        // Calcular nuevas dimensiones manteniendo la relación de aspecto original
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        // Crear elemento canvas para renderizar y comprimir
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('No se pudo obtener el contexto 2D del Canvas.'));
        }

        // Dibujar la imagen escalada en el lienzo
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir el canvas a Blob con la calidad especificada
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Copiar el nombre original y añadir propiedades útiles si es necesario
              blob.name = file.name;
              resolve(blob);
            } else {
              reject(new Error('La conversión de Canvas a Blob falló.'));
            }
          },
          outputType,
          quality
        );
      };

      img.onerror = () => {
        reject(new Error('Error al cargar la imagen en memoria para compresión.'));
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      reject(new Error('Error al leer el archivo con FileReader.'));
    };

    // Leer la imagen como URL base64
    reader.readAsDataURL(file);
  });
};

export default compressImage;
