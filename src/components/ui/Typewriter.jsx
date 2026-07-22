/**
 * @file Typewriter.jsx
 * @description Componente para escritura animada (efecto máquina de escribir)
 * @author Dicrejart Dev Team
 * @requires react
 */

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * Componente Typewriter
 * @component
 * @param {Object} props
 * @param {string|string[]} props.text - Texto o lista de textos a animar
 * @param {number} [props.speed=100] - Velocidad de escritura en ms por caracter
 * @param {string} [props.cursor="|"] - Caracter del cursor
 * @param {boolean} [props.loop=false] - Si debe reiniciar el ciclo al terminar
 * @param {number} [props.deleteSpeed=50] - Velocidad de borrado en ms por caracter
 * @param {number} [props.delay=1500] - Pausa en ms antes de empezar a borrar o pasar al siguiente texto
 * @param {string} [props.className] - Clases de CSS adicionales
 * @returns {ReactElement} Render de la máquina de escribir
 */
export function Typewriter({
  text,
  speed = 100,
  cursor = "|",
  loop = false,
  deleteSpeed = 50,
  delay = 1500,
  className,
}) {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [textArrayIndex, setTextArrayIndex] = useState(0);

  // Procesar entrada
  const textArray = Array.isArray(text) ? text : [text];
  const currentText = textArray[textArrayIndex] || "";

  useEffect(() => {
    if (!currentText) return;

    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          if (currentIndex < currentText.length) {
            setDisplayText((prev) => prev + currentText[currentIndex]);
            setCurrentIndex((prev) => prev + 1);
          } else if (loop) {
            setTimeout(() => setIsDeleting(true), delay);
          }
        } else {
          if (displayText.length > 0) {
            setDisplayText((prev) => prev.slice(0, -1));
          } else {
            setIsDeleting(false);
            setCurrentIndex(0);
            setTextArrayIndex((prev) => (prev + 1) % textArray.length);
          }
        }
      },
      isDeleting ? deleteSpeed : speed
    );

    return () => clearTimeout(timeout);
  }, [
    currentIndex,
    isDeleting,
    currentText,
    loop,
    speed,
    deleteSpeed,
    delay,
    displayText,
    textArray.length,
  ]);

  return (
    <span className={className}>
      {displayText}
      <span className="typewriter-cursor-animation" style={{ opacity: 1 }}>{cursor}</span>
    </span>
  );
}

Typewriter.propTypes = {
  text: PropTypes.oneOfType([PropTypes.string, PropTypes.arrayOf(PropTypes.string)]).isRequired,
  speed: PropTypes.number,
  cursor: PropTypes.string,
  loop: PropTypes.bool,
  deleteSpeed: PropTypes.number,
  delay: PropTypes.number,
  className: PropTypes.string,
};

export default Typewriter;
