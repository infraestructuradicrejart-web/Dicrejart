/**
 * @file Dashboard.jsx
 * @description Vista del Dashboard de la aplicación Dicrejart
 * Muestra KPIs animados, gráficas de estado de proyectos y listas de actividades consumiendo el estado global
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires recharts
 */

import React, { useContext, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import useProduccion from '../../hooks/useProduccion';
import useConfig from '../../hooks/useConfig';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import { CalidadContext } from '../../context/CalidadContext';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import styles from './Dashboard.module.css';

/**
 * Determina qué áreas están activas para un juego en el nuevo modelo paralelo
 *
 * @param {Object} juego - Juego con `areas` y `areaStatus`
 * @returns {string[]} IDs de área a mostrar (una o varias)
 */
const getAreasActivas = (juego) => {
  const enProceso = juego.areas.filter((areaId) => juego.areaStatus?.[areaId] === 'proceso');
  if (enProceso.length > 0) return enProceso;

  if (juego.areaStatus?.['producto-terminado'] === 'completado') return ['producto-terminado'];

  const pendiente = juego.areas.find((areaId) => juego.areaStatus?.[areaId] === 'pendiente');
  return pendiente ? [pendiente] : ['producto-terminado'];
};

/**
 * Componente Dashboard - Panel principal de estadísticas y control
 * @component
 * @returns {ReactElement} Dashboard renderizado
 */
const Dashboard = () => {
  // ============================================
  // CONTEXTOS
  // ============================================
  const { proyectos, juegos, historialProduccion } = useProduccion();
  const { inspecciones } = useContext(CalidadContext) || { inspecciones: [] };
  const { generalConfig } = useConfig();
  const { actividades } = useActividades();
  const { operarios, horasExtra } = useOperarios();

  // Vista de evidencia fotográfica de un registro de producción reciente
  const [previewLog, setPreviewLog] = useState(null);

  // ============================================
  // CÁLCULO DE MÉTRICAS / KPIs
  // ============================================
  const totalProyectos = proyectos.length;
  const proyectosEnProgreso = proyectos.filter((p) => p.status === 'progreso' || p.status === 'diseno').length;
  
  const totalJuegos = juegos.length;
  const juegosCompletados = juegos.filter((j) => j.progress === 100).length;
  const juegosEnProceso = totalJuegos - juegosCompletados;

  // Calcular Tasa de defectos e Índice de Calidad dinámicamente
  const totalInspecciones = inspecciones.length;
  const aprobadas = inspecciones.filter((i) => i.status === 'aprobado').length;
  const defectuosas = totalInspecciones - aprobadas;

  const qualityIndex = totalInspecciones > 0 ? ((aprobadas / totalInspecciones) * 100).toFixed(1) : '0.0';
  const defectRate = totalInspecciones > 0 ? ((defectuosas / totalInspecciones) * 100).toFixed(1) : '0.0';

  // Actividades activas (pendiente/proceso) y vencidas (fecha límite ya pasada sin completar)
  const todayStr = getTodayLocalDateStr();
  const actividadesActivas = actividades.filter((a) => a.status !== 'completado').length;
  const actividadesVencidas = actividades.filter(
    (a) => a.dueDate && a.dueDate < todayStr && a.status !== 'completado'
  ).length;

  // Personal: ausencias activas hoy (mismo criterio que rhNotificationService.js) y
  // horas extra que aún no verifica nadie (cumplido/no cumplido)
  const ausenciasHoy = operarios.filter((op) => op.estado && op.estado.tipo !== 'activo').length;
  const horasExtraPendientes = horasExtra.filter((h) => h.verificationStatus === 'pendiente').length;

  // Compara el Índice de Calidad contra la Tolerancia de Calidad Exigida configurada
  // por el Admin (config/general.qualityTolerance, ver AdminPage) — solo tiene sentido
  // evaluarla si ya existe al menos una inspección registrada.
  const qualityTolerance = generalConfig.qualityTolerance;
  const meetsTolerance = totalInspecciones > 0 && Number(qualityIndex) >= qualityTolerance;

  // ============================================
  // PREPARACIÓN DE DATOS PARA GRÁFICAS
  // ============================================

  // Datos para gráfica de barras: Progreso por Proyecto
  const chartDataProyectos = proyectos.map((p) => ({
    name: p.name.length > 20 ? `${p.name.substring(0, 20)}...` : p.name,
    progreso: p.progress,
  }));

  // Datos para gráfica circular: Estado de Juegos
  const chartDataJuegos = [
    { name: 'En Proceso', value: juegosEnProceso, color: '#FF9933' },
    { name: 'Completados', value: juegosCompletados, color: '#10B981' },
    { name: 'Demorados', value: juegos.filter((j) => j.status === 'demorado').length, color: '#DC2626' },
  ];

  // ============================================
  // VARIANTES DE ANIMACIÓN (Framer Motion)
  // ============================================
  const containerVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    initial: { opacity: 0, y: 20 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: 'easeOut' },
    },
  };

  return (
    <motion.div
      className={styles.dashboard}
      variants={containerVariants}
      initial="initial"
      animate="animate"
    >
      {/* Título de Página */}
      <PageHeader
        title="Panel de Control"
        subtitle="Resumen del estado operativo de producción y proyectos en tiempo real."
        shape="anillo"
        accentColor="var(--color-primary)"
      />

      {/* KPI WIDGETS — agrupados por dominio (un solo .kpiGrid, con encabezados de ancho
          completo entre grupos, para no tener que tocar el CSS del grid existente) */}
      <div className={styles.kpiGrid}>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)' }}>📁 General</h3>
        </div>
        {/* KPI 1: Proyectos */}
        <motion.div variants={itemVariants}>
          <Card variant="highlight" className={styles.kpiCard} shape="anillo" shapeColor="var(--color-primary)">
            <div className={styles.kpiIcon}>📋</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Proyectos Activos</span>
              <h3 className={styles.kpiValue}>{proyectosEnProgreso} / {totalProyectos}</h3>
              <p className={styles.kpiFooter}>En progreso o diseño</p>
            </div>
          </Card>
        </motion.div>

        {/* KPI 2: Juegos en Producción */}
        <motion.div variants={itemVariants}>
          <Card variant="default" className={styles.kpiCard} shape="cacahuate" shapeColor="var(--color-purple-x11)">
            <div className={styles.kpiIcon} style={{ color: 'var(--color-primary)' }}>🎮</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Juegos en Línea</span>
              <h3 className={styles.kpiValue}>{juegosEnProceso}</h3>
              <p className={styles.kpiFooter}>En etapas de manufactura</p>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>✨ Calidad</h3>
        </div>
        {/* KPI 3: Calidad */}
        <motion.div variants={itemVariants}>
          <Card
            variant={totalInspecciones > 0 && !meetsTolerance ? 'danger' : 'success'}
            className={styles.kpiCard}
            shape="trebol"
            shapeColor={totalInspecciones > 0 && !meetsTolerance ? 'var(--color-alert)' : 'var(--color-success)'}
          >
            <div className={styles.kpiIcon}>✨</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Índice de Calidad</span>
              <h3 className={styles.kpiValue}>{qualityIndex}%</h3>
              <p className={styles.kpiFooter}>
                {totalInspecciones > 0
                  ? `Meta: ${qualityTolerance}% — ${meetsTolerance ? '✓ Cumple' : '✗ Por debajo de la meta'}`
                  : `Meta de tolerancia: ${qualityTolerance}%`}
              </p>
            </div>
          </Card>
        </motion.div>

        {/* KPI 4: Defectos */}
        <motion.div variants={itemVariants}>
          <Card variant="danger" className={styles.kpiCard} shape="mancha" shapeColor="var(--color-alert)">
            <div className={styles.kpiIcon}>⚠️</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Tasa de Defectos</span>
              <h3 className={styles.kpiValue}>{defectRate}%</h3>
              <p className={styles.kpiFooter}>Objetivo: &lt;10%</p>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>📌 Actividades</h3>
        </div>
        {/* KPI 5: Actividades Activas */}
        <motion.div variants={itemVariants}>
          <Card variant="default" className={styles.kpiCard} shape="cacahuate" shapeColor="var(--color-golden-yellow)">
            <div className={styles.kpiIcon}>📌</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Actividades Activas</span>
              <h3 className={styles.kpiValue}>{actividadesActivas}</h3>
              <p className={styles.kpiFooter}>Pendientes o en proceso</p>
            </div>
          </Card>
        </motion.div>

        {/* KPI 6: Actividades Vencidas */}
        <motion.div variants={itemVariants}>
          <Card
            variant={actividadesVencidas > 0 ? 'danger' : 'success'}
            className={styles.kpiCard}
            shape="trebol"
            shapeColor={actividadesVencidas > 0 ? 'var(--color-alert)' : 'var(--color-success)'}
          >
            <div className={styles.kpiIcon}>⏰</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Actividades Vencidas</span>
              <h3 className={styles.kpiValue}>{actividadesVencidas}</h3>
              <p className={styles.kpiFooter}>{actividadesVencidas > 0 ? 'Requieren atención' : 'Sin pendientes vencidos'}</p>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>👥 Personal</h3>
        </div>
        {/* KPI 7: Ausencias Hoy */}
        <motion.div variants={itemVariants}>
          <Card
            variant={ausenciasHoy > 0 ? 'danger' : 'success'}
            className={styles.kpiCard}
            shape="mancha"
            shapeColor={ausenciasHoy > 0 ? 'var(--color-alert)' : 'var(--color-success)'}
          >
            <div className={styles.kpiIcon}>🧑‍🤝‍🧑</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Ausencias Hoy</span>
              <h3 className={styles.kpiValue}>{ausenciasHoy}</h3>
              <p className={styles.kpiFooter}>{ausenciasHoy > 0 ? 'Personal no activo hoy' : 'Todos en planta'}</p>
            </div>
          </Card>
        </motion.div>

        {/* KPI 8: Horas Extra Pendientes de Verificar */}
        <motion.div variants={itemVariants}>
          <Card
            variant={horasExtraPendientes > 0 ? 'default' : 'success'}
            className={styles.kpiCard}
            shape="anillo"
            shapeColor={horasExtraPendientes > 0 ? 'var(--color-golden-yellow)' : 'var(--color-success)'}
          >
            <div className={styles.kpiIcon}>🕒</div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>Horas Extra Pendientes de Verificar</span>
              <h3 className={styles.kpiValue}>{horasExtraPendientes}</h3>
              <p className={styles.kpiFooter}>{horasExtraPendientes > 0 ? 'Esperando confirmar cumplimiento' : 'Al día'}</p>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* CHARTS SECTION */}
      <div className={styles.chartsGrid}>
        {/* Gráfica 1: Progreso de Proyectos */}
        <motion.div variants={itemVariants} className={styles.chartWrapper}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Progreso por Proyecto (%)</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartDataProyectos} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white', 
                      borderRadius: '8px', 
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)'
                    }} 
                  />
                  <Bar dataKey="progreso" fill="#FF3300" radius={[4, 4, 0, 0]} barSize={25} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Gráfica 2: Estado de Juegos */}
        <motion.div variants={itemVariants} className={styles.chartWrapper}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Estado de Juegos en Producción</h3>
            <div className={styles.pieContainer}>
              <div className={styles.chartContainer} style={{ width: '60%' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={chartDataJuegos}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartDataJuegos.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.pieLegend}>
                {chartDataJuegos.map((item, index) => (
                  <div key={index} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
                    <span className={styles.legendLabel}>{item.name}</span>
                    <strong className={styles.legendVal}>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* TABLAS / ACTIVIDAD RECIENTE */}
      <div className={styles.tableGrid}>
        {/* Tabla: Juegos en Producción */}
        <motion.div variants={itemVariants} className={styles.tableWrapper}>
          <Card variant="default">
            <div className={styles.cardHeader}>
              <h3 className={styles.chartTitle}>Juegos en Progreso Activo</h3>
              <span className={styles.badge}>Total: {juegos.length}</span>
            </div>
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Juego</th>
                    <th>Proyecto</th>
                    <th>Área Activa</th>
                    <th>Progreso</th>
                  </tr>
                </thead>
                <tbody>
                  {juegos.slice(0, 4).map((juego) => (
                    <tr key={juego.id}>
                      <td data-label="Juego" className={styles.boldText}>{juego.name}</td>
                      <td data-label="Proyecto" className={styles.textMuted}>{juego.projectName}</td>
                      <td data-label="Área Activa">
                        <div className={styles.areaBadgeGroup}>
                          {getAreasActivas(juego).map((areaId) => (
                            <span
                              key={areaId}
                              className={`${styles.areaBadge} ${styles[`area-${areaId}`]}`}
                            >
                              {areaId.toUpperCase().replace('-', ' ')}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td data-label="Progreso">
                        <div className={styles.progressCell}>
                          <div className={styles.progressBarBg}>
                            <div
                              className={styles.progressBar}
                              style={{ width: `${juego.progress}%` }}
                            />
                          </div>
                          <span className={styles.progressVal}>{juego.progress}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>

        {/* Lista: Actividad Reciente */}
        <motion.div variants={itemVariants} className={styles.activityWrapper}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Actividad de Producción Reciente</h3>
            <div className={styles.activityList}>
              {historialProduccion.slice(0, 4).map((act) => (
                <div key={act.id} className={styles.activityItem}>
                  <div 
                    className={`${styles.activityDot} ${
                      act.status === 'aprobado' ? styles.dotSuccess : styles.dotDanger
                    }`}
                  />
                  <div className={styles.activityContent}>
                    <p className={styles.activityText}>
                      <strong>{act.operator}</strong> completó lote en{' '}
                      <strong>{act.areaId.toUpperCase().replace('-', ' ')}</strong> para{' '}
                      <em>{act.gameName}</em>
                      {act.photos?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPreviewLog(act)}
                          title="Ver evidencia fotográfica"
                          style={{
                            marginLeft: '8px',
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: '12px',
                            color: 'var(--color-primary)',
                            fontWeight: '600',
                          }}
                        >
                          📷 Ver evidencia ({act.photos.length})
                        </button>
                      )}
                    </p>
                    <span className={styles.activityTime}>
                      {new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - Cant: {act.quantity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* MODAL: EVIDENCIA FOTOGRÁFICA DE UN REGISTRO DE PRODUCCIÓN */}
      {previewLog && (
        <Modal
          isOpen={Boolean(previewLog)}
          onClose={() => setPreviewLog(null)}
          title={`📷 Evidencia: ${previewLog.gameName}`}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {previewLog.photos.map((photo, idx) => (
              <img
                key={photo.path || idx}
                src={photo.url}
                alt={`Evidencia ${idx + 1}`}
                style={{
                  width: '140px',
                  height: '140px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  cursor: 'zoom-in',
                }}
                onClick={() => window.open(photo.url, '_blank', 'noopener')}
              />
            ))}
          </div>
        </Modal>
      )}
    </motion.div>
  );
};

export default Dashboard;
