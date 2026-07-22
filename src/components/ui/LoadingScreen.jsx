/**
 * @file LoadingScreen.jsx
 * @description Pantalla de carga premium con figuras rebotantes y rotatorias de marca
 * @author Dicrejart Dev Team
 */

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Typewriter } from './Typewriter';
import { Logo } from './Logo';
import BrandShape from './BrandShape';
import styles from './LoadingScreen.module.css';

/**
 * Figuras rebotantes decorativas (sin "picos", sin "arco-doble").
 * Colores sólidos de la paleta oficial Dicrejart.
 */
const BOUNCE_SHAPES = [
  // Esquina superior-derecha — anillo grande, rojo
  { shape: 'anillo',    color: '#FF3300', size: 380, vx:  0.8, vy:  0.6, vr:  0.20 },
  // Esquina superior-izquierda — trébol mediano, amarillo
  { shape: 'trebol',    color: '#FFCC00', size: 200, vx: -1.0, vy:  0.7, vr: -0.28 },
  // Esquina inferior-izquierda — mancha grande, violeta
  { shape: 'mancha',    color: '#9933FF', size: 300, vx:  0.7, vy: -0.8, vr:  0.24 },
  // Esquina inferior-derecha — cacahuate mediano, teal
  { shape: 'cacahuate', color: '#0099CC', size: 220, vx: -0.9, vy: -0.6, vr: -0.18 },
];

export function DicrejartLoadingScreen({ onLoadComplete, duration = 3500 }) {
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const containerRef = useRef(null);
  const shapesRef = useRef([]);

  // Loop de física y requestAnimationFrame
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cw = container.offsetWidth || window.innerWidth;
    const ch = container.offsetHeight || window.innerHeight;

    // Posiciones iniciales (una en cada esquina de la pantalla de carga)
    const state = BOUNCE_SHAPES.map((s, i) => {
      const corners = [
        { x: cw - s.size + 30, y: -30 },             // sup-der
        { x: -30,               y: -30 },            // sup-izq
        { x: -30,               y: ch - s.size + 30 },// inf-izq
        { x: cw - s.size + 30, y: ch - s.size + 30 }, // inf-der
      ];
      return {
        x: corners[i].x,
        y: corners[i].y,
        vx: s.vx,
        vy: s.vy,
        vr: s.vr,
        r: Math.random() * 360,
        size: s.size,
      };
    });

    let raf;
    const tick = () => {
      const w = container.offsetWidth;
      const h = container.offsetHeight;

      state.forEach((p, i) => {
        const el = shapesRef.current[i];
        if (!el) return;

        // Mover
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;

        // Rebotes con un margen cómodo para que no se atoren en las esquinas
        if (p.x < -p.size * 0.35) { p.x = -p.size * 0.35; p.vx *= -1; }
        else if (p.x + p.size * 0.65 > w) { p.x = w - p.size * 0.65; p.vx *= -1; }

        if (p.y < -p.size * 0.35) { p.y = -p.size * 0.35; p.vy *= -1; }
        else if (p.y + p.size * 0.65 > h) { p.y = h - p.size * 0.65; p.vy *= -1; }

        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.r}deg)`;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Barra de progreso
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + Math.random() * 8;
        return next > 90 ? 90 : next;
      });
    }, 350);
    return () => clearInterval(interval);
  }, []);

  // Completar al vencer la duración
  useEffect(() => {
    const timer = setTimeout(() => {
      setProgress(100);
      setIsComplete(true);
      const finish = setTimeout(() => onLoadComplete?.(), 600);
      return () => clearTimeout(finish);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onLoadComplete]);

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Figuras de marca rebotantes y rotatorias */}
      {BOUNCE_SHAPES.map((s, i) => (
        <div
          key={i}
          ref={(el) => (shapesRef.current[i] = el)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: s.size,
            height: s.size,
            willChange: 'transform',
            pointerEvents: 'none',
            opacity: 0.55,
          }}
        >
          <BrandShape
            shape={s.shape}
            color={s.color}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      ))}

      {/* Contenido principal centrado */}
      <div className={styles.content}>
        {/* Logo con anillos giratorios */}
        <div className={styles.logoWrapper}>
          <div className={styles.ring1} />
          <div className={styles.ring2} />
          <div className={styles.ring3} />
          <Logo color="white" width={220} className={styles.logoSvg} />
        </div>

        {/* Texto máquina de escribir */}
        <div className={styles.textSection}>
          <Typewriter
            text={[
              'Donde la creatividad cobra vida',
              'Experiencias únicas y memorables',
              'Innovación en entretenimiento',
            ]}
            speed={50}
            deleteSpeed={30}
            loop={true}
            delay={2000}
            cursor="▌"
            className={styles.typewriterText}
          />
        </div>

        {/* Barra de progreso */}
        <div className={styles.progressContainer}>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.progressPercent}>{Math.round(progress)}%</span>
        </div>

        {/* Estado */}
        {!isComplete ? (
          <p className={styles.statusMessage}>Inicializando experiencia...</p>
        ) : (
          <p className={styles.statusComplete}>✓ Listo para comenzar</p>
        )}
      </div>
    </div>
  );
}

DicrejartLoadingScreen.propTypes = {
  onLoadComplete: PropTypes.func,
  duration: PropTypes.number,
};

export default DicrejartLoadingScreen;
