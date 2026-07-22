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

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useActividades from '../../hooks/useActividades';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection } from '../../utils/roleAccess';
import { AREAS_CATALOG } from '../../data/areasConfig';
import { PRIORITY_LABELS, ACTIVITY_STATUS_LABELS } from '../../data/actividadesData';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
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
  const { actividades: allActividades, addActividad, advanceStatus, deleteActividad } = useActividades();
  const [areaFilter, setAreaFilter] = useState('todas');
  const [statusFilter, setStatusFilter] = useState('activos');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newActivity, setNewActivity] = useState(EMPTY_ACTIVITY_FORM);
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    activityId: null,
    title: '',
  });

  const { operarios } = useOperarios();
  const { user } = useAuth();
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
  const getAreaName = (areaId) => AREAS_CATALOG.find((a) => a.id === areaId)?.name || areaId;
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
      return updated;
    });
  };

  const handleCreateActivity = (e) => {
    e.preventDefault();
    if (!newActivity.title || !newActivity.areaId) {
      toast.danger('Por favor ingresa un título y selecciona el área responsable.');
      return;
    }

    addActividad({
      title: newActivity.title,
      description: newActivity.description || 'Sin descripción.',
      areaId: newActivity.areaId,
      operarioId: newActivity.operarioId || null,
      dueDate: newActivity.dueDate || null,
      priority: newActivity.priority,
    });
    toast.success('✅ Actividad registrada.');
    handleCloseModal();
  };

  /**
   * Avanza el estatus de una actividad al siguiente en el ciclo
   * pendiente -> proceso -> completado -> pendiente
   * @param {string} activityId
   */
  const handleAdvanceStatus = (activityId) => {
    advanceStatus(activityId);
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

  // ============================================
  // FILTRADO
  // ============================================
  const operariosDelArea = operarios.filter((op) => op.currentArea === newActivity.areaId);

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
              ...AREAS_CATALOG.map((a) => ({ value: a.id, label: a.name })),
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
      </div>

      {/* ============================================
          LISTADO DE ACTIVIDADES
          ============================================ */}
      {filteredActividades.length > 0 ? (
        <motion.div className={styles.grid} variants={listVariants} initial="initial" animate="animate">
          {filteredActividades.map((act) => (
            <motion.div key={act.id} variants={cardVariants}>
              <Card variant="default" className={styles.activityCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.activityId}>{act.id}</span>
                  <Badge variant={PRIORITY_BADGE_VARIANT[act.priority]}>
                    {PRIORITY_LABELS[act.priority]}
                  </Badge>
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
                {act.dueDate && (
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Fecha límite:</span>
                    <strong>{act.dueDate}</strong>
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

                  {!isReadOnly && act.status === 'pendiente' && (
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
              </Card>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <EmptyState
          message="No se encontraron actividades con los filtros actuales."
          shape="trebol"
          color="var(--color-princeton-orange)"
        />
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
                options={AREAS_CATALOG.map((a) => ({ value: a.id, label: a.name }))}
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
    </div>
  );
};

export default ActividadesPage;
