/**
 * @file ReportesPage.jsx
 * @description Vista de Reportes y Gráficas de Dicrejart
 * Permite filtrar la producción, visualizar gráficos estadísticos y exportar datos
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires recharts
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useCalidad from '../../hooks/useCalidad';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import { getTodayLocalDateStr, getOvertimeWeekRange } from '../../utils/dateUtils';
import { PRIORITY_LABELS } from '../../data/actividadesData';
import PageHeader from '../../components/ui/PageHeader';
import { addPdfTable } from '../../utils/pdfTable';
import styles from './ReportesPage.module.css';

/**
 * Áreas para filtrado
 * @constant
 */
const AREAS = [
  { id: 'todos', name: 'Todas las Áreas' },
  { id: 'almacen', name: 'Almacén' },
  { id: 'corte-laser', name: 'Corte Laser' },
  { id: 'herreria', name: 'Herrería' },
  { id: 'carpinteria', name: 'Carpintería' },
  { id: 'costura-acc', name: 'Costura Accesorios' },
  { id: 'costura-colch', name: 'Costura Colchonetas' },
  { id: 'mantenimiento', name: 'Mantenimiento' },
  { id: 'producto-terminado', name: 'Producto Terminado' },
];

/**
 * Componente ReportesPage - Analítica de productividad y calidad
 * @component
 * @returns {ReactElement} Render del componente de reportes
 */
