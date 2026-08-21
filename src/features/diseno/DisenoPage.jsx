/**
 * @file DisenoPage.jsx
 * @description Sección de Diseño y Arquitectura — gestión y consulta integral:
 * - Diseñador/Arquitecto: consulta sus tareas asignadas y puede explorar todas las tareas del departamento.
 * - Administradores, Calidad y Supervisores: vista completa de todas las actividades del departamento
 *   de Diseño y Arquitectura (con filtros por área, puesto, estatus y búsqueda por proyecto/texto).
 * @author Dicrejart Dev Team
 */

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useAuth from '../../hooks/useAuth';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import useProduccion from '../../hooks/useProduccion';
import useToast from '../../hooks/useToast';
import { ROLE_TYPES } from '../../data/usersData';
import { PRIORITY_LABELS, ACTIVITY_STATUS_LABELS } from '../../data/actividadesData';
import { PUESTO_LABELS, PUESTO_ICONS, PUESTO_BADGE_VARIANT } from '../../data/puestoConfig';
import styles from './DisenoPage.module.css';

const PRIORITY_BADGE_VARIANT = {
  alta: 'danger',
  media: 'warning',
  baja: 'neutral',
};

const STATUS_BADGE_VARIANT = {
  pendiente: 'neutral',
  proceso: 'primary',
  completado: 'success',
};

/**
 * Determina si una actividad pertenece al departamento de Diseño / Arquitectura
 */
const isDesignOrArquiActivity = (act, operarios = []) => {
  if (!act) return false;
  const area = String(act.areaId || '').toLowerCase().trim();
  if (
    area === 'diseno' ||
    area === 'arquitectura' ||
    area.includes('diseno') ||
    area.includes('arqui') ||
    area.includes('plano') ||
    area.includes('modelo')
  ) {
    return true;
  }
  const resp = operarios.find((o) => o.id === act.operarioId);
  if (resp && (resp.puesto === 'disenador' || resp.puesto === 'arquitecto')) {
    return true;
  }
  return false;
};

