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

  const toast = useToast();
  const { historialProduccion } = useProduccion();
  const { inspecciones } = useCalidad();

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
        
        {/* Gráfica 1: Producción por Área */}
        <motion.div variants={itemVariants}>
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
      </div>
    </motion.div>
  );
};

export default ReportesPage;
