/**
 * @file DisenoPage.jsx
 * @description Sección de Diseño — dos vistas distintas según quién la vea:
 * - Diseñador/Arquitecto (personal del departamento): solo consulta sus propias tareas
 *   asignadas, vinculadas a su registro del padrón de Operarios (`user.operarioId`).
 * - Cualquier otro rol con acceso (hoy solo Admin, vía el acceso total de ese rol):
 *   ve TODAS las actividades del departamento (`areaId === 'diseno'`), con la
 *   información completa (responsable, prioridad, estatus, adjuntos, modelo/plano).
 * Diseño no es un área de manufactura (no entra a la secuencia de producción ni al
 * catálogo de las 8 áreas), por eso vive en su propia sección en vez de dentro de
 * Producción. Las actividades mismas se crean desde los Bloques del Editor Visual o
 * desde Actividades, no desde aquí.
 * @author Dicrejart Dev Team
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useAuth from '../../hooks/useAuth';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
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

/** Fila de una actividad, compartida entre la vista personal y la vista completa del
 * departamento — la única diferencia entre ambas es qué actividades le llegan y si se
 * muestra o no la columna de Responsable. */
const TaskRow = ({ act, responsable, showResponsable }) => {
  const modelUrl = act.modelFile?.url || act.modelLink || null;
  const attachmentCount = act.attachments?.length || 0;
  const linkCount = act.links?.length || 0;

  return (
    <div className={styles.taskRow}>
      <div className={styles.taskMain}>
        <strong>{act.title}</strong>
        <p className={styles.taskDescription}>{act.description}</p>
        {linkCount > 0 && (
          <div className={styles.taskLinks}>
            {act.links.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
            ))}
          </div>
        )}
      </div>
      <div className={styles.taskMeta}>
        {showResponsable && (
          <Badge variant={PUESTO_BADGE_VARIANT[responsable?.puesto || 'operario']}>
            {responsable ? `${PUESTO_ICONS[responsable.puesto || 'operario']} ${responsable.name}` : 'Sin asignar'}
          </Badge>
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
            🎬 Abrir Modelo
          </button>
        )}
      </div>
    </div>
  );
};

const DisenoPage = () => {
  const { user } = useAuth();
  const { actividades } = useActividades();
  const { operarios } = useOperarios();
  // Declarado arriba de cualquier "return" condicional (reglas de Hooks) aunque solo lo
  // use la vista completa del departamento, más abajo.
  const [puestoFilter, setPuestoFilter] = useState('todos');

  const isDesignStaff = user?.roleType === ROLE_TYPES.DISENADOR || user?.roleType === ROLE_TYPES.ARQUITECTO;

  // ============================================
  // VISTA PERSONAL (Diseñador / Arquitecto): solo sus propias tareas
  // ============================================
  if (isDesignStaff) {
    const misTareas = user?.operarioId
      ? actividades.filter((a) => a.operarioId === user.operarioId)
      : [];
    const pendientes = misTareas.filter((a) => a.status === 'pendiente').length;
    const enProceso = misTareas.filter((a) => a.status === 'proceso').length;
    const completadas = misTareas.filter((a) => a.status === 'completado').length;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <PageHeader
          title="Diseño"
          subtitle="Tus tareas asignadas — solo consulta. El área/responsable se gestiona desde Actividades o el Editor Visual."
          shape="picos"
          accentColor="var(--color-purple-x11)"
        />

        {!user?.operarioId ? (
          <EmptyState
            message="⚠️ Tu cuenta todavía no está vinculada a un registro del padrón de Operarios. Pide a un Administrador que complete ese vínculo desde Admin → Usuarios del Sistema."
            shape="picos"
            color="var(--color-alert)"
          />
        ) : (
          <>
            <div className={styles.kpiGrid}>
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
            </div>

            <Card variant="default" style={{ marginTop: 'var(--space-5)' }}>
              <h3 className={styles.sectionTitle}>Mis Tareas Asignadas</h3>
              {misTareas.length === 0 ? (
                <EmptyState message="Todavía no tienes tareas asignadas." shape="picos" color="var(--color-purple-x11)" />
              ) : (
                <div className={styles.list}>
                  {misTareas.map((act) => (
                    <TaskRow key={act.id} act={act} showResponsable={false} />
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </motion.div>
    );
  }

  // ============================================
  // VISTA COMPLETA DEL DEPARTAMENTO (Admin): todas las actividades de "diseno"
  // ============================================
  const disenoActividades = actividades.filter((a) => a.areaId === 'diseno');
  const filteredActividades = disenoActividades.filter((a) => {
    if (puestoFilter === 'todos') return true;
    const responsable = operarios.find((o) => o.id === a.operarioId);
    return responsable?.puesto === puestoFilter;
  });

  const pendientes = disenoActividades.filter((a) => a.status === 'pendiente').length;
  const enProceso = disenoActividades.filter((a) => a.status === 'proceso').length;
  const completadas = disenoActividades.filter((a) => a.status === 'completado').length;
  // "Pendiente de asignar" es distinto de "pendiente" (de estatus): son actividades que
  // se crearon en un Bloque sin un Colaborador conectado en ese momento (o a las que se
  // les quitó el responsable) — nadie las va a ver en su vista personal hasta que alguien
  // las asigne, así que se destacan aparte en vez de perderse en el listado general.
  const sinAsignar = disenoActividades.filter((a) => !a.operarioId);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Diseño"
        subtitle="Todas las actividades del departamento de Diseño (Diseñadores y Arquitectos) — creadas desde los Bloques del Editor Visual o desde Actividades."
        shape="picos"
        accentColor="var(--color-purple-x11)"
      />

      <div className={styles.kpiGrid}>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Total de Actividades</span>
            <h3 className={styles.kpiValue}>{disenoActividades.length}</h3>
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

      <Card variant="warning" style={{ marginTop: 'var(--space-5)' }}>
        <h3 className={styles.sectionTitle}>⚠️ Pendientes de Asignar ({sinAsignar.length})</h3>
        {sinAsignar.length === 0 ? (
          <EmptyState message="Todas las actividades de Diseño tienen un responsable asignado." shape="picos" color="var(--color-tiffany-blue)" />
        ) : (
          <div className={styles.list}>
            {sinAsignar.map((act) => (
              <TaskRow key={act.id} act={act} responsable={null} showResponsable />
            ))}
          </div>
        )}
      </Card>

      <Card variant="default" style={{ marginTop: 'var(--space-5)' }}>
        <div className={styles.filterBar}>
          <h3 className={styles.sectionTitle}>Actividades del Departamento</h3>
          <div className={styles.filterWrapper}>
            <Select
              label="Filtrar por Puesto"
              value={puestoFilter}
              onChange={(e) => setPuestoFilter(e.target.value)}
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'disenador', label: `${PUESTO_ICONS.disenador} ${PUESTO_LABELS.disenador}` },
                { value: 'arquitecto', label: `${PUESTO_ICONS.arquitecto} ${PUESTO_LABELS.arquitecto}` },
              ]}
            />
          </div>
        </div>
        {filteredActividades.length === 0 ? (
          <EmptyState
            message="No hay actividades de Diseño todavía — se crean desde los Bloques del Editor Visual o desde Actividades."
            shape="picos"
            color="var(--color-purple-x11)"
          />
        ) : (
          <div className={styles.list}>
            {filteredActividades.map((act) => (
              <TaskRow
                key={act.id}
                act={act}
                responsable={operarios.find((o) => o.id === act.operarioId)}
                showResponsable
              />
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
};

export default DisenoPage;
