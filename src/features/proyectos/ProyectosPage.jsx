/**
 * @file ProyectosPage.jsx
 * @description Página de Gestión de Proyectos de la aplicación Dicrejart
 * Permite listar, filtrar y registrar nuevos proyectos para manufactura, mostrando el progreso acumulado
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection } from '../../utils/roleAccess';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useProgressiveList from '../../hooks/useProgressiveList';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import styles from './ProyectosPage.module.css';

/**
 * Busca en las llaves de una fila de Excel la que coincide con un patrón dado
 * @param {Object} row - Fila cruda obtenida de XLSX.utils.sheet_to_json
 * @param {RegExp} pattern - Patrón para identificar la columna buscada
 * @returns {string} El valor de la celda encontrada, o cadena vacía
 */
const getCellValue = (row, pattern) => {
  const key = Object.keys(row).find((k) => pattern.test(k));
  return key ? String(row[key]).trim() : '';
};

/**
 * Mapeo de estado de proyecto a variante visual del Badge
 * @constant
 */
const STATUS_BADGE_VARIANT = {
  progreso: 'primary',
  completado: 'success',
  pausado: 'warning',
  diseno: 'info',
};

// Etiquetas de los botones de filtro: no se puede usar status.toUpperCase() a secas
// porque 'diseno' (la clave interna, sin ñ) se vería "DISENO" en vez de "DISEÑO".
const TAB_LABELS = {
  activos: 'ACTIVOS',
  progreso: 'PROGRESO',
  diseno: 'DISEÑO',
  pausado: 'PAUSADO',
  completado: 'COMPLETADO',
  todos: 'TODOS',
};

/**
 * Componente ProyectosPage - Gestión e historial de proyectos
 * @component
 * @returns {ReactElement} Render de la página de proyectos
 */
