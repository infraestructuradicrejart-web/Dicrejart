/**
 * @file JuegosPage.jsx
 * @description Página de Gestión de Juegos de la aplicación Dicrejart
 * Permite catalogar los juegos en manufactura, definir sus rutas y rastrear su progreso
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection } from '../../utils/roleAccess';
import { normalizeText } from '../../data/areasConfig';
import useAreas from '../../hooks/useAreas';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import styles from './JuegosPage.module.css';

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
 * Mapeo de estado de juego a variante visual del Badge
 * @constant
 */
const STATUS_BADGE_VARIANT = {
  completado: 'success',
  demorado: 'danger',
  progreso: 'primary',
};

/**
 * Etiquetas legibles para cada estatus de área
 * @constant
 */
const AREA_STATUS_LABEL = {
  pendiente: 'Pendiente',
  proceso: 'En Proceso',
  completado: 'Completado',
};

/**
 * Componente JuegosPage - Catálogo de juegos en producción y diseño de rutas
 * @component
 * @returns {ReactElement} Render de la página de juegos
 */
const JuegosPage = () => {
  // ============================================
  // ESTADO Y CONTEXTO GLOBAL
  // ============================================
  const { juegos: allJuegos, proyectos, addGame, deleteGame } = useProduccion();
  const { user } = useAuth();
  const { areas: dynamicAreas, resolveAreaId } = useAreas();
  const isEncargado = user?.roleType === 'encargado-area';
  const isReadOnly = isReadOnlySection(user, 'juegos');

  // Construir mapa de áreas para acceso rápido por ID
  const AREAS_MAP = React.useMemo(() => {
    return dynamicAreas.reduce((acc, area) => {
      acc[area.id] = area;
      return acc;
    }, {});
  }, [dynamicAreas]);

  // Un Encargado de Área solo consulta (solo lectura) los juegos que pasan por su área
  const juegos = isEncargado ? allJuegos.filter((j) => j.areas.includes(user.areaId)) : allJuegos;

  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('activos');

  // Estado para Modal de creación
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    gameId: null,
    gameName: '',
  });
  const [newGame, setNewGame] = useState({
    name: '',
    projectId: '',
    areas: [],
    targetPieces: {},
  });

  const toast = useToast();
  const fileInputRef = useRef(null);

  /**
   * Resuelve el proyecto de una fila de Excel por id exacto o por nombre (flexible)
   * @param {string} rawValue - Valor crudo de la celda de proyecto
   * @returns {Object|null} El proyecto encontrado en proyectos, o null
   */
  const resolveProject = (rawValue) => {
    const normalized = normalizeText(rawValue);
    return (
      proyectos.find((p) => normalizeText(p.id) === normalized) ||
      proyectos.find((p) => normalizeText(p.name) === normalized) ||
      null
    );
  };

  // ============================================
  // HANDLERS
  // ============================================

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Lee un Excel de juegos e importa sus filas configurando metas de piezas por área
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
      let corrected = 0;

      rows.forEach((row) => {
        const name = getCellValue(row, /nombre|name/i);
        const project = resolveProject(getCellValue(row, /proyecto|project/i));
        const areasRaw = getCellValue(row, /areas|áreas|area|área/i);
        const areas = areasRaw
          .split(/[,;]/)
          .map((v) => resolveAreaId(v))
          .filter(Boolean);

        if (!name || !project || areas.length === 0) {
          skipped += 1;
          return;
        }

        // Herrería requiere Corte Láser
        if (areas.includes('herreria') && !areas.includes('corte-laser')) {
          areas.push('corte-laser');
          corrected += 1;
        }

        // Construir metas de piezas por área de Excel o por defecto
        const targetPieces = {};
        areas.forEach((areaId) => {
          const areaNameNormalized = normalizeText(AREAS_MAP[areaId]?.name || '');
          const qtyKey = Object.keys(row).find((k) => {
            const normK = normalizeText(k);
            return (normK.includes('pieza') || normK.includes('cant')) && normK.includes(areaNameNormalized);
          });
          const val = qtyKey ? Number(row[qtyKey]) : 10;
          targetPieces[areaId] = Number.isFinite(val) && val > 0 ? val : 10;
        });

        addGame({
          name,
          projectId: project.id,
          areas,
          targetPieces,
        });

        added += 1;
      });

      if (added > 0) {
        toast.success(`✅ ${added} juego${added === 1 ? '' : 's'} importado${added === 1 ? '' : 's'} correctamente.`);
      }
      if (corrected > 0) {
        toast.info(`🔗 Se agregó Corte Láser automáticamente en ${corrected} juego${corrected === 1 ? '' : 's'} que requerían Herrería.`);
      }
      if (skipped > 0) {
        toast.warning(`⚠️ ${skipped} fila${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'} (falta nombre, proyecto no reconocido o sin áreas válidas).`);
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

  const handleProjectFilterChange = (e) => {
    setProjectFilter(e.target.value);
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
    if (proyectos.length > 0) {
      setNewGame((prev) => ({
        ...prev,
        projectId: proyectos[0].id,
      }));
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNewGame({
      name: '',
      projectId: '',
      areas: [],
      targetPieces: {},
    });
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setNewGame((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  /**
   * Alterna la selección de un área en el formulario de creación
   */
  const handleAreaToggle = (areaId) => {
    const isSelected = newGame.areas.includes(areaId);

    // Deseleccionar Corte Láser mientras Herrería sigue seleccionada: quita ambas
    if (isSelected && areaId === 'corte-laser' && newGame.areas.includes('herreria')) {
      toast.info('Se quitó también Herrería, ya que requiere que Corte Láser haya cortado primero.');
      setNewGame((prev) => {
        const nextTargets = { ...prev.targetPieces };
        delete nextTargets['corte-laser'];
        delete nextTargets['herreria'];
        return {
          ...prev,
          areas: prev.areas.filter((id) => id !== 'corte-laser' && id !== 'herreria'),
          targetPieces: nextTargets,
        };
      });
      return;
    }

    // Seleccionar Herrería sin tener Corte Láser: agrega ambas
    if (!isSelected && areaId === 'herreria' && !newGame.areas.includes('corte-laser')) {
      toast.info('Se agregó también Corte Láser, ya que Herrería requiere que corte primero.');
      setNewGame((prev) => {
        const nextTargets = { ...prev.targetPieces };
        nextTargets['corte-laser'] = 10;
        nextTargets['herreria'] = 10;
        return {
          ...prev,
          areas: [...prev.areas, 'corte-laser', 'herreria'],
          targetPieces: nextTargets,
        };
      });
      return;
    }

    setNewGame((prev) => {
      const nextAreas = isSelected ? prev.areas.filter((id) => id !== areaId) : [...prev.areas, areaId];
      const nextTargets = { ...prev.targetPieces };
      
      if (isSelected) {
        delete nextTargets[areaId];
      } else {
        nextTargets[areaId] = 10; // Meta por defecto de 10 piezas
      }

      return {
        ...prev,
        areas: nextAreas,
        targetPieces: nextTargets,
      };
    });
  };

  const handleCreateGame = (e) => {
    e.preventDefault();
    if (!newGame.name || !newGame.projectId || newGame.areas.length === 0) {
      toast.danger('Por favor ingresa un nombre para el juego, selecciona un proyecto y define al menos un área.');
      return;
    }

    addGame({
      name: newGame.name,
      projectId: newGame.projectId,
      areas: newGame.areas,
      targetPieces: newGame.targetPieces,
    });

    toast.success('🎮 Juego registrado con éxito y metas de piezas distribuidas.');
    handleCloseModal();
  };

  const handleDeleteGame = (gameId, gameName) => {
    setDeleteConfirmation({
      isOpen: true,
      gameId,
      gameName,
    });
  };

  const handleConfirmDeleteGame = async () => {
    const { gameId, gameName } = deleteConfirmation;
    if (!gameId) return;

    const res = await deleteGame(gameId);
    if (res.ok) {
      toast.success(`🗑️ Juego "${gameName}" eliminado.`);
    } else {
      toast.danger(res.error || 'Error al eliminar el juego.');
    }
    setDeleteConfirmation({ isOpen: false, gameId: null, gameName: '' });
  };

  // ============================================
  // FILTRADO
  // ============================================
  const filteredJuegos = juegos.filter((juego) => {
    const matchesSearch = juego.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesProject = projectFilter === 'todos' || juego.projectId === projectFilter;

    let matchesStatus = false;
    if (statusFilter === 'todos' || (statusFilter === 'activos' && searchTerm !== '')) {
      matchesStatus = true;
    } else if (statusFilter === 'activos') {
      matchesStatus = juego.status !== 'completado';
    } else {
      matchesStatus = juego.status === statusFilter;
    }

    return matchesSearch && matchesProject && matchesStatus;
  });

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

  return (
    <div className={styles.container}>
      {/* Cabecera */}
      <PageHeader
        title="Líneas de Juegos"
        subtitle="Diseña y monitorea la ruta de manufactura de cada juego y sus piezas por área."
        shape="mancha"
        accentColor="var(--color-golden-yellow)"
      >
        {!isReadOnly && (
          <>
            <Button variant="secondary" size="md" onClick={handleUploadClick}>
              📥 Cargar Excel
            </Button>
            <Button variant="primary" size="md" onClick={handleOpenModal}>
              🎮 Registrar Nuevo Juego
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
          <label className={styles.searchLabel} htmlFor="search-input">
            Buscar por Nombre
          </label>
          <input
            id="search-input"
            type="text"
            className={styles.searchField}
            placeholder="Buscar juego..."
            value={searchTerm}
            onChange={handleSearchChange}
          />
        </div>
        <div className={styles.selectWrapper}>
          <Select
            label="Filtrar Proyecto"
            value={projectFilter}
            onChange={handleProjectFilterChange}
            options={[
              { value: 'todos', label: 'Todos los Proyectos' },
              ...(proyectos.filter((p) => p.status !== 'completado').length > 0
                ? [
                    { value: 'divider-active', label: '── ACTIVOS ──', disabled: true },
                    ...proyectos
                      .filter((p) => p.status !== 'completado')
                      .map((p) => ({ value: p.id, label: `   ${p.name}` })),
                  ]
                : []),
              ...(proyectos.filter((p) => p.status === 'completado').length > 0
                ? [
                    { value: 'divider-completed', label: '── COMPLETADOS ──', disabled: true },
                    ...proyectos
                      .filter((p) => p.status === 'completado')
                      .map((p) => ({ value: p.id, label: `   ${p.name}` })),
                  ]
                : []),
            ]}
          />
        </div>
        <div className={styles.selectWrapper}>
          <Select
            label="Filtrar Estado"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'activos', label: 'Juegos Activos' },
              { value: 'completado', label: 'Juegos Finalizados' },
              { value: 'todos', label: 'Todos los Juegos' },
            ]}
          />
        </div>
      </div>

      {/* LISTADO DE JUEGOS */}
      {filteredJuegos.length > 0 ? (
        <motion.div
          className={styles.grid}
          variants={listVariants}
          initial="initial"
          animate="animate"
        >
          {filteredJuegos.map((juego) => (
            <motion.div key={juego.id} variants={cardVariants}>
              <Card variant="default" className={styles.gameCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={styles.gameId}>{juego.id}</span>
                    <h3 className={styles.gameTitle}>{juego.name}</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Badge variant={STATUS_BADGE_VARIANT[juego.status] || 'neutral'}>
                      {juego.status.toUpperCase()}
                    </Badge>
                    {!isReadOnly && juego.progress === 0 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteGame(juego.id, juego.name)}
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
                        title="Eliminar Juego"
                        onMouseEnter={(el) => (el.currentTarget.style.backgroundColor = 'rgba(255, 51, 0, 0.1)')}
                        onMouseLeave={(el) => (el.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
                <p className={styles.projectName}>
                  <strong>Proyecto:</strong> {juego.projectName}
                </p>

                {/* ÁREAS DE MANUFACTURA */}
                <div className={styles.routeContainer}>
                  <h4 className={styles.routeLabel}>Avance de Piezas por Área</h4>
                  <div className={styles.areaChipsGrid}>
                    {dynamicAreas
                      .filter((area) => juego.areas.includes(area.id) && area.id !== 'producto-terminado')
                      .map((areaInfo) => {
                        const areaId = areaInfo.id;
                        const areaStatus = juego.areaStatus?.[areaId] || 'pendiente';
                        const target = juego.targetPieces?.[areaId] || 10;
                        const produced = juego.producedPieces?.[areaId] || 0;
                        const needsCorteLaser = areaId === 'herreria';

                        return (
                          <div
                            key={areaId}
                            className={`${styles.areaChip} ${styles[`chip-${areaStatus}`]}`}
                            style={{ borderLeftColor: areaInfo.color }}
                            title={
                              needsCorteLaser
                                ? `${areaInfo.name} (requiere Corte Láser primero)`
                                : areaInfo.name
                            }
                          >
                            <span className={styles.chipIcon}>
                              {areaStatus === 'completado' ? '✓' : areaInfo.icon}
                            </span>
                            <div className={styles.chipTextBlock}>
                              <span className={styles.chipName}>
                                {areaInfo.name}
                                {needsCorteLaser && <span className={styles.chipLink}> 🔗</span>}
                              </span>
                              <span className={styles.chipStatus}>
                                {AREA_STATUS_LABEL[areaStatus]} ({produced}/{target} pzas)
                              </span>
                            </div>
                          </div>
                        );
                      })}

                  <span className={styles.chipArrow}>➜</span>

                  {/* Etapa final: Producto Terminado */}
                  {(() => {
                    const finalArea = AREAS_MAP['producto-terminado'];
                    if (!finalArea) return null;
                    const finalStatus = juego.areaStatus?.['producto-terminado'] || 'pendiente';
                    const finalProduced = juego.producedPieces?.['producto-terminado'] || 0;
                    const finalTarget = juego.targetPieces?.['producto-terminado'] || 1;
                    return (
                      <div
                        className={`${styles.areaChip} ${styles.chipFinal} ${styles[`chip-${finalStatus}`]}`}
                        style={{ borderLeftColor: finalArea.color }}
                      >
                        <span className={styles.chipIcon}>
                          {finalStatus === 'completado' ? '✓' : finalArea.icon}
                        </span>
                        <div className={styles.chipTextBlock}>
                          <span className={styles.chipName}>{finalArea.name}</span>
                          <span className={styles.chipStatus}>
                            {AREA_STATUS_LABEL[finalStatus]} ({finalProduced}/{finalTarget} mod)
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Progreso */}
              <div className={styles.progressSection}>
                <div className={styles.progressText}>
                  <span>Avance total del juego</span>
                  <strong>{juego.progress}%</strong>
                </div>
                <div className={styles.progressBg}>
                  <div
                    className={styles.progressBar}
                    style={{ width: `${juego.progress}%` }}
                  />
                </div>
              </div>

              {/* Piezas de proveedores externos (fibra de vidrio, letreros iluminados, etc.), solo lectura */}
              {juego.externalOrders && juego.externalOrders.length > 0 && (() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const delayed = juego.externalOrders.filter((o) => o.status === 'pendiente' && o.expectedDeliveryDate < todayStr).length;
                const pending = juego.externalOrders.filter((o) => o.status === 'pendiente').length;
                const received = juego.externalOrders.filter((o) => o.status === 'recibido').length;
                return (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--color-gray-100)' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-gray-600)' }}>🛠️ Piezas Externas:</span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {delayed > 0 && <Badge variant="danger">{delayed} retrasada(s)</Badge>}
                      {pending - delayed > 0 && <Badge variant="warning">{pending - delayed} pendiente(s)</Badge>}
                      {received > 0 && <Badge variant="success">{received} recibida(s)</Badge>}
                    </div>
                  </div>
                );
              })()}
            </Card>
          </motion.div>
        ))}
        </motion.div>
      ) : (
        <EmptyState message="No se encontraron juegos activos." shape="mancha" color="var(--color-golden-yellow)" />
      )}

      {/* MODAL REGISTRAR JUEGO */}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title="Registrar Nuevo Juego">
        <form onSubmit={handleCreateGame} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre del Juego / Módulo</label>
            <input
              type="text"
              name="name"
              className={styles.textInput}
              placeholder="Ej: Resbaladilla Doble"
              value={newGame.name}
              onChange={handleFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <Select
              label="Proyecto Vinculado"
              name="projectId"
              value={newGame.projectId}
              onChange={handleFormChange}
              required
              options={[
                ...(proyectos.filter((p) => p.status !== 'completado').length > 0
                  ? [
                      { value: 'divider-active', label: '── PROYECTOS ACTIVOS ──', disabled: true },
                      ...proyectos
                        .filter((p) => p.status !== 'completado')
                        .map((p) => ({ value: p.id, label: `   [${p.id}] ${p.name}` })),
                    ]
                  : []),
                ...(proyectos.filter((p) => p.status === 'completado').length > 0
                  ? [
                      { value: 'divider-completed', label: '── PROYECTOS COMPLETADOS ──', disabled: true },
                      ...proyectos
                        .filter((p) => p.status === 'completado')
                        .map((p) => ({ value: p.id, label: `   [${p.id}] ${p.name}` })),
                    ]
                  : []),
              ]}
            />
          </div>

          {/* Selector de Áreas Requeridas */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              Áreas Requeridas (sin orden; Herrería requiere Corte Láser)
            </label>
            <div className={styles.routeSelectorGrid}>
              {dynamicAreas
                .filter((area) => area.id !== 'producto-terminado')
                .map((area) => {
                  const areaId = area.id;
                  const isSelected = newGame.areas.includes(areaId);

                  return (
                    <button
                      key={areaId}
                      type="button"
                      className={`${styles.selectorCard} ${isSelected ? styles.selectorCardActive : ''}`}
                      onClick={() => handleAreaToggle(areaId)}
                      style={{
                        borderLeftColor: area.color,
                      }}
                    >
                      <span className={styles.selectorIcon}>{area.icon}</span>
                      <div className={styles.selectorContent}>
                        <span className={styles.selectorName}>
                          {area.name}
                          {areaId === 'herreria' && <span className={styles.selectorHint}> (requiere Corte Láser)</span>}
                        </span>
                        {isSelected && <span className={styles.selectorBadge}>✓ Seleccionada</span>}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Configuración de Piezas por Área Seleccionada */}
          {newGame.areas.length > 0 && (
            <div className={styles.targetPiecesSection}>
              <label className={styles.label}>Establecer Cantidad de Piezas por Área</label>
              <div className={styles.targetPiecesInputsGrid}>
                {newGame.areas.map((areaId) => {
                  const area = AREAS_MAP[areaId];
                  return (
                    <div key={areaId} className={styles.targetPiecesInputGroup}>
                      <span className={styles.targetPiecesLabel}>
                        {area.icon} {area.name}
                      </span>
                      <input
                        type="number"
                        min="1"
                        required
                        className={styles.numberInput}
                        value={newGame.targetPieces[areaId] || ''}
                        placeholder="10"
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value));
                          setNewGame((prev) => ({
                            ...prev,
                            targetPieces: {
                              ...prev.targetPieces,
                              [areaId]: val,
                            },
                          }));
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {newGame.areas.length > 0 && (
            <div className={styles.routePreview}>
              <strong>Áreas Seleccionadas:</strong>{' '}
              {newGame.areas.map((id) => AREAS_MAP[id]?.name || id).join(', ')}
              {' ➜ Producto Terminado'}
            </div>
          )}

          <div className={styles.formActions}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              Crear Juego
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE JUEGO */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, gameId: null, gameName: '' })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar el juego <strong>{deleteConfirmation.gameName}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y eliminará de forma permanente el juego e interrumpirá cualquier registro que no tuviera avance.
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeleteConfirmation({ isOpen: false, gameId: null, gameName: '' })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleConfirmDeleteGame}
              >
                Eliminar Juego
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default JuegosPage;
