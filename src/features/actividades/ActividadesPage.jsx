/**
 * @file ActividadesPage.jsx
 * @description Página de Gestión de Actividades de la aplicación Dicrejart
 * Permite crear y dar seguimiento a trabajos que no están ligados a un juego
 * (mantenimiento, capacitaciones, limpieza, inventarios, etc.), asignándolos
 * a un área de producción y, opcionalmente, a un operario específico
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useActividades from '../../hooks/useActividades';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection } from '../../utils/roleAccess';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import useAreas from '../../hooks/useAreas';
import { PRIORITY_LABELS, ACTIVITY_STATUS_LABELS } from '../../data/actividadesData';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useProgressiveList from '../../hooks/useProgressiveList';
import styles from './ActividadesPage.module.css';

/**
 * Mapeo de prioridad a variante visual del Badge
 * @constant
 */
const PRIORITY_BADGE_VARIANT = {
  alta: 'danger',
  media: 'warning',
  baja: 'neutral',
};

/**
 * Mapeo de estatus a variante visual del Badge
 * @constant
 */
const STATUS_BADGE_VARIANT = {
  pendiente: 'neutral',
  proceso: 'primary',
  completado: 'success',
};

/**
 * Valor por defecto de una actividad nueva en el formulario
 * @constant
 */
const EMPTY_ACTIVITY_FORM = {
  title: '',
  description: '',
  areaId: '',
  operarioId: '',
  dueDate: '',
  priority: 'media',
  projectId: '',
  gameId: '',
};

/**
 * Componente ActividadesPage - Trabajos operativos no ligados a un juego
 * @component
 * @returns {ReactElement} Render de la página de actividades
 */