const ReportesPage = () => {
  // ============================================
  // ESTADO
  // ============================================
  const [areaFilter, setAreaFilter] = useState('todos');
  // Vacío por defecto = sin filtro de fecha (se muestra todo el historial disponible)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Estados de generación de exportación
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Navegación de semanas para el resumen de horas extra (jueves a miércoles) — 0 =
  // semana en curso, negativo = semanas anteriores, positivo = futuras (si ya se
  // programaron horas extra por adelantado)
  const [overtimeWeekOffset, setOvertimeWeekOffset] = useState(0);

  const toast = useToast();
  const { historialProduccion, juegos } = useProduccion();
  const { inspecciones } = useCalidad();
  const { actividades } = useActividades();
  const { operarios, horasExtra } = useOperarios();

  // ============================================
  // RESUMEN SEMANAL DE HORAS EXTRA (Jueves a Miércoles)
  // ============================================
  const overtimeWeekRange = React.useMemo(() => {
    const base = new Date(`${getTodayLocalDateStr()}T00:00:00`);
    base.setDate(base.getDate() + overtimeWeekOffset * 7);
    return getOvertimeWeekRange(getTodayLocalDateStr(base));
  }, [overtimeWeekOffset]);

  const weeklyOvertimeList = horasExtra.filter(
    (he) => he.authorizedDate >= overtimeWeekRange.start
      && he.authorizedDate <= overtimeWeekRange.end
      && he.verificationStatus !== 'cancelado'
  );

  // Agrupado por operario (sumando todas sus autorizaciones de la semana) y luego por área
  const overtimeByArea = React.useMemo(() => {
    const byOperario = new Map();
    weeklyOvertimeList.forEach((he) => {
      if (!byOperario.has(he.operarioId)) {
        byOperario.set(he.operarioId, {
          operarioId: he.operarioId,
          operarioName: he.operarioName,
          operarioPuesto: he.operarioPuesto || 'N/A',
          areaId: he.areaId || 'N/A',
          totalHours: 0,
          authCount: 0,
        });
      }
      const entry = byOperario.get(he.operarioId);
      entry.totalHours += Number(he.overtimeHours) || 0;
      entry.authCount += 1;
    });

    const byArea = new Map();
    Array.from(byOperario.values()).forEach((entry) => {
      if (!byArea.has(entry.areaId)) byArea.set(entry.areaId, []);
      byArea.get(entry.areaId).push(entry);
    });
    byArea.forEach((list) => list.sort((a, b) => b.totalHours - a.totalHours));

    return Array.from(byArea.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [weeklyOvertimeList]);

  const overtimeWeekTotalHoras = weeklyOvertimeList.reduce((sum, he) => sum + (Number(he.overtimeHours) || 0), 0);
  const overtimeWeekTotalColaboradores = new Set(weeklyOvertimeList.map((he) => he.operarioId)).size;
  const getAreaLabel = (areaId) => AREAS.find((a) => a.id === areaId)?.name || areaId;

  // ============================================
  // PROCESAMIENTO DE DATOS PARA GRÁFICAS
  // ============================================

  // Coincide o no con el rango de fechas elegido (ambos límites opcionales); el final
  // se extiende hasta el último instante de ese día para incluir todo lo registrado esa
  // fecha, sin importar la hora exacta.
  const withinDateRange = (isoDate) => {
    const d = new Date(isoDate);
    if (startDate && d < new Date(`${startDate}T00:00:00`)) return false;
    if (endDate && d > new Date(`${endDate}T23:59:59`)) return false;
    return true;
  };

  // Detalle línea por línea, respetando los filtros de área y fecha — se reutiliza
  // tanto para las gráficas como para la hoja/página de "detalle" de los reportes
  // exportados.
  const produccionFiltrada = historialProduccion.filter(
    (r) => (areaFilter === 'todos' || r.areaId === areaFilter) && withinDateRange(r.date)
  );
  const inspeccionesFiltradas = inspecciones.filter(
    (r) => (areaFilter === 'todos' || r.areaId === areaFilter) && withinDateRange(r.date)
  );

  // 1. Gráfica de Producción: Agrupar cantidad producida por área
  const produccionPorAreaRaw = produccionFiltrada.reduce((acc, curr) => {
    acc[curr.areaId] = (acc[curr.areaId] || 0) + curr.quantity;
    return acc;
  }, {});

  const dataProduccion = Object.keys(produccionPorAreaRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    cantidad: produccionPorAreaRaw[key],
  }));

  // 2. Gráfica de Calidad: Tasa de Aprobación (%) por área
  const calidadPorAreaRaw = inspeccionesFiltradas.reduce((acc, curr) => {
    if (!acc[curr.areaId]) {
      acc[curr.areaId] = { aprobadas: 0, total: 0 };
    }
    if (curr.status === 'aprobado') {
      acc[curr.areaId].aprobadas += 1;
    }
    acc[curr.areaId].total += 1;
    return acc;
  }, {});

  const dataCalidad = Object.keys(calidadPorAreaRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    calificacion: Number(((calidadPorAreaRaw[key].aprobadas / calidadPorAreaRaw[key].total) * 100).toFixed(1)),
  }));

  // 3. Gráfica de Acción de Defectos: Destino de piezas rechazadas
  const accionesCalidadRaw = inspeccionesFiltradas.reduce((acc, curr) => {
    if (curr.defectAction && curr.defectAction !== 'Ninguna') {
      acc[curr.defectAction] = (acc[curr.defectAction] || 0) + 1;
    }
    return acc;
  }, { retrabajo: 0, desecho: 0, reutilizacion: 0 });

  const dataAcciones = [
    { name: '🛠️ Re-trabajo', cantidad: accionesCalidadRaw.retrabajo },
    { name: '🗑️ Desecho / Scrap', cantidad: accionesCalidadRaw.desecho },
    { name: '♻️ Reutilización / Reclasificación', cantidad: accionesCalidadRaw.reutilizacion },
  ];

  // 4. Actividades: se reportan por su fecha de creación (mismo criterio que producción/calidad)
  const todayStr = getTodayLocalDateStr();
  const getOperarioName = (operarioId) => operarios.find((op) => op.id === operarioId)?.name || null;
  const actividadesFiltradas = actividades.filter(
    (a) => (areaFilter === 'todos' || a.areaId === areaFilter) && withinDateRange(a.createdAt || new Date().toISOString())
  );

  // 4a. % de actividades completadas por área
  const actividadesPorAreaRaw = actividadesFiltradas.reduce((acc, curr) => {
    if (!acc[curr.areaId]) acc[curr.areaId] = { completadas: 0, total: 0 };
    if (curr.status === 'completado') acc[curr.areaId].completadas += 1;
    acc[curr.areaId].total += 1;
    return acc;
  }, {});
  const dataActividadesArea = Object.keys(actividadesPorAreaRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    cumplimiento: Number(((actividadesPorAreaRaw[key].completadas / actividadesPorAreaRaw[key].total) * 100).toFixed(1)),
  }));

  // 4b. Actividades por prioridad
  const prioridadRaw = actividadesFiltradas.reduce((acc, curr) => {
    acc[curr.priority] = (acc[curr.priority] || 0) + 1;
    return acc;
  }, { alta: 0, media: 0, baja: 0 });
  const dataActividadesPrioridad = Object.entries(PRIORITY_LABELS).map(([key, label]) => ({
    name: label,
    cantidad: prioridadRaw[key] || 0,
  }));

  // 4c. Actividades vencidas por área (fecha límite ya pasada, sin completar)
  const vencidasRaw = actividadesFiltradas.reduce((acc, curr) => {
    const isOverdue = curr.dueDate && curr.dueDate < todayStr && curr.status !== 'completado';
    if (isOverdue) acc[curr.areaId] = (acc[curr.areaId] || 0) + 1;
    return acc;
  }, {});
  const dataActividadesVencidas = Object.keys(vencidasRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    vencidas: vencidasRaw[key],
  }));

  // 4d. Tiempo promedio de resolución (días entre creación y cierre) por área
  const tiempoResolucionRaw = actividadesFiltradas.reduce((acc, curr) => {
    if (curr.status !== 'completado' || !curr.createdAt || !curr.completedAt) return acc;
    const dias = (new Date(curr.completedAt) - new Date(curr.createdAt)) / (1000 * 60 * 60 * 24);
    if (!acc[curr.areaId]) acc[curr.areaId] = { sumaDias: 0, total: 0 };
    acc[curr.areaId].sumaDias += dias;
    acc[curr.areaId].total += 1;
    return acc;
  }, {});
  const dataActividadesTiempoResolucion = Object.keys(tiempoResolucionRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    diasPromedio: Number((tiempoResolucionRaw[key].sumaDias / tiempoResolucionRaw[key].total).toFixed(1)),
  }));

  // 4e. Tiempo promedio de PRODUCCIÓN (banderazo inicial → meta completada) por área,
  // juego por juego — solo cuenta pares juego+área donde YA existen tanto areaKickoff
  // (el "banderazo" manual, ver startAreaWork en ProduccionContext.jsx) como
  // areaCompletedAt (sellado la primera vez que el área llega a su meta, ver
  // registerProductionLog). Juegos/áreas sin alguno de los dos (todo lo que ya existía
  // antes de esta métrica) simplemente no entran aquí — no hay forma de estimarlos con
  // precisión, así que no se intenta.
  const detalleProduccionTiempos = [];
  juegos.forEach((j) => {
    j.areas.forEach((aid) => {
      if (areaFilter !== 'todos' && aid !== areaFilter) return;
      const kickoff = j.areaKickoff?.[aid]?.startedAt;
      const completedAt = j.areaCompletedAt?.[aid];
      if (!kickoff || !completedAt || !withinDateRange(completedAt)) return;
      const dias = (new Date(completedAt) - new Date(kickoff)) / (1000 * 60 * 60 * 24);
      detalleProduccionTiempos.push({
        juego: j.name,
        area: aid,
        iniciado: kickoff,
        completado: completedAt,
        diasDuracion: Number(dias.toFixed(1)),
      });
    });
  });

  const tiempoProduccionRaw = detalleProduccionTiempos.reduce((acc, curr) => {
    if (!acc[curr.area]) acc[curr.area] = { sumaDias: 0, total: 0 };
    acc[curr.area].sumaDias += curr.diasDuracion;
    acc[curr.area].total += 1;
    return acc;
  }, {});
  const dataTiempoProduccion = Object.keys(tiempoProduccionRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    diasPromedio: Number((tiempoProduccionRaw[key].sumaDias / tiempoProduccionRaw[key].total).toFixed(1)),
  }));

  // Detalle de los juegos/áreas específicos con más días, para poder ver CUÁLES
  // tardaron más, no solo el promedio (mismo patrón que detalleInterferencia más abajo).
  const detalleTiempoProduccionTop = [...detalleProduccionTiempos]
    .sort((a, b) => b.diasDuracion - a.diasDuracion)
    .slice(0, 10);

  // 5. Interferencia: actividades del área SIN vínculo a ningún proyecto/juego — por
  // definición, trabajo ajeno al proyecto que se esté produciendo ahí en ese momento
  // (ej. una actividad de mantenimiento le quita gente a Herrería mientras produce).
  const actividadesSinVincular = actividadesFiltradas.filter((a) => !a.projectId && !a.gameId);
  const interferenciaRaw = actividadesSinVincular.reduce((acc, curr) => {
    if (!acc[curr.areaId]) acc[curr.areaId] = { dias: 0, completadas: 0, enCurso: 0 };
    if (curr.status === 'completado' && curr.createdAt && curr.completedAt) {
      acc[curr.areaId].dias += (new Date(curr.completedAt) - new Date(curr.createdAt)) / 86400000;
      acc[curr.areaId].completadas += 1;
    } else if (curr.status !== 'completado') {
      acc[curr.areaId].enCurso += 1;
    }
    return acc;
  }, {});
  const dataInterferencia = Object.keys(interferenciaRaw).map((key) => ({
    area: key.toUpperCase().replace('-', ' '),
    dias: Number(interferenciaRaw[key].dias.toFixed(1)),
    enCurso: interferenciaRaw[key].enCurso,
  }));

  // Detalle de las actividades que sí terminaron, para mostrar cuáles concretamente
  // interfirieron (no solo el total) — top 10 por días de duración.
  const detalleInterferencia = actividadesSinVincular
    .filter((a) => a.status === 'completado' && a.createdAt && a.completedAt)
    .map((a) => ({
      ...a,
      diasDuracion: Number(((new Date(a.completedAt) - new Date(a.createdAt)) / 86400000).toFixed(1)),
    }))
    .sort((a, b) => b.diasDuracion - a.diasDuracion)
    .slice(0, 10);

  // ============================================
  // HANDLERS DE EXPORTACIÓN
  // ============================================
  const areaLabel = AREAS.find((a) => a.id === areaFilter)?.name || 'Todas las Áreas';
  const fechaArchivo = new Date().toISOString().slice(0, 10);

  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    try {
      // Import dinámico: xlsx solo se descarga cuando el usuario realmente exporta,
      // en vez de engordar el bundle principal que carga toda la app.
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataProduccion.map((d) => ({ Área: d.area, 'Piezas Producidas': d.cantidad }))),
        'Producción por Área'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataCalidad.map((d) => ({ Área: d.area, 'Aprobación (%)': d.calificacion }))),
        'Calidad por Área'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataAcciones.map((d) => ({ Acción: d.name, Cantidad: d.cantidad }))),
        'Acciones sobre Defectos'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(produccionFiltrada.map((r) => ({
          Fecha: new Date(r.date).toLocaleString('es-MX'),
          Área: r.areaId,
          Juego: r.gameName,
          Operador: r.operator,
          Cantidad: r.quantity,
          Estado: r.status,
          Notas: r.notes,
        }))),
        'Detalle Producción'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(inspeccionesFiltradas.map((r) => ({
          Fecha: new Date(r.date).toLocaleString('es-MX'),
          Área: r.areaId,
          Juego: r.gameName,
          Pieza: r.pieceName,
          Inspector: r.inspector,
          Resultado: r.status === 'aprobado' ? 'Aprobado' : 'Defectuoso',
          'Tipo de Defecto': r.defectType,
          'Acción sobre la Pieza': r.defectAction,
          Notas: r.notes,
        }))),
        'Detalle Calidad'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataActividadesArea.map((d) => ({ Área: d.area, 'Cumplimiento (%)': d.cumplimiento }))),
        'Actividades por Área'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataActividadesPrioridad.map((d) => ({ Prioridad: d.name, Cantidad: d.cantidad }))),
        'Actividades por Prioridad'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataActividadesVencidas.map((d) => ({ Área: d.area, Vencidas: d.vencidas }))),
        'Actividades Vencidas'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataActividadesTiempoResolucion.map((d) => ({ Área: d.area, 'Días Promedio de Resolución': d.diasPromedio }))),
        'Tiempo de Resolución'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(actividadesFiltradas.map((a) => ({
          ID: a.id,
          Título: a.title,
          Área: a.areaId,
          Responsable: getOperarioName(a.operarioId) || 'Sin asignar específico',
          Proyecto: a.projectName || '',
          Juego: a.gameName || '',
          Prioridad: PRIORITY_LABELS[a.priority] || a.priority,
          Estado: a.status,
          Vencida: a.dueDate && a.dueDate < todayStr && a.status !== 'completado' ? 'Sí' : 'No',
          'Fecha Límite': a.dueDate || '',
          Creada: a.createdAt ? new Date(a.createdAt).toLocaleString('es-MX') : '',
          Completada: a.completedAt ? new Date(a.completedAt).toLocaleString('es-MX') : '',
        }))),
        'Detalle Actividades'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataInterferencia.map((d) => ({ Área: d.area, 'Días de Interferencia': d.dias, 'En Curso': d.enCurso }))),
        'Interferencia por Área'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(detalleInterferencia.map((a) => ({
          Área: a.areaId,
          Actividad: a.title,
          Creada: a.createdAt ? new Date(a.createdAt).toLocaleString('es-MX') : '',
          Completada: a.completedAt ? new Date(a.completedAt).toLocaleString('es-MX') : '',
          'Días de Duración': a.diasDuracion,
        }))),
        'Detalle Interferencia'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(dataTiempoProduccion.map((d) => ({ Área: d.area, 'Días Promedio de Producción': d.diasPromedio }))),
        'Tiempo de Producción'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(detalleProduccionTiempos.map((d) => ({
          Juego: d.juego,
          Área: d.area,
          Iniciado: new Date(d.iniciado).toLocaleString('es-MX'),
          Completado: new Date(d.completado).toLocaleString('es-MX'),
          'Días de Duración': d.diasDuracion,
        }))),
        'Detalle Producción'
      );

      XLSX.writeFile(wb, `Reporte-Dicrejart-${fechaArchivo}.xlsx`);
      toast.success('📊 Excel generado correctamente y descargado.');
    } catch (error) {
      console.error('Error al exportar a Excel:', error);
      toast.danger('No se pudo generar el archivo Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      // Import dinámico: jsPDF solo se descarga al exportar, mismo motivo que xlsx arriba.
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('Reporte de Analítica', 14, 15);
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Generado: ${new Date().toLocaleString('es-MX')}  ·  Área: ${areaLabel}`, 14, 22);

      let y = 32;
      y = addPdfTable(doc, {
        title: 'Producción por Área',
        headers: ['Área', 'Piezas Producidas'],
        rows: dataProduccion.map((d) => [d.area, d.cantidad]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Calidad por Área (% Aprobación)',
        headers: ['Área', 'Aprobación %'],
        rows: dataCalidad.map((d) => [d.area, d.calificacion]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Acciones sobre Defectos',
        headers: ['Acción', 'Cantidad'],
        rows: dataAcciones.map((d) => [d.name, d.cantidad]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Actividades: Cumplimiento por Área (%)',
        headers: ['Área', 'Cumplimiento %'],
        rows: dataActividadesArea.map((d) => [d.area, d.cumplimiento]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Actividades por Prioridad',
        headers: ['Prioridad', 'Cantidad'],
        rows: dataActividadesPrioridad.map((d) => [d.name, d.cantidad]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Actividades Vencidas por Área',
        headers: ['Área', 'Vencidas'],
        rows: dataActividadesVencidas.map((d) => [d.area, d.vencidas]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Tiempo Promedio de Resolución por Área (días)',
        headers: ['Área', 'Días Promedio'],
        rows: dataActividadesTiempoResolucion.map((d) => [d.area, d.diasPromedio]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Interferencia de Actividades por Área',
        headers: ['Área', 'Días de Interferencia', 'En Curso'],
        rows: dataInterferencia.map((d) => [d.area, d.dias, d.enCurso]),
        startY: y,
      });
      y = addPdfTable(doc, {
        title: 'Tiempo Promedio de Producción por Área (días)',
        headers: ['Área', 'Días Promedio'],
        rows: dataTiempoProduccion.map((d) => [d.area, d.diasPromedio]),
        startY: y,
      });

      doc.addPage();
      addPdfTable(doc, {
        title: 'Detalle de Producción',
        headers: ['Fecha', 'Área', 'Juego', 'Operador', 'Cant.', 'Estado'],
        rows: produccionFiltrada.map((r) => [
          new Date(r.date).toLocaleDateString('es-MX'), r.areaId, r.gameName, r.operator, r.quantity, r.status,
        ]),
        startY: 20,
      });

      doc.addPage();
      addPdfTable(doc, {
        title: 'Detalle de Calidad',
        headers: ['Fecha', 'Área', 'Juego', 'Pieza', 'Resultado', 'Acción'],
        rows: inspeccionesFiltradas.map((r) => [
          new Date(r.date).toLocaleDateString('es-MX'), r.areaId, r.gameName, r.pieceName,
          r.status === 'aprobado' ? 'Aprobado' : 'Defectuoso', r.defectAction,
        ]),
        startY: 20,
      });

      doc.addPage();
      addPdfTable(doc, {
        title: 'Detalle de Actividades',
        headers: ['Título', 'Área', 'Responsable', 'Prioridad', 'Estado', 'Vencida', 'Fecha Límite'],
        rows: actividadesFiltradas.map((a) => [
          a.title, a.areaId, getOperarioName(a.operarioId) || 'Sin asignar',
          PRIORITY_LABELS[a.priority] || a.priority, a.status,
          a.dueDate && a.dueDate < todayStr && a.status !== 'completado' ? 'Sí' : 'No',
          a.dueDate || '-',
        ]),
        startY: 20,
      });

      doc.addPage();
      addPdfTable(doc, {
        title: 'Detalle de Interferencia',
        headers: ['Área', 'Actividad', 'Creada', 'Completada', 'Días'],
        rows: detalleInterferencia.map((a) => [
          a.areaId, a.title,
          a.createdAt ? new Date(a.createdAt).toLocaleDateString('es-MX') : '-',
          a.completedAt ? new Date(a.completedAt).toLocaleDateString('es-MX') : '-',
          a.diasDuracion,
        ]),
        startY: 20,
      });

      doc.addPage();
      addPdfTable(doc, {
        title: 'Detalle de Tiempo de Producción (Banderazo → Completado)',
        headers: ['Juego', 'Área', 'Iniciado', 'Completado', 'Días'],
        rows: detalleProduccionTiempos.map((d) => [
          d.juego, d.area,
          new Date(d.iniciado).toLocaleDateString('es-MX'),
          new Date(d.completado).toLocaleDateString('es-MX'),
          d.diasDuracion,
        ]),
        startY: 20,
      });

      doc.save(`Reporte-Dicrejart-${fechaArchivo}.pdf`);
      toast.success('📄 PDF generado correctamente y descargado.');
    } catch (error) {
      console.error('Error al exportar a PDF:', error);
      toast.danger('No se pudo generar el archivo PDF.');
    } finally {
      setIsExportingPDF(false);
    }
  };

  // ============================================
  // ANIMACIONES
  // ============================================
  const containerVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  return (
    <motion.div
      className={styles.container}
      variants={containerVariants}
      initial="initial"
      animate="animate"
    >
      {/* Cabecera */}
      <PageHeader
        title="Analítica y Reportes"
        subtitle="Filtra el historial operativo y exporta reportes estadísticos."
        shape="anillo"
        accentColor="var(--color-blue-magenta-violet)"
      >
        <Button
          variant="secondary"
          size="md"
          isLoading={isExportingExcel}
          onClick={handleExportExcel}
        >
          {isExportingExcel ? 'Generando...' : '📊 Exportar Excel'}
        </Button>
        <Button
          variant="primary"
          size="md"
          isLoading={isExportingPDF}
          onClick={handleExportPDF}
        >
          {isExportingPDF ? 'Generando...' : '📄 Exportar PDF'}
        </Button>
      </PageHeader>

      {/* ============================================
          RESUMEN SEMANAL DE HORAS EXTRA (Jueves a Miércoles)
          ============================================ */}
      <motion.div variants={itemVariants}>
        <Card variant="default" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-3)' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 'var(--h3-size)', color: 'var(--color-secondary)' }}>🕒 Resumen Semanal de Horas Extra</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--color-gray-500)' }}>
                La semana de horas extra corre de jueves a miércoles.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={() => setOvertimeWeekOffset((prev) => prev - 1)}>
                ◀ Semana Anterior
              </Button>
              <strong style={{ fontSize: '13px', color: 'var(--color-dark)', whiteSpace: 'nowrap' }}>
                {overtimeWeekRange.start} al {overtimeWeekRange.end}
              </strong>
              <Button variant="secondary" size="sm" onClick={() => setOvertimeWeekOffset((prev) => prev + 1)}>
                Semana Siguiente ▶
              </Button>
              {overtimeWeekOffset !== 0 && (
                <Button variant="primary" size="sm" onClick={() => setOvertimeWeekOffset(0)}>
                  📍 Semana Actual
                </Button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
            <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 'bold' }}>
              Total: {overtimeWeekTotalHoras}h
            </span>
            <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-600)', fontWeight: 'bold' }}>
              {overtimeWeekTotalColaboradores} colaborador(es)
            </span>
          </div>

          {overtimeByArea.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', textAlign: 'center', padding: 'var(--space-4) 0' }}>
              No se registraron horas extra en esta semana.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {overtimeByArea.map(([areaId, entries]) => (
                <div key={areaId}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--color-gray-700)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {getAreaLabel(areaId)}
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {entries.map((e) => (
                      <div
                        key={e.operarioId}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--color-gray-200)',
                          backgroundColor: 'var(--color-gray-50)', fontSize: '13px',
                        }}
                      >
                        <span>
                          <strong>{e.operarioName}</strong>
                          <span style={{ color: 'var(--color-gray-500)', marginLeft: '6px' }}>({e.operarioPuesto})</span>
                        </span>
                        <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-gray-500)', fontSize: '12px' }}>{e.authCount} autorización(es)</span>
                          <strong style={{ color: '#92400e' }}>{e.totalHours}h</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      {/* ============================================
          BARRA DE FILTROS
          ============================================ */}
      <motion.div variants={itemVariants}>
        <Card variant="default" className={styles.filtersCard}>
          <div className={styles.filtersGrid}>
            {/* Filtro de Área */}
            <div className={styles.filterGroup}>
              <Select
                label="Filtrar Área"
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                options={AREAS.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>

            {/* Fecha de Inicio */}
            <div className={styles.filterGroup}>
              <label className={styles.label}>Fecha Inicial</label>
              <input
                type="date"
                className={styles.dateInput}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {/* Fecha de Fin */}
            <div className={styles.filterGroup}>
              <label className={styles.label}>Fecha Final</label>
              <input
                type="date"
                className={styles.dateInput}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ============================================
          GRÁFICAS ESTADÍSTICAS
          ============================================ */}
      <div className={styles.chartsGrid}>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)' }}>📦 Producción</h3>
        </div>

        {/* Gráfica 1: Producción por Área — a todo el ancho, es la única gráfica de esta
            sección (en un grid de 2 columnas, dejaba la mitad de la fila vacía) */}
        <motion.div variants={itemVariants} style={{ gridColumn: '1 / -1' }}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Volumen de Piezas Producidas</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataProduccion} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="cantidad" fill="#FF3300" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>✨ Calidad</h3>
        </div>

        {/* Gráfica 2: Calidad Promedio */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Desempeño de Calidad por Área</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dataCalidad} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="calificacion"
                    name="Tasa de Aprobación (%)"
                    stroke="#330066"
                    strokeWidth={3}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Gráfica 3: Acciones sobre Defectos */}
        <motion.div variants={itemVariants} style={{ gridColumn: '1 / -1' }}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Destino de Material Defectuoso (Merma vs Re-trabajo)</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataAcciones} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="cantidad" name="Cantidad de Inspecciones" radius={[4, 4, 0, 0]} barSize={40}>
                    {dataAcciones.map((entry, index) => {
                      const colors = ['var(--color-primary)', 'var(--color-alert)', 'var(--color-area-almacen)'];
                      return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>📌 Actividades</h3>
        </div>

        {/* Gráfica 4: Cumplimiento de Actividades por Área */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Cumplimiento de Actividades por Área (%)</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataActividadesArea} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="cumplimiento" name="Cumplimiento (%)" fill="var(--color-golden-yellow)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Gráfica 5: Actividades por Prioridad */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Actividades por Prioridad</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataActividadesPrioridad} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="cantidad" name="Cantidad" radius={[4, 4, 0, 0]} barSize={40}>
                    {dataActividadesPrioridad.map((entry, index) => {
                      const colors = ['var(--color-alert)', 'var(--color-warning)', 'var(--color-gray-400)'];
                      return <Cell key={`cell-prio-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Gráfica 6: Actividades Vencidas por Área */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Actividades Vencidas por Área</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataActividadesVencidas} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="vencidas" name="Vencidas" fill="var(--color-alert)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Gráfica 7: Tiempo Promedio de Resolución */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Tiempo Promedio de Resolución por Área (días)</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataActividadesTiempoResolucion} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="diasPromedio" name="Días Promedio" fill="var(--color-purple-x11)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>⏱️ Interferencia en Producción</h3>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: '-8px', marginBottom: 'var(--space-4)' }}>
            Actividades operativas SIN vínculo a ningún proyecto/juego — tiempo que le quitaron a cada área mientras estaba produciendo.
          </p>
        </div>

        {/* Gráfica 8: Días de Interferencia por Área */}
        <motion.div variants={itemVariants} style={{ gridColumn: '1 / -1' }}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Días de Interferencia por Área</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataInterferencia} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                    formatter={(value, name, props) => [
                      `${value} día(s)${props.payload.enCurso > 0 ? ` (+${props.payload.enCurso} en curso, aún no contabilizados)` : ''}`,
                      'Interferencia',
                    ]}
                  />
                  <Bar dataKey="dias" name="Días de Interferencia" fill="var(--color-alert)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {detalleInterferencia.length > 0 && (
              <div className={styles.tableResponsive} style={{ marginTop: 'var(--space-5)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Área</th>
                      <th>Actividad</th>
                      <th>Creada</th>
                      <th>Completada</th>
                      <th>Días</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleInterferencia.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Área">{a.areaId?.toUpperCase().replace('-', ' ')}</td>
                        <td data-label="Actividad" className={styles.boldText}>{a.title}</td>
                        <td data-label="Creada" className={styles.textMuted}>{new Date(a.createdAt).toLocaleDateString('es-MX')}</td>
                        <td data-label="Completada" className={styles.textMuted}>{new Date(a.completedAt).toLocaleDateString('es-MX')}</td>
                        <td data-label="Días">{a.diasDuracion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </motion.div>

        <div style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.chartTitle} style={{ marginBottom: 'var(--space-2)', marginTop: 'var(--space-2)' }}>🏭 Producción</h3>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: '-8px', marginBottom: 'var(--space-4)' }}>
            Tiempo entre el banderazo inicial de un área (🚩 Iniciar Trabajo, en Producción) y el momento en que completa su meta de piezas — solo cuenta juegos/áreas con ambos datos registrados.
          </p>
        </div>

        {/* Gráfica 9: Tiempo Promedio de Producción por Área */}
        <motion.div variants={itemVariants} style={{ gridColumn: '1 / -1' }}>
          <Card variant="default">
            <h3 className={styles.chartTitle}>Tiempo Promedio de Producción por Área (días)</h3>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dataTiempoProduccion} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="area" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Bar dataKey="diasPromedio" name="Días Promedio" fill="var(--color-area-corte-laser)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {detalleTiempoProduccionTop.length > 0 ? (
              <div className={styles.tableResponsive} style={{ marginTop: 'var(--space-5)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Juego</th>
                      <th>Área</th>
                      <th>Iniciado</th>
                      <th>Completado</th>
                      <th>Días</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleTiempoProduccionTop.map((d, idx) => (
                      <tr key={`${d.juego}-${d.area}-${idx}`}>
                        <td data-label="Juego" className={styles.boldText}>{d.juego}</td>
                        <td data-label="Área">{d.area.toUpperCase().replace('-', ' ')}</td>
                        <td data-label="Iniciado" className={styles.textMuted}>{new Date(d.iniciado).toLocaleDateString('es-MX')}</td>
                        <td data-label="Completado" className={styles.textMuted}>{new Date(d.completado).toLocaleDateString('es-MX')}</td>
                        <td data-label="Días">{d.diasDuracion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', textAlign: 'center', padding: '16px' }}>
                Todavía no hay juegos/áreas con banderazo inicial Y meta completada para calcular este tiempo.
              </p>
            )}
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default ReportesPage;