/** Fila de una actividad */
const TaskRow = ({ act, responsable, proyectos, onStart, onComplete, canControl, operarios, onAssign }) => {
  const modelUrl = act.modelFile?.url || act.modelLink || null;
  const attachmentCount = act.attachments?.length || 0;
  const linkCount = act.links?.length || 0;
  const projectName = act.projectName || proyectos.find((p) => p.id === act.projectId)?.name || null;

  const designOperarios = operarios.filter(
    (o) => o.puesto === 'disenador' || o.puesto === 'arquitecto' || o.homeArea === 'diseno' || o.homeArea === 'arquitectura'
  );

  return (
    <div className={styles.taskRow}>
      <div className={styles.taskMain}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <strong>📌 {act.title}</strong>
          {projectName && (
            <span style={{ fontSize: '11px', color: 'var(--color-secondary)', fontWeight: 600 }}>
              · 🗂️ {projectName}
            </span>
          )}
        </div>
        <p className={styles.taskDescription}>{act.description || 'Sin descripción.'}</p>
        {linkCount > 0 && (
          <div className={styles.taskLinks}>
            {act.links.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
            ))}
          </div>
        )}
      </div>

      <div className={styles.taskMeta}>
        <Badge variant={act.areaId === 'arquitectura' ? 'info' : 'primary'}>
          {act.areaId === 'arquitectura' ? '📐 Arquitectura' : '✏️ Diseño'}
        </Badge>

        {responsable ? (
          <Badge variant={PUESTO_BADGE_VARIANT[responsable?.puesto || 'operario']}>
            {`${PUESTO_ICONS[responsable.puesto || 'operario']} ${responsable.name}`}
          </Badge>
        ) : (
          onAssign && (
            <select
              value=""
              onChange={(e) => onAssign(act.id, e.target.value)}
              style={{
                fontSize: '11px',
                padding: '3px 6px',
                borderRadius: '4px',
                border: '1px dashed var(--color-alert, #ea580c)',
                color: 'var(--color-alert, #ea580c)',
                background: 'rgba(234, 88, 12, 0.08)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Asignar responsable de Diseño o Arquitectura"
            >
              <option value="">⚠️ Asignar responsable...</option>
              {designOperarios.map((op) => (
                <option key={op.id} value={op.id}>
                  {PUESTO_ICONS[op.puesto || 'operario']} {op.name} ({PUESTO_LABELS[op.puesto || 'operario']})
                </option>
              ))}
              {operarios.filter(o => !designOperarios.some(d => d.id === o.id)).map((op) => (
                <option key={op.id} value={op.id}>
                  👷 {op.name}
                </option>
              ))}
            </select>
          )
        )}

        <Badge variant={PRIORITY_BADGE_VARIANT[act.priority]}>{PRIORITY_LABELS[act.priority]}</Badge>
        <Badge variant={STATUS_BADGE_VARIANT[act.status]}>{ACTIVITY_STATUS_LABELS[act.status]}</Badge>
        {act.dueDate && <span className={styles.taskDueDate}>📅 {act.dueDate}</span>}
        {attachmentCount > 0 && <span className={styles.taskAttachCount}>📎 {attachmentCount}</span>}

        {modelUrl && (
          <button
            type="button"
            className={styles.taskModelBtn}
            onClick={() => window.open(modelUrl, '_blank', 'noreferrer')}
            title={act.modelFile ? `Abrir ${act.modelFile.name}` : 'Abrir link del modelo'}
          >
            🎬 Modelo/Plano
          </button>
        )}

        {canControl && (
          <div style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px' }}>
            {act.status === 'pendiente' && (
              <button
                type="button"
                onClick={() => onStart(act.id, act.title)}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  background: 'var(--color-primary, #ea580c)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
                title="Iniciar actividad"
              >
                ▶️ Iniciar
              </button>
            )}
            {act.status === 'proceso' && (
              <button
                type="button"
                onClick={() => onComplete(act.id, act.title)}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
                title="Terminar actividad"
              >
                ✅ Terminar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DisenoPage = () => {
  const { user } = useAuth();
  const { actividades, updateActividad } = useActividades();
  const { operarios } = useOperarios();
  const { proyectos } = useProduccion();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState('todas'); // 'mis-tareas' | 'todas' | 'sin-asignar'
  const [areaFilter, setAreaFilter] = useState('todas'); // 'todas' | 'diseno' | 'arquitectura'
  const [puestoFilter, setPuestoFilter] = useState('todos'); // 'todos' | 'disenador' | 'arquitecto'
  const [statusFilter, setStatusFilter] = useState('todos'); // 'todos' | 'pendiente' | 'proceso' | 'completado'
  const [searchQuery, setSearchQuery] = useState('');

  const isDesignStaff = user?.roleType === ROLE_TYPES.DISENADOR || user?.roleType === ROLE_TYPES.ARQUITECTO;
  const isAdminOrSupervisor =
    user?.role === 'admin' ||
    user?.roleType === 'admin' ||
    user?.roleType === 'director' ||
    user?.roleType === 'calidad' ||
    user?.roleType === 'gerencia' ||
    user?.roleType === 'supervisor-area' ||
    user?.roleType === 'encargado-area';

  // Todas las actividades de Diseño y Arquitectura
  const allDesignActivities = useMemo(() => {
    return actividades.filter((a) => isDesignOrArquiActivity(a, operarios));
  }, [actividades, operarios]);

  // Identificar si una actividad está asignada al usuario logueado
  const isMyTask = (act) => {
    if (!user || !act) return false;
    if (user.operarioId && act.operarioId === user.operarioId) return true;
    if (user.id && (act.operarioId === user.id || act.operarioId === user.uid)) return true;
    const op = operarios.find((o) => o.id === act.operarioId);
    if (op) {
      if (user.email && op.email && op.email.toLowerCase() === user.email.toLowerCase()) return true;
      if (user.name && op.name && op.name.trim().toLowerCase() === user.name.trim().toLowerCase()) return true;
    }
    return false;
  };

  const misTareas = useMemo(() => {
    return allDesignActivities.filter(isMyTask);
  }, [allDesignActivities, user, operarios]);

  const sinAsignar = useMemo(() => {
    return allDesignActivities.filter((a) => !a.operarioId);
  }, [allDesignActivities]);

  const filteredActividades = useMemo(() => {
    return allDesignActivities.filter((a) => {
      // Filtro de pestaña
      if (activeTab === 'mis-tareas' && !isMyTask(a)) return false;
      if (activeTab === 'sin-asignar' && a.operarioId) return false;

      // Filtro de área
      if (areaFilter !== 'todas') {
        const aArea = String(a.areaId || '').toLowerCase();
        if (!aArea.includes(areaFilter)) return false;
      }

      // Filtro de puesto
      if (puestoFilter !== 'todos') {
        const resp = operarios.find((o) => o.id === a.operarioId);
        if (resp?.puesto !== puestoFilter) return false;
      }

      // Filtro de estatus
      if (statusFilter !== 'todos' && a.status !== statusFilter) return false;

      // Filtro de búsqueda
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const pName = a.projectName || proyectos.find((p) => p.id === a.projectId)?.name || '';
        const rName = operarios.find((o) => o.id === a.operarioId)?.name || '';
        const matchTitle = (a.title || '').toLowerCase().includes(q);
        const matchDesc = (a.description || '').toLowerCase().includes(q);
        const matchProj = pName.toLowerCase().includes(q);
        const matchResp = rName.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchProj && !matchResp) return false;
      }

      return true;
    });
  }, [allDesignActivities, activeTab, areaFilter, puestoFilter, statusFilter, searchQuery, operarios, proyectos, user]);

  const pendientes = allDesignActivities.filter((a) => a.status === 'pendiente').length;
  const enProceso = allDesignActivities.filter((a) => a.status === 'proceso').length;
  const completadas = allDesignActivities.filter((a) => a.status === 'completado').length;

  const handleStartActivity = async (actId, title) => {
    const res = await updateActividad(actId, {
      status: 'proceso',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (res?.ok) toast.success(`⚡ Actividad "${title}" iniciada.`);
    else toast.danger('No se pudo iniciar la actividad.');
  };

  const handleCompleteActivity = async (actId, title) => {
    const res = await updateActividad(actId, {
      status: 'completado',
      completedAt: new Date().toISOString(),
      completionNotes: 'Actividad concluida satisfactoriamente.',
      updatedAt: new Date().toISOString(),
    });
    if (res?.ok) toast.success(`✅ Actividad "${title}" completada.`);
    else toast.danger('No se pudo completar la actividad.');
  };

  const handleAssignDirect = async (actId, operarioId) => {
    if (!operarioId) return;
    const op = operarios.find((o) => o.id === operarioId);
    const res = await updateActividad(actId, {
      operarioId,
      updatedAt: new Date().toISOString(),
    });
    if (res?.ok) {
      toast.success(`👷 Actividad asignada a ${op?.name || 'Colaborador'}.`);
    } else {
      toast.danger('No se pudo asignar la actividad.');
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Diseño y Arquitectura"
        subtitle="Gestión y seguimiento de planos, modelos 3D y actividades técnicas creadas desde el Editor Visual o Actividades."
        shape="picos"
        accentColor="var(--color-purple-x11, #8b5cf6)"
      />

      {/* KPI GRID */}
      <div className={styles.kpiGrid}>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Total Actividades</span>
            <h3 className={styles.kpiValue}>{allDesignActivities.length}</h3>
          </div>
        </Card>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Pendientes</span>
            <h3 className={styles.kpiValue}>{pendientes}</h3>
          </div>
        </Card>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>En Proceso</span>
            <h3 className={styles.kpiValue} style={{ color: 'var(--color-primary)' }}>{enProceso}</h3>
          </div>
        </Card>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Completadas</span>
            <h3 className={styles.kpiValue} style={{ color: 'var(--color-tiffany-blue)' }}>{completadas}</h3>
          </div>
        </Card>
        <Card variant="warning">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Sin Asignar</span>
            <h3 className={styles.kpiValue} style={{ color: 'var(--color-alert)' }}>{sinAsignar.length}</h3>
          </div>
        </Card>
      </div>

      {/* Pestañas de Vista */}
      <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
        <Button
          variant={activeTab === 'todas' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setActiveTab('todas')}
        >
          📂 Todas las Actividades ({allDesignActivities.length})
        </Button>
        {isDesignStaff && (
          <Button
            variant={activeTab === 'mis-tareas' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('mis-tareas')}
          >
            📌 Mis Tareas Asignadas ({misTareas.length})
          </Button>
        )}
        <Button
          variant={activeTab === 'sin-asignar' ? 'danger' : 'secondary'}
          size="sm"
          onClick={() => setActiveTab('sin-asignar')}
        >
          ⚠️ Sin Asignar ({sinAsignar.length})
        </Button>
      </div>

      {/* Tarjeta de Lista y Filtros */}
      <Card variant="default" style={{ marginTop: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
              {activeTab === 'mis-tareas'
                ? `📌 Mis Tareas (${filteredActividades.length})`
                : activeTab === 'sin-asignar'
                ? `⚠️ Actividades Pendientes de Asignar (${filteredActividades.length})`
                : `🏢 Tareas del Departamento (${filteredActividades.length})`}
            </h3>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Búsqueda */}
              <input
                type="text"
                placeholder="🔍 Buscar tarea o proyecto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-gray-300)',
                  backgroundColor: 'var(--input-bg, var(--color-white))',
                  color: 'var(--color-dark)',
                  minWidth: '200px',
                }}
              />

              {/* Filtro de Área */}
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-gray-300)',
                  backgroundColor: 'var(--input-bg, var(--color-white))',
                  color: 'var(--color-dark)',
                  cursor: 'pointer',
                }}
              >
                <option value="todas">🏭 Todas las Áreas</option>
                <option value="diseno">✏️ Solo Diseño</option>
                <option value="arquitectura">📐 Solo Arquitectura</option>
              </select>

              {/* Filtro de Puesto */}
              <select
                value={puestoFilter}
                onChange={(e) => setPuestoFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-gray-300)',
                  backgroundColor: 'var(--input-bg, var(--color-white))',
                  color: 'var(--color-dark)',
                  cursor: 'pointer',
                }}
              >
                <option value="todos">👥 Todos los Puestos</option>
                <option value="disenador">✏️ Diseñador</option>
                <option value="arquitecto">📐 Arquitecto</option>
              </select>

              {/* Filtro de Estatus */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-gray-300)',
                  backgroundColor: 'var(--input-bg, var(--color-white))',
                  color: 'var(--color-dark)',
                  cursor: 'pointer',
                }}
              >
                <option value="todos">⚡ Todos los Estatus</option>
                <option value="pendiente">⏳ Pendientes</option>
                <option value="proceso">⚡ En Proceso</option>
                <option value="completado">✅ Completadas</option>
              </select>
            </div>
          </div>

          {filteredActividades.length === 0 ? (
            <EmptyState
              message={
                activeTab === 'mis-tareas'
                  ? 'No tienes tareas asignadas en este momento.'
                  : activeTab === 'sin-asignar'
                  ? 'Todas las actividades de Diseño y Arquitectura tienen un responsable asignado.'
                  : 'No se encontraron actividades de Diseño o Arquitectura con los filtros seleccionados.'
              }
              shape="picos"
              color="var(--color-purple-x11, #8b5cf6)"
            />
          ) : (
            <div className={styles.list}>
              {filteredActividades.map((act) => (
                <TaskRow
                  key={act.id}
                  act={act}
                  responsable={operarios.find((o) => o.id === act.operarioId)}
                  proyectos={proyectos}
                  operarios={operarios}
                  onStart={handleStartActivity}
                  onComplete={handleCompleteActivity}
                  canControl={isAdminOrSupervisor || isMyTask(act)}
                  onAssign={isAdminOrSupervisor ? handleAssignDirect : null}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
};

export default DisenoPage;