const ActividadesPage = () => {
  // ============================================
  // ESTADO
  // ============================================
  const {
    actividades: allActividades,
    addActividad,
    advanceStatus,
    deleteActividad,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
  } = useActividades();
  const [areaFilter, setAreaFilter] = useState('todas');
  const [statusFilter, setStatusFilter] = useState('activos');
  // 'general' = listado plano (como siempre); 'operario' = agrupado por operario, con cada
  // grupo colapsable para ver solo lo que le corresponde a esa persona.
  const [viewMode, setViewMode] = useState('general');
  const [expandedOperarios, setExpandedOperarios] = useState(new Set());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newActivity, setNewActivity] = useState(EMPTY_ACTIVITY_FORM);
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    activityId: null,
    title: '',
  });
  const [checklistModal, setChecklistModal] = useState({
    isOpen: false,
    activityId: null,
    newItemText: '',
  });
  // Confirmación antes de marcar una actividad como completada — un solo clic accidental
  // en el badge de estatus (proceso -> completado) podía cerrarla antes de tiempo sin
  // querer; las otras transiciones (pendiente -> proceso, reabrir desde completado) son
  // de bajo riesgo y se quedan como un clic directo, sin fricción de más.
  const [completeConfirmation, setCompleteConfirmation] = useState({
    isOpen: false,
    activityId: null,
    title: '',
    notes: '',
  });

  const { operarios } = useOperarios();
  const { proyectos, juegos } = useProduccion();
  const { user } = useAuth();
  const { areas: dynamicAreas } = useAreas();
  const toast = useToast();

  // Un Encargado de Área solo consulta (solo lectura) las actividades de su área
  const isEncargado = user?.roleType === 'encargado-area';
  const isReadOnly = isReadOnlySection(user, 'actividades');
  const actividades = isEncargado
    ? allActividades.filter((act) => act.areaId === user.areaId)
    : allActividades;

  // ============================================
  // HELPERS
  // ============================================
  const getAreaName = (areaId) => dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
  const getOperarioName = (operarioId) =>
    operarios.find((op) => op.id === operarioId)?.name || null;

  // ============================================
  // HANDLERS
  // ============================================
  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNewActivity(EMPTY_ACTIVITY_FORM);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setNewActivity((prev) => {
      const updated = { ...prev, [name]: value };
      // Si cambia el área, se limpia el operario (podría no pertenecer a la nueva área)
      if (name === 'areaId') {
        updated.operarioId = '';
      }
      // Si cambia el proyecto, se limpia el juego si ya no pertenece al nuevo proyecto
      // (o si se quitó el proyecto por completo).
      if (name === 'projectId') {
        const selectedGame = juegos.find((j) => j.id === prev.gameId);
        if (!selectedGame || selectedGame.projectId !== value) {
          updated.gameId = '';
        }
      }
      return updated;
    });
  };

  const handleCreateActivity = (e) => {
    e.preventDefault();
    if (!newActivity.title || !newActivity.areaId) {
      toast.danger('Por favor ingresa un título y selecciona el área responsable.');
      return;
    }

    // El juego relacionado ya trae su propio proyecto — si se eligió un juego sin elegir
    // proyecto explícitamente, el proyecto se toma de ahí.
    const selectedGame = juegos.find((j) => j.id === newActivity.gameId);
    const selectedProject = proyectos.find((p) => p.id === newActivity.projectId)
      || (selectedGame ? proyectos.find((p) => p.id === selectedGame.projectId) : null);

    addActividad({
      title: newActivity.title,
      description: newActivity.description || 'Sin descripción.',
      areaId: newActivity.areaId,
      operarioId: newActivity.operarioId || null,
      dueDate: newActivity.dueDate || null,
      priority: newActivity.priority,
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || null,
      gameId: selectedGame?.id || null,
      gameName: selectedGame?.name || null,
    });
    toast.success('✅ Actividad registrada.');
    handleCloseModal();
  };

  /**
   * Avanza el estatus de una actividad al siguiente en el ciclo
   * pendiente -> proceso -> completado -> pendiente
   * La transición a 'completado' pide confirmación aparte (ver completeConfirmation) —
   * las demás se aplican directo, sin diálogo.
   * @param {string} activityId
   */
  const handleAdvanceStatus = (activityId) => {
    const act = actividades.find((a) => a.id === activityId);
    if (act?.status === 'proceso') {
      setCompleteConfirmation({ isOpen: true, activityId, title: act.title, notes: '' });
      return;
    }
    advanceStatus(activityId);
  };

  const handleConfirmCompleteActivity = () => {
    if (!completeConfirmation.notes.trim()) {
      toast.danger('Indica qué se hizo o verificó antes de marcar la actividad como completada.');
      return;
    }
    advanceStatus(completeConfirmation.activityId, completeConfirmation.notes);
    setCompleteConfirmation({ isOpen: false, activityId: null, title: '', notes: '' });
  };

  const handleDeleteActivity = (activityId, title) => {
    setDeleteConfirmation({
      isOpen: true,
      activityId,
      title,
    });
  };

  const handleConfirmDeleteActivity = async () => {
    const { activityId, title } = deleteConfirmation;
    if (!activityId) return;

    const res = await deleteActividad(activityId);
    if (res.ok) {
      toast.success(`🗑️ Actividad "${title}" eliminada.`);
    } else {
      toast.danger(res.error || 'Error al eliminar la actividad.');
    }
    setDeleteConfirmation({ isOpen: false, activityId: null, title: '' });
  };

  const handleOpenChecklistModal = (activityId) => {
    setChecklistModal({ isOpen: true, activityId, newItemText: '' });
  };

  const handleCloseChecklistModal = () => {
    setChecklistModal({ isOpen: false, activityId: null, newItemText: '' });
  };

  const handleAddChecklistItem = () => {
    const text = checklistModal.newItemText.trim();
    if (!text) return;
    addChecklistItem(checklistModal.activityId, text);
    setChecklistModal((prev) => ({ ...prev, newItemText: '' }));
  };

  const handleToggleChecklistItem = (itemId) => {
    toggleChecklistItem(checklistModal.activityId, itemId);
  };

  const handleRemoveChecklistItem = (itemId) => {
    removeChecklistItem(checklistModal.activityId, itemId);
  };

  /** Expande/colapsa el panel de actividades de un operario en la vista "Por Operario". */
  const toggleOperarioExpanded = (key) => {
    setExpandedOperarios((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ============================================
  // FILTRADO
  // ============================================
  const operariosDelArea = operarios.filter((op) => op.currentArea === newActivity.areaId);
  const todayStr = getTodayLocalDateStr();
  // Si se eligió un proyecto, solo muestra sus juegos; si no, todos (con el proyecto en la etiqueta)
  const juegosDisponibles = newActivity.projectId
    ? juegos.filter((j) => j.projectId === newActivity.projectId)
    : juegos;

  const filteredActividades = actividades.filter((act) => {
    const matchesArea = areaFilter === 'todas' || act.areaId === areaFilter;
    let matchesStatus = false;
    if (statusFilter === 'todos') {
      matchesStatus = true;
    } else if (statusFilter === 'activos') {
      matchesStatus = act.status !== 'completado';
    } else {
      matchesStatus = act.status === statusFilter;
    }
    return matchesArea && matchesStatus;
  });

  // Revela la lista de actividades en tandas de 15, en vez de pintarla completa.
  const {
    visibleItems: visibleFilteredActividades,
    hasMore: hasMoreFilteredActividades,
    remaining: remainingFilteredActividades,
    showMore: showMoreFilteredActividades,
  } = useProgressiveList(filteredActividades, { resetKey: `${areaFilter}-${statusFilter}` });

  // Agrupa las actividades filtradas por operario responsable, para la vista "Por
  // Operario" — las que no tienen a nadie específico asignado van en un grupo aparte al
  // final, en vez de perderse de la vista.
  const SIN_ASIGNAR_KEY = '__sin_asignar__';
  const operarioGroups = useMemo(() => {
    const map = new Map();
    filteredActividades.forEach((act) => {
      const key = act.operarioId || SIN_ASIGNAR_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(act);
    });

    const groups = Array.from(map.entries()).map(([key, acts]) => {
      const isUnassigned = key === SIN_ASIGNAR_KEY;
      const operario = isUnassigned ? null : operarios.find((op) => op.id === key);
      const pendientes = acts.filter((a) => a.status !== 'completado').length;
      return {
        key,
        name: isUnassigned ? 'Sin asignar a alguien específico' : (operario?.name || key),
        areaName: operario ? getAreaName(operario.currentArea) : null,
        activities: acts,
        pendientes,
        isUnassigned,
      };
    });

    groups.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return groups;
    // dynamicAreas (no getAreaName, que se recrea en cada render y volvería inútil el
    // memo) — sin esto, si un área se renombraba mientras alguien veía la pestaña "Por
    // Operario", el nombre de área mostrado en cada grupo se quedaba pegado al anterior
    // hasta que algo más disparara el recálculo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredActividades, operarios, dynamicAreas]);

  // ============================================
  // ANIMACIONES
  // ============================================
  const listVariants = {
    animate: { transition: { staggerChildren: 0.05 } },
  };

  const cardVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  /** Renderiza la tarjeta de una actividad — se reutiliza en la vista general y en la vista Por Operario. */
  const renderActivityCard = (act) => {
    const isOverdue = Boolean(act.dueDate) && act.dueDate < todayStr && act.status !== 'completado';
    const checklistTotal = act.checklist?.length || 0;
    const checklistDone = act.checklist?.filter((c) => c.checked).length || 0;
    const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : null;

    return (
      <motion.div key={act.id} variants={cardVariants}>
        <Card variant="default" className={styles.activityCard}>
          <div className={styles.cardHeader}>
            <span className={styles.activityId}>{act.id}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isOverdue && <Badge variant="danger">⏰ Vencida</Badge>}
              <Badge variant={PRIORITY_BADGE_VARIANT[act.priority]}>
                {PRIORITY_LABELS[act.priority]}
              </Badge>
            </div>
          </div>
          <h3 className={styles.activityTitle}>{act.title}</h3>
          <p className={styles.activityDesc}>{act.description}</p>

          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Área:</span>
            <strong>{getAreaName(act.areaId)}</strong>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Responsable:</span>
            <strong>{getOperarioName(act.operarioId) || 'Sin asignar específico'}</strong>
          </div>
          {act.projectName && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Proyecto:</span>
              <strong>{act.projectName}</strong>
            </div>
          )}
          {act.gameName && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Juego:</span>
              <strong>🧩 {act.gameName}</strong>
            </div>
          )}
          {act.dueDate && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Fecha límite:</span>
              <strong>{act.dueDate}</strong>
            </div>
          )}
          {checklistTotal > 0 && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Avance:</span>
              <strong>{checklistDone}/{checklistTotal} ({checklistPct}%)</strong>
            </div>
          )}
          {act.status === 'completado' && act.completionNotes && (
            <div style={{ fontSize: '12px', color: 'var(--color-gray-600)', backgroundColor: 'var(--color-gray-50)', border: '1px solid var(--color-gray-100)', borderRadius: '6px', padding: '8px 10px', marginTop: '2px' }}>
              <strong style={{ color: 'var(--color-dark)' }}>✅ Cierre:</strong> {act.completionNotes}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
            {isReadOnly ? (
              <Badge variant={STATUS_BADGE_VARIANT[act.status]}>
                {ACTIVITY_STATUS_LABELS[act.status]}
              </Badge>
            ) : (
              <button
                type="button"
                className={styles.statusToggle}
                onClick={() => handleAdvanceStatus(act.id)}
                title="Clic para avanzar el estatus"
                style={{ margin: 0 }}
              >
                <Badge variant={STATUS_BADGE_VARIANT[act.status]}>
                  {ACTIVITY_STATUS_LABELS[act.status]}
                </Badge>
              </button>
            )}

            {!isReadOnly && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => handleOpenChecklistModal(act.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-primary)',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    transition: 'background-color 0.2s',
                  }}
                  title="Checklist de Subtareas"
                  onMouseEnter={(el) => (el.currentTarget.style.backgroundColor = 'rgba(255, 153, 51, 0.1)')}
                  onMouseLeave={(el) => (el.currentTarget.style.backgroundColor = 'transparent')}
                >
                  📋
                </button>
                {act.status === 'pendiente' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteActivity(act.id, act.title)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-alert)',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      transition: 'background-color 0.2s',
                    }}
                    title="Eliminar Actividad"
                    onMouseEnter={(el) => (el.currentTarget.style.backgroundColor = 'rgba(255, 51, 0, 0.1)')}
                    onMouseLeave={(el) => (el.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Cabecera */}
      <PageHeader
        title="Actividades"
        subtitle="Trabajos que no están ligados a un juego: mantenimiento, capacitaciones, limpieza e inventarios."
        shape="trebol"
        accentColor="var(--color-princeton-orange)"
      >
        {!isReadOnly && (
          <Button variant="primary" size="md" onClick={handleOpenModal}>
            📌 Nueva Actividad
          </Button>
        )}
      </PageHeader>

      {/* ============================================
          FILTROS
          ============================================ */}
      <div className={styles.filtersBar}>
        <div className={styles.filterWrapper}>
          <Select
            label="Filtrar por Área"
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            options={[
              { value: 'todas', label: 'Todas las Áreas' },
              ...dynamicAreas.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </div>
        <div className={styles.filterWrapper}>
          <Select
            label="Filtrar por Estatus"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'activos', label: 'Activas (Pendientes / En Proceso)' },
              { value: 'todos', label: 'Todos los Estatus' },
              ...Object.entries(ACTIVITY_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <div className={styles.filterWrapper} style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', minWidth: 'auto' }}>
          <Button variant={viewMode === 'general' ? 'primary' : 'secondary'} size="md" onClick={() => setViewMode('general')}>
            📋 Vista General
          </Button>
          <Button variant={viewMode === 'operario' ? 'primary' : 'secondary'} size="md" onClick={() => setViewMode('operario')}>
            👤 Por Operario
          </Button>
        </div>
      </div>

      {/* ============================================
          LISTADO DE ACTIVIDADES
          ============================================ */}
      {filteredActividades.length === 0 ? (
        <EmptyState
          message="No se encontraron actividades con los filtros actuales."
          shape="trebol"
          color="var(--color-princeton-orange)"
        />
      ) : viewMode === 'general' ? (
        <>
          <motion.div className={styles.grid} variants={listVariants} initial="initial" animate="animate">
            {visibleFilteredActividades.map(renderActivityCard)}
          </motion.div>
          {hasMoreFilteredActividades && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Button variant="secondary" onClick={showMoreFilteredActividades}>
                Cargar {Math.min(remainingFilteredActividades, 15)} más ({remainingFilteredActividades} restantes)
              </Button>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {operarioGroups.map((group) => {
            const isExpanded = expandedOperarios.has(group.key);
            return (
              <Card key={group.key} variant="default" style={{ opacity: group.isUnassigned ? 0.85 : 1 }}>
                <button
                  type="button"
                  onClick={() => toggleOperarioExpanded(group.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '15px', color: 'var(--color-secondary)' }}>
                      {group.isUnassigned ? '❔' : '👤'} {group.name}
                    </strong>
                    {group.areaName && (
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>{group.areaName}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {group.pendientes > 0 && (
                      <Badge variant="warning" size="sm">{group.pendientes} activa(s)</Badge>
                    )}
                    <Badge variant="neutral" size="sm">{group.activities.length} total</Badge>
                    <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isExpanded && (
                  <motion.div
                    className={styles.grid}
                    variants={listVariants}
                    initial="initial"
                    animate="animate"
                    style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-gray-100)' }}
                  >
                    {group.activities.map(renderActivityCard)}
                  </motion.div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ============================================
          MODAL NUEVA ACTIVIDAD
          ============================================ */}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title="Registrar Nueva Actividad">
        <form onSubmit={handleCreateActivity} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Título de la Actividad</label>
            <input
              type="text"
              name="title"
              className={styles.textInput}
              placeholder="Ej: Mantenimiento preventivo de compresor"
              value={newActivity.title}
              onChange={handleFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Descripción</label>
            <textarea
              name="description"
              className={styles.textarea}
              placeholder="Detalla en qué consiste la actividad..."
              value={newActivity.description}
              onChange={handleFormChange}
              rows="3"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <Select
                label="Área Responsable"
                name="areaId"
                value={newActivity.areaId}
                onChange={handleFormChange}
                required
                placeholder="-- Selecciona el Área --"
                options={dynamicAreas.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
            <div className={styles.formGroup}>
              <Select
                label="Operario Responsable (opcional)"
                name="operarioId"
                value={newActivity.operarioId}
                onChange={handleFormChange}
                disabled={!newActivity.areaId}
                placeholder={
                  newActivity.areaId ? 'Sin asignar a alguien específico' : 'Primero elige un área'
                }
                options={operariosDelArea.map((op) => ({ value: op.id, label: op.name }))}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <Select
                label="Proyecto Relacionado (opcional)"
                name="projectId"
                value={newActivity.projectId}
                onChange={handleFormChange}
                placeholder="-- Ninguno --"
                options={proyectos.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div className={styles.formGroup}>
              <Select
                label="Juego Relacionado (opcional)"
                name="gameId"
                value={newActivity.gameId}
                onChange={handleFormChange}
                placeholder="-- Ninguno --"
                options={juegosDisponibles.map((j) => ({
                  value: j.id,
                  label: newActivity.projectId ? j.name : `${j.name} (${j.projectName})`,
                }))}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha Límite</label>
              <input
                type="date"
                name="dueDate"
                className={styles.textInput}
                value={newActivity.dueDate}
                onChange={handleFormChange}
              />
            </div>
            <div className={styles.formGroup}>
              <Select
                label="Prioridad"
                name="priority"
                value={newActivity.priority}
                onChange={handleFormChange}
                options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>

          <div className={styles.formActions}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              Crear Actividad
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE ACTIVIDAD */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, activityId: null, title: '' })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar la actividad <strong>{deleteConfirmation.title}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y eliminará permanentemente la actividad del tablero.
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeleteConfirmation({ isOpen: false, activityId: null, title: '' })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleConfirmDeleteActivity}
              >
                Eliminar Actividad
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE COMPLETAR ACTIVIDAD */}
      {completeConfirmation.isOpen && (
        <Modal
          isOpen={completeConfirmation.isOpen}
          onClose={() => setCompleteConfirmation({ isOpen: false, activityId: null, title: '', notes: '' })}
          title="✅ Confirmar Actividad Completada"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Confirmas que la actividad <strong>{completeConfirmation.title}</strong> ya se completó?
            </p>
            <div className={styles.formGroup}>
              <label className={styles.label}>¿Qué se hizo o verificó? *</label>
              <textarea
                className={styles.textarea}
                rows="3"
                required
                autoFocus
                placeholder="Ej: Se realizó el mantenimiento preventivo del compresor, se probó y quedó funcionando..."
                value={completeConfirmation.notes}
                onChange={(e) => setCompleteConfirmation((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', margin: 'var(--space-2) 0 var(--space-5)' }}>
              Se guardará junto con la fecha de cierre. Si te equivocas, puedes reabrirla después dándole clic de nuevo al estatus.
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setCompleteConfirmation({ isOpen: false, activityId: null, title: '', notes: '' })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleConfirmCompleteActivity}
              >
                ✅ Marcar como Completada
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CHECKLIST DE SUBTAREAS DE UNA ACTIVIDAD */}
      {checklistModal.isOpen && (() => {
        const activity = actividades.find((a) => a.id === checklistModal.activityId);
        if (!activity) return null;
        const checklist = activity.checklist || [];
        const done = checklist.filter((c) => c.checked).length;
        const pct = checklist.length > 0 ? Math.round((done / checklist.length) * 100) : 0;

        return (
          <Modal
            isOpen={checklistModal.isOpen}
            onClose={handleCloseChecklistModal}
            title={`📋 Checklist: ${activity.title}`}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-gray-600)', margin: 0 }}>
                {checklist.length > 0
                  ? `${done}/${checklist.length} completadas (${pct}%)`
                  : 'Aún no hay subtareas. Agrega las que consideres necesarias.'}
              </p>

              <div style={{ maxHeight: '220px', overflowY: 'auto', padding: '8px', background: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)' }}>
                {checklist.map((item) => (
                  <label
                    key={item.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}
                  >
                    <input type="checkbox" checked={item.checked} onChange={() => handleToggleChecklistItem(item.id)} />
                    <span style={{ flexGrow: 1, textDecoration: item.checked ? 'line-through' : 'none', color: item.checked ? 'var(--color-gray-500)' : 'var(--color-dark)' }}>
                      {item.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveChecklistItem(item.id)}
                      style={{ border: 'none', background: 'none', color: 'var(--color-alert)', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      ✕
                    </button>
                  </label>
                ))}
                {checklist.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-500)', display: 'block', textAlign: 'center', padding: '12px' }}>
                    Sin subtareas todavía.
                  </span>
                )}
              </div>

              <div className={styles.row}>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Ej: Solicitar refacción, revisar nivel de aceite..."
                  value={checklistModal.newItemText}
                  style={{ flexGrow: 1 }}
                  onChange={(e) => setChecklistModal((prev) => ({ ...prev, newItemText: e.target.value }))}
                />
                <Button type="button" variant="secondary" size="md" onClick={handleAddChecklistItem}>
                  ➕ Agregar
                </Button>
              </div>

              <div className={styles.formActions}>
                <Button type="button" variant="primary" size="md" onClick={handleCloseChecklistModal}>
                  Cerrar
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};

export default ActividadesPage;