const ProyectosPage = () => {
  // ============================================
  // ESTADO Y CONTEXTO
  // ============================================
  const { proyectos: allProyectos, juegos, addProject, deleteProject, updateProject } = useProduccion();
  const { user } = useAuth();
  const isEncargado = user?.roleType === 'encargado-area';
  const isReadOnly = isReadOnlySection(user, 'proyectos');

  // Un Encargado de Área solo consulta (solo lectura) proyectos con juegos en su área
  const proyectos = isEncargado
    ? allProyectos.filter((proj) =>
        juegos.some((j) => j.projectId === proj.id && j.areas.includes(user.areaId))
      )
    : allProyectos;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('activos');
  
  // Estado para Modal de creación
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    projectId: null,
    projectName: '',
  });
  const [newProject, setNewProject] = useState({
    name: '',
    client: '',
    description: '',
    startDate: '',
    endDate: '',
  });

  const [extendDateModal, setExtendDateModal] = useState({
    isOpen: false,
    projectId: null,
    projectName: '',
    currentEndDate: '',
    newEndDate: '',
  });

  const toast = useToast();
  const fileInputRef = useRef(null);

  // ============================================
  // HANDLERS
  // ============================================

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Lee un Excel de proyectos y los registra de manera centralizada
   *
   * @param {React.ChangeEvent<HTMLInputElement>} e
   */
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      if (rows.length === 0) {
        toast.warning('El archivo no contiene filas para importar.');
        return;
      }

      let added = 0;
      let skipped = 0;
      const today = getTodayLocalDateStr();

      rows.forEach((row) => {
        const name = getCellValue(row, /nombre|name/i);
        const client = getCellValue(row, /cliente|client/i);

        if (!name || !client) {
          skipped += 1;
          return;
        }

        addProject({
          name,
          client,
          status: 'diseno',
          startDate: getCellValue(row, /inicio|start/i) || today,
          endDate: getCellValue(row, /fin|limite|end/i) || today,
          description: getCellValue(row, /descripcion|descripción|description/i) || 'Sin descripción',
        });

        added += 1;
      });

      if (added > 0) {
        toast.success(`✅ ${added} proyecto${added === 1 ? '' : 's'} importado${added === 1 ? '' : 's'} correctamente.`);
      }
      if (skipped > 0) {
        toast.warning(`⚠️ ${skipped} fila${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'} (falta nombre o cliente).`);
      }
    } catch (error) {
      toast.danger('No se pudo leer el archivo. Verifica que sea un Excel válido (.xlsx).');
    } finally {
      e.target.value = '';
    }
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleFilterChange = (status) => {
    setStatusFilter(status);
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNewProject({
      name: '',
      client: '',
      description: '',
      startDate: '',
      endDate: '',
    });
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setNewProject((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCreateProject = (e) => {
    e.preventDefault();
    if (!newProject.name || !newProject.client) {
      toast.danger('Por favor ingresa nombre del proyecto y cliente.');
      return;
    }

    const today = getTodayLocalDateStr();

    addProject({
      name: newProject.name,
      client: newProject.client,
      description: newProject.description,
      startDate: newProject.startDate || today,
      endDate: newProject.endDate || today,
    });

    toast.success('🏗️ Proyecto registrado con éxito.');
    handleCloseModal();
  };

  const handleDeleteProject = (e, projectId, projectName) => {
    e.stopPropagation();
    setDeleteConfirmation({
      isOpen: true,
      projectId,
      projectName,
    });
  };

  const handleConfirmDeleteProject = async () => {
    const { projectId, projectName } = deleteConfirmation;
    if (!projectId) return;

    const res = await deleteProject(projectId);
    if (res.ok) {
      toast.success(`🗑️ Proyecto "${projectName}" eliminado.`);
    } else {
      toast.danger(res.error || 'Error al eliminar el proyecto.');
    }
    setDeleteConfirmation({ isOpen: false, projectId: null, projectName: '' });
  };

  const handleOpenExtendDate = (proj) => {
    setExtendDateModal({
      isOpen: true,
      projectId: proj.id,
      projectName: proj.name,
      currentEndDate: proj.endDate,
      newEndDate: proj.endDate,
    });
  };

  const handleCloseExtendDate = () => {
    setExtendDateModal({
      isOpen: false,
      projectId: null,
      projectName: '',
      currentEndDate: '',
      newEndDate: '',
    });
  };

  const handleConfirmExtendDate = async (e) => {
    e.preventDefault();
    const { projectId, newEndDate, currentEndDate } = extendDateModal;
    
    if (newEndDate === currentEndDate) {
      toast.warning('La fecha seleccionada es igual a la actual.');
      return;
    }

    const res = await updateProject(projectId, { endDate: newEndDate });
    if (res.ok) {
      toast.success('📅 Fecha de entrega extendida correctamente.');
      handleCloseExtendDate();
    } else {
      toast.danger(res.error || 'Error al actualizar la fecha del proyecto.');
    }
  };

  // ============================================
  // FILTRADO
  // ============================================
  const filteredProyectos = proyectos.filter((proj) => {
    const matchesSearch =
      proj.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proj.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proj.id.toLowerCase().includes(searchTerm.toLowerCase());

    let matchesStatus = false;
    if (statusFilter === 'todos' || (statusFilter === 'activos' && searchTerm !== '')) {
      matchesStatus = true;
    } else if (statusFilter === 'activos') {
      matchesStatus = proj.status !== 'completado';
    } else {
      matchesStatus = proj.status === statusFilter;
    }

    return matchesSearch && matchesStatus;
  });

  // Revela las tarjetas de proyectos en tandas de 15, en vez de pintarlas todas de una vez.
  const {
    visibleItems: visibleFilteredProyectos,
    hasMore: hasMoreFilteredProyectos,
    remaining: remainingFilteredProyectos,
    showMore: showMoreFilteredProyectos,
  } = useProgressiveList(filteredProyectos, { resetKey: `${searchTerm}-${statusFilter}` });

  // ============================================
  // ANIMACIONES
  // ============================================
  const listVariants = {
    animate: {
      transition: { staggerChildren: 0.05 },
    },
  };

  const cardVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  // Helper para pintar badges de estado
  const getStatusBadge = (status) => {
    const labels = {
      progreso: 'En Progreso',
      completado: 'Completado',
      pausado: 'Pausado',
      diseno: 'En Diseño',
    };
    return (
      <Badge variant={STATUS_BADGE_VARIANT[status] || 'neutral'}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <div className={styles.container}>
      {/* Cabecera */}
      <PageHeader
        title="Gestión de Proyectos"
        subtitle="Supervisa el avance y crea nuevas órdenes de producción."
        shape="arco-doble"
        accentColor="var(--color-tiffany-blue)"
      >
        {!isReadOnly && (
          <>
            <Button variant="secondary" size="md" onClick={handleUploadClick}>
              📥 Cargar Excel
            </Button>
            <Button variant="primary" size="md" onClick={handleOpenModal}>
              ➕ Nuevo Proyecto
            </Button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </PageHeader>

      {/* FILTROS Y BÚSQUEDA */}
      <div className={styles.filtersBar}>
        <div className={styles.searchWrapper}>
          <Input
            placeholder="Buscar por ID, nombre o cliente..."
            value={searchTerm}
            onChange={handleSearchChange}
            icon="🔍"
          />
        </div>
        <div className={styles.tabs}>
          {['activos', 'progreso', 'diseno', 'pausado', 'completado', 'todos'].map((status) => (
            <button
              key={status}
              className={`${styles.tabButton} ${statusFilter === status ? styles.activeTab : ''}`}
              onClick={() => handleFilterChange(status)}
            >
              {TAB_LABELS[status] || status.toUpperCase().replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* LISTADO DE PROYECTOS */}
      {filteredProyectos.length > 0 ? (
        <motion.div
          className={styles.grid}
          variants={listVariants}
          initial="initial"
          animate="animate"
        >
          {visibleFilteredProyectos.map((proj) => {
            // Obtener los juegos pertenecientes a este proyecto
            const projectGames = juegos.filter((jg) => jg.projectId === proj.id);

            return (
              <motion.div key={proj.id} variants={cardVariants} whileHover={{ y: -4 }}>
                <Card variant="default" className={styles.projectCard}>
                  <div className={styles.projectHeader}>
                    <span className={styles.projectId}>{proj.id}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {getStatusBadge(proj.status)}
                      {!isReadOnly && proj.progress === 0 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteProject(e, proj.id, proj.name)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-alert)',
                            cursor: 'pointer',
                            fontSize: '16px',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            transition: 'background-color 0.2s',
                          }}
                          title="Eliminar Proyecto"
                          onMouseEnter={(el) => (el.currentTarget.style.backgroundColor = 'rgba(255, 51, 0, 0.1)')}
                          onMouseLeave={(el) => (el.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                  <h3 className={styles.projectTitle}>{proj.name}</h3>
                  <p className={styles.clientText}>
                    <strong>Cliente:</strong> {proj.client}
                  </p>
                  <p className={styles.descText}>{proj.description}</p>

                  {/* Juegos vinculados y sus avances */}
                  {projectGames.length > 0 && (
                    <div className={styles.projectGamesSection}>
                      <h4 className={styles.projectGamesTitle}>Juegos en este Proyecto</h4>
                      <div className={styles.projectGamesList}>
                        {projectGames.map((jg) => (
                          <div key={jg.id} className={styles.projectGameRow}>
                            <span className={styles.projectGameName}>{jg.name}</span>
                            <Badge variant={jg.progress === 100 ? 'success' : 'primary'} size="sm">
                              {jg.progress}%
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Barra de Progreso */}
                  <div className={styles.progressContainer}>
                    <div className={styles.progressLabel}>
                      <span>Progreso de Manufactura</span>
                      <strong>{proj.progress}%</strong>
                    </div>
                    <div className={styles.progressBarBg}>
                      <div
                        className={styles.progressBar}
                        style={{
                          width: `${proj.progress}%`,
                          backgroundColor:
                            proj.progress === 100
                              ? 'var(--color-success)'
                              : proj.status === 'pausado'
                              ? 'var(--color-area-almacen)'
                              : 'var(--color-primary)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Fechas */}
                  <div className={styles.projectDates}>
                    <div>
                      <span>Inicio:</span>
                      <strong>{proj.startDate}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>Entrega:</span>
                        <strong>{proj.endDate}</strong>
                      </div>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleOpenExtendDate(proj)}
                          style={{
                            background: 'rgba(0,0,0,0.05)',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            transition: 'background-color 0.2s',
                          }}
                          title="Extender Fecha Límite"
                          onMouseEnter={(el) => (el.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)')}
                          onMouseLeave={(el) => (el.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)')}
                        >
                          📅
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <EmptyState
          message="No se encontraron proyectos con los criterios de búsqueda actuales."
          shape="arco-doble"
          color="var(--color-tiffany-blue)"
        />
      )}
      {hasMoreFilteredProyectos && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={showMoreFilteredProyectos}>
            Cargar {Math.min(remainingFilteredProyectos, 15)} más ({remainingFilteredProyectos} restantes)
          </Button>
        </div>
      )}

      {/* MODAL NUEVO PROYECTO */}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title="Registrar Nuevo Proyecto">
        <form onSubmit={handleCreateProject} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre del Proyecto</label>
            <input
              type="text"
              name="name"
              className={styles.textInput}
              placeholder="Ej: Parque Infantil Reforma"
              value={newProject.name}
              onChange={handleFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Cliente</label>
            <input
              type="text"
              name="client"
              className={styles.textInput}
              placeholder="Ej: Alcaldía Cuauhtémoc"
              value={newProject.client}
              onChange={handleFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Descripción</label>
            <textarea
              name="description"
              className={styles.textarea}
              placeholder="Detalla los juegos e instalaciones..."
              value={newProject.description}
              onChange={handleFormChange}
              rows="3"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha de Inicio</label>
              <input
                type="date"
                name="startDate"
                className={styles.textInput}
                value={newProject.startDate}
                onChange={handleFormChange}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha Límite</label>
              <input
                type="date"
                name="endDate"
                className={styles.textInput}
                value={newProject.endDate}
                onChange={handleFormChange}
              />
            </div>
          </div>

          <div className={styles.formActions}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              Crear Proyecto
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE PROYECTO */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, projectId: null, projectName: '' })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar el proyecto <strong>{deleteConfirmation.projectName}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y también eliminará todos sus juegos asociados (si no tienen avance de piezas registrado).
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeleteConfirmation({ isOpen: false, projectId: null, projectName: '' })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleConfirmDeleteProject}
              >
                Eliminar Proyecto
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: EXTENDER FECHA LÍMITE */}
      {extendDateModal.isOpen && (
        <Modal
          isOpen={extendDateModal.isOpen}
          onClose={handleCloseExtendDate}
          title="📅 Extender Fecha Límite"
        >
          <form onSubmit={handleConfirmExtendDate} style={{ padding: 'var(--space-2) 0' }}>
            <div style={{
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
              borderLeft: '4px solid var(--color-warning)',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: 'var(--space-4)'
            }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-dark)', fontWeight: '600' }}>
                ⚠️ Advertencia de seguridad
              </p>
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--color-gray-500)' }}>
                ¿Estás seguro que deseas extender la fecha de entrega del proyecto <strong>{extendDateModal.projectName}</strong>? Esta acción quedará registrada permanentemente en la bitácora de movimientos para auditoría.
              </p>
            </div>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha Anterior</label>
              <input
                type="date"
                className={styles.textInput}
                value={extendDateModal.currentEndDate}
                disabled
                style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-500)' }}
              />
            </div>

            <div className={styles.formGroup} style={{ marginTop: 'var(--space-3)' }}>
              <label className={styles.label}>Nueva Fecha Límite</label>
              <input
                type="date"
                className={styles.textInput}
                value={extendDateModal.newEndDate}
                onChange={(e) => setExtendDateModal(prev => ({ ...prev, newEndDate: e.target.value }))}
                min={extendDateModal.currentEndDate}
                required
              />
            </div>

            <div className={styles.formActions} style={{ marginTop: 'var(--space-5)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleCloseExtendDate}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="warning"
                size="md"
              >
                Confirmar y Extender
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default ProyectosPage;
