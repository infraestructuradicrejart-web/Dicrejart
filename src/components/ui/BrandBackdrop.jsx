/**
 * @file BrandBackdrop.jsx
 * @description Fondo decorativo de toda la aplicación con figuras de marca rebotando
 * dinámicamente por toda la pantalla (física fluida a 60 FPS con requestAnimationFrame).
 * @author Dicrejart Dev Team
 * @requires react
 */

import React, { useEffect, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import BrandShape from './BrandShape';
import styles from './BrandBackdrop.module.css';

/**
 * Figuras disponibles para el fondo
 * @constant
 */
const SHAPES = ['mancha', 'trebol', 'cacahuate', 'arco-doble', 'anillo'];

/**
 * Colores oficiales del manual con opacidad
 * @constant
 */
const COLORS = [
  '#FF3300', // Red (RYB)
  '#330066', // Deep Violet
  '#0099CC', // Tiffany Blue
  '#FF9933', // Princeton Orange
  '#FFCC00', // Golden Yellow
  '#990099', // Dark Magenta
  '#9933FF', // Purple X11
  '#663399', // Blue-Magenta Violet
];

/**
 * Genera un número entero determinístico a partir de un texto (hash simple)
 */
const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

/**
 * Margen extra de rebote: las figuras pueden viajar esta cantidad de px
 * más allá del borde visible del contenedor antes de rebotar. Sin esto,
 * las figuras grandes (que ya ocupan gran parte del contenedor) apenas
 * tenían espacio para moverse y se veían rebotando muy rápido en un
 * espacio diminuto.
 * @constant
 */
const BOUNCE_OVERSCAN = 220;

/**
 * Generador pseudoaleatorio determinístico (mulberry32)
 */
const createRandom = (seed) => {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const BrandBackdrop = ({ section }) => {
  const containerRef = useRef(null);
  const shapesRef = useRef([]);

  // Generamos la definición de las piezas iniciales (colores, formas, tamaños) basado en la sección
  const pieces = useMemo(() => {
    const random = createRandom(hashString(section || 'default') + 1);
    const colorCounts = {};

    // 4 figuras flotando y rebotando
    return [0, 1, 2, 3].map((index) => {
      const shape = SHAPES[Math.floor(random() * SHAPES.length)];

      let color = COLORS[Math.floor(random() * COLORS.length)];
      let attempts = 0;
      while (colorCounts[color] >= 2 && attempts < 20) {
        color = COLORS[Math.floor(random() * COLORS.length)];
        attempts += 1;
      }
      colorCounts[color] = (colorCounts[color] || 0) + 1;

      // Tamaño de las figuras: entre 360px y 600px (el doble de 180px-300px)
      const size = 360 + Math.round(random() * 240);

      // Velocidades de movimiento iniciales en px por frame (suave y fluido)
      const vx = (random() > 0.5 ? 1 : -1) * (0.6 + random() * 0.9);
      const vy = (random() > 0.5 ? 1 : -1) * (0.6 + random() * 0.9);
      const vr = (random() > 0.5 ? 1 : -1) * (0.1 + random() * 0.3);

      return {
        id: `${section}-${index}`,
        shape,
        color,
        size,
        vx,
        vy,
        vr,
      };
    });
  }, [section]);

  // Loop de física y requestAnimationFrame
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId;

    // Medimos el contenedor una sola vez (y en cada resize), en vez de en
    // cada frame: llamar getBoundingClientRect() 60 veces por segundo fuerza
    // un recálculo de layout continuo que provocaba el parpadeo/jank visual
    let width = container.getBoundingClientRect().width || window.innerWidth;
    let height = container.getBoundingClientRect().height || window.innerHeight;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width || window.innerWidth;
      height = rect.height || window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const state = pieces.map((piece) => {
      const travelWidth = Math.max(0, width + BOUNCE_OVERSCAN * 2 - piece.size);
      const travelHeight = Math.max(0, height + BOUNCE_OVERSCAN * 2 - piece.size);
      return {
        x: -BOUNCE_OVERSCAN + Math.random() * travelWidth,
        y: -BOUNCE_OVERSCAN + Math.random() * travelHeight,
        vx: piece.vx,
        vy: piece.vy,
        vr: piece.vr,
        r: Math.random() * 360,
        size: piece.size,
      };
    });

    const updatePhysics = () => {
      const minX = -BOUNCE_OVERSCAN;
      const maxX = width + BOUNCE_OVERSCAN;
      const minY = -BOUNCE_OVERSCAN;
      const maxY = height + BOUNCE_OVERSCAN;

      state.forEach((p, i) => {
        const el = shapesRef.current[i];
        if (!el) return;

        // Actualizar posición
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;

        // Rebotes horizontales (con margen extra más allá del borde visible)
        if (p.x < minX) {
          p.x = minX;
          p.vx = -p.vx;
        } else if (p.x + p.size > maxX) {
          p.x = maxX - p.size;
          p.vx = -p.vx;
        }

        // Rebotes verticales (con margen extra más allá del borde visible)
        if (p.y < minY) {
          p.y = minY;
          p.vy = -p.vy;
        } else if (p.y + p.size > maxY) {
          p.y = maxY - p.size;
          p.vy = -p.vy;
        }

        // Aplicar transformación con translate3d (acelerado por GPU)
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.r}deg)`;
      });

      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    animationFrameId = requestAnimationFrame(updatePhysics);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [pieces]);

  return (
    <div className={styles.backdrop} ref={containerRef} aria-hidden="true">
      {pieces.map((piece, index) => (
        <div
          key={piece.id}
          ref={(el) => (shapesRef.current[index] = el)}
          className={styles.pieceWrapper}
          style={{
            position: 'absolute',
            width: piece.size,
            height: piece.size,
            left: 0,
            top: 0,
            willChange: 'transform',
          }}
        >
          <BrandShape
            shape={piece.shape}
            color={piece.color}
            style={{ width: '100%', height: '100%', opacity: 0.15 }}
          />
        </div>
      ))}
    </div>
  );
};

BrandBackdrop.propTypes = {
  section: PropTypes.string.isRequired,
};

export default BrandBackdrop;
