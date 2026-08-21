/**
 * @file EditorVisualPage.jsx
 * @description Editor Visual de Asignaciones de Dicrejart — un lienzo tipo grafo de nodos
 * para crear y relacionar Proyectos, Juegos, Actividades, Áreas y Colaboradores, conectado
 * a los datos reales de la aplicación (no es una copia ni un sistema paralelo).
 * Conectado en tiempo real con Cloud Firestore por proyecto.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires firebase/firestore
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import useAuth from '../../hooks/useAuth';
import { AREA_SEQUENCE_DEPENDENCIES, isAreaBlockedBySequence } from '../../context/ProduccionContext';
import useAreas from '../../hooks/useAreas';
import { NON_PRODUCTION_AREAS } from '../../data/nonProductionAreasConfig';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import styles from './EditorVisualPage.module.css';

/** Dimensiones del Gran Espacio de Trabajo CAD (Inventor / SolidWorks style) */
const WORKSPACE_WIDTH = 6000;
const WORKSPACE_HEIGHT = 6000;
const GRID_SIZE = 25;
const GRID_MAJOR_SIZE = 125;

/** Ancho/alto aproximado de un nodo, usado para calcular dónde dibujar cada línea */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 80;

/** Límites de zoom del lienzo CAD (20%–250%), en pasos de 10 puntos porcentuales */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** Tipos de nodo disponibles, con su color de marca */
const NODE_TYPES = {
  bloque: { icon: '📦', label: 'Nodo de Trabajo', colorVar: 'var(--color-primary)', allowCreate: true },
  proyecto: { icon: '🗂️', label: 'Proyecto', colorVar: 'var(--color-secondary)', allowCreate: true },
  juego: { icon: '🎮', label: 'Juego', colorVar: 'var(--color-tiffany-blue)', allowCreate: true },
  area: { icon: '🏭', label: 'Área', colorVar: 'var(--color-princeton-orange)', allowCreate: false },
  actividad: { icon: '📌', label: 'Actividad', colorVar: 'var(--color-golden-yellow)', allowCreate: true },
  colaborador: { icon: '👷', label: 'Colaborador', colorVar: 'var(--color-purple-x11)', allowCreate: false },
};

// ALL_BLOCK_AREAS is computed dynamically inside components

const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const PROJECT_STATUS_OPTIONS = [
  { value: 'diseno', label: 'En Diseño' },
  { value: 'progreso', label: 'En Progreso' },
  { value: 'pausado', label: 'Pausado' },
];

let nodeSeq = Date.now();
const nextNodeId = () => {
  nodeSeq += 1;
  return `n-${nodeSeq}`;
};

let edgeSeq = Date.now();
const nextEdgeId = () => {
  edgeSeq += 1;
  return `e-${edgeSeq}`;
};

/**
 * Genera el trazo de cable maleable y curvo estilo CAD/Física con soporte de curvatura natural
 */
const bezierPath = (p1, p2) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);

  // Curvatura suave y maleable adaptativa según distancia y orientación
  const curveFactor = Math.max(65, Math.min(Math.abs(dx) * 0.55 + 30, 260));
  // Efecto catenario físico (ligera comba de cable colgante)
  const gravitySag = Math.min(Math.max(dist * 0.05, 0), 32);

  const cp1x = p1.x + curveFactor;
  const cp1y = p1.y + (dy >= 0 ? gravitySag : -gravitySag * 0.4);
  const cp2x = p2.x - curveFactor;
  const cp2y = p2.y + (dy <= 0 ? gravitySag : -gravitySag * 0.4);

  return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
};

/**
 * Componente EditorVisualPage - Editor visual tipo grafo para crear/relacionar entidades
 * @component
 * @returns {ReactElement}
 */
const EditorVisualPage = ({ standalone = false }) => {
  const { proyectos, juegos, addProject, addGame } = useProduccion();
  const { actividades, addActividad, updateActividad, deleteActividad } = useActividades();
  const { operarios, assignToArea } = useOperarios();
  const { areas: dynamicAreas } = useAreas();
  const allBlockAreas = useMemo(() => [...dynamicAreas, ...NON_PRODUCTION_AREAS], [dynamicAreas]);
  const { user } = useAuth();
  const toast = useToast();

  // ============================================
  // PROYECTO ACTIVO (Lienzo por Proyecto)
  // ============================================
  const [proyectoActivoId, setProyectoActivoId] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('proyectoId') || '';
    }
    return '';
  });

  // Refleja el proyecto activo en la URL para que la selección sobreviva a un
  // refresco de página (sin esto, recargar perdía de vista qué lienzo se estaba viendo)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (proyectoActivoId) {
      url.searchParams.set('proyectoId', proyectoActivoId);
    } else {
      url.searchParams.delete('proyectoId');
    }
    window.history.replaceState({}, '', url);
  }, [proyectoActivoId]);

  // Solo los administradores pueden modificar y guardar diagramas
  const canEditDiagram = user?.roleType === 'admin';

  // ============================================
  // ESTADO DEL GRAFO
  // ============================================
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [worldOffset, setWorldOffset] = useState({ x: 40, y: 30 });
  const [howtoOpen, setHowtoOpen] = useState(false);
  // Qué Bloques tienen su lista de actividades desplegada — solo local (no se guarda en
  // Firestore), cada quien decide qué tiene abierto en su propia pantalla.
  const [expandedBlocks, setExpandedBlocks] = useState(() => new Set());
  const toggleBlockExpanded = (nodeId) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };
  // Confirmación antes de borrar un Bloque que ya tiene actividades reales adentro
  const [deleteBlockConfirm, setDeleteBlockConfirm] = useState({ isOpen: false, nodeId: null });

  const canvasWrapRef = useRef(null);
  const worldRef = useRef(null);
  const dragStateRef = useRef(null);
  const connectStateRef = useRef(null);
  const panStateRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [previewWire, setPreviewWire] = useState(null);

  // ============================================
  // ZOOM Y NAVEGACIÓN CAD DEL LIENZO
  // ============================================
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const worldOffsetRef = useRef(worldOffset);
  worldOffsetRef.current = worldOffset;
  
  // Soporte CAD: Tecla Espacio para Panning, Snap a Cuadrícula y Coordenadas
  const isSpacePressedRef = useRef(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [cursorCoords, setCursorCoords] = useState({ x: 0, y: 0 });
  const [showMinimap, setShowMinimap] = useState(true);

  const [isExporting, setIsExporting] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !proyectoActivoId) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'lienzos', proyectoActivoId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
        if (data.worldOffset) {
          setWorldOffset(data.worldOffset);
        }
      } else {
        // Inicializar el lienzo vacío en Firestore
        setDoc(doc(db, 'lienzos', proyectoActivoId), {
          nodes: [],
          edges: [],
          worldOffset: { x: 40, y: 30 },
        });
      }
    });

    return unsubscribe;
  }, [proyectoActivoId]);

  /**
   * Guarda de forma transparente el estado actual del lienzo en Firestore
   */
  const saveToFirestore = useCallback(async (newNodes, newEdges, newOffset) => {
    if (!db || !proyectoActivoId || !canEditDiagram) return;
    try {
      await setDoc(doc(db, 'lienzos', proyectoActivoId), {
        nodes: newNodes,
        edges: newEdges,
        worldOffset: newOffset || worldOffset,
      });
    } catch (e) {
      console.error('Error al guardar lienzo en Firestore:', e);
    }
  }, [proyectoActivoId, worldOffset, canEditDiagram]);

  const findNode = useCallback((id) => nodes.find((n) => n.id === id) || null, [nodes]);

  /** Devuelve el registro real (Proyecto/Juego/Actividad/Colaborador/Área) que representa un nodo, si ya está vinculado */
  const getLinkedEntity = useCallback(
    (node) => {
      if (!node || node.draft) return null;
      if (node.type === 'proyecto') return proyectos.find((p) => p.id === node.refId);
      if (node.type === 'juego') return juegos.find((j) => j.id === node.refId);
      if (node.type === 'actividad') return actividades.find((a) => a.id === node.refId);
      if (node.type === 'colaborador') return operarios.find((o) => o.id === node.refId);
      if (node.type === 'area') return dynamicAreas.find((a) => a.id === node.refId);
      return null;
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

  const nodeTitle = useCallback(
    (node) => {
      // Un Bloque no representa un único registro real (Firestore) sino un grupo de
      // actividades, así que no pasa por getLinkedEntity — su "entidad" es su propio nombre.
      if (node.type === 'bloque') return node.blockName || 'Bloque sin nombre';
      if (node.draft) return node.draftFields.name || node.draftFields.title || 'Sin nombre';
      const entity = getLinkedEntity(node);
      if (!entity) return '(no encontrado)';
      return entity.name || entity.title || 'Sin nombre';
    },
    [getLinkedEntity]
  );

  /** Áreas de un Juego real que están bloqueadas por secuencia (ej. Herrería esperando Corte Láser) */
  const getBlockedAreas = useCallback(
    (gameEntity) => (gameEntity?.areas || []).filter((areaId) => isAreaBlockedBySequence(gameEntity, areaId)),
    []
  );

  const nodeSummary = useCallback(
    (node) => {
      if (node.type === 'bloque') {
        const areaName = allBlockAreas.find((a) => a.id === node.areaId)?.name || node.areaId || 'Sin área';
        const projName = proyectos.find((p) => p.id === node.projectId)?.name || null;
        const gameName = juegos.find((j) => j.id === node.gameId)?.name || null;
        const count = node.activityIds?.length || 0;
        const colabDirect = operarios.find((o) => o.id === node.operarioId)?.name;
        const colabEdge = edges.find(
          (e) =>
            (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
            (e.to === node.id && findNode(e.from)?.type === 'colaborador')
        );
        const colabConnected = colabEdge
          ? nodeTitle(findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to))
          : null;
        const colabName = colabDirect || colabConnected;

        const parts = [];
        if (projName) parts.push(`🗂️ ${projName}`);
        if (gameName) parts.push(`🎮 ${gameName}`);
        parts.push(`🏭 ${areaName}`);
        parts.push(`📌 ${count} act.`);
        if (colabName) parts.push(`👷 ${colabName}`);
        return parts.join(' · ');
      }
      if (node.draft) return '🆕 Aún no guardado en el sistema';
      const entity = getLinkedEntity(node);
      if (!entity) return 'Registro no encontrado';
      if (node.type === 'proyecto') return `${entity.client || 'Sin cliente'} · ${entity.progress ?? 0}%`;
      if (node.type === 'juego') {
        const blocked = getBlockedAreas(entity);
        const blockedSuffix = blocked.length > 0
          ? ` · 🔒 ${blocked.map((a) => dynamicAreas.find((c) => c.id === a)?.name || a).join(', ')} bloqueada(s)`
          : '';
        const rejected = (entity.areas || []).filter((a) => entity.qualityReview?.[a]?.status === 'rechazado');
        const rejectedSuffix = rejected.length > 0
          ? ` · ❌ Calidad rechazó ${rejected.map((a) => dynamicAreas.find((c) => c.id === a)?.name || a).join(', ')}`
          : '';
        return `${entity.projectName || ''} · ${entity.progress ?? 0}%${blockedSuffix}${rejectedSuffix}`;
      }
      if (node.type === 'actividad') {
        const responsable = operarios.find((o) => o.id === entity.operarioId)?.name;
        return `Área: ${dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId} · ${entity.status}${responsable ? ` · 👷 ${responsable}` : ''}`;
      }
      if (node.type === 'colaborador') return `Área actual: ${dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}`;
      if (node.type === 'area') return 'Área de manufactura';
      return '';
    },
    [getLinkedEntity, getBlockedAreas, proyectos, juegos, operarios, dynamicAreas, allBlockAreas, edges, findNode, nodeTitle]
  );
  // POSICIONES DE PUERTOS Y LÍNEAS
  // ============================================
  const portPos = useCallback((node, side) => ({
    x: node.x + (side === 'out' ? NODE_WIDTH : 0),
    y: node.y + NODE_HEIGHT / 2,
  }), []);

  const worldBounds = useMemo(() => {
    let maxX = WORKSPACE_WIDTH;
    let maxY = WORKSPACE_HEIGHT;
    nodes.forEach((n) => {
      maxX = Math.max(maxX, n.x + NODE_WIDTH + 300);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT + 300);
    });
    return { width: maxX, height: maxY };
  }, [nodes]);

  // ============================================
  // ARRASTRAR NODOS
  // ============================================
  const handleNodeMouseDown = (e, nodeId) => {
    // Si se presiona el botón central o la tecla espacio, no arrastra el nodo, sino el lienzo
    if (e.button === 1 || isSpacePressedRef.current) return;
    if (!canEditDiagram) return;
    if (
      e.target.closest('[data-role="port"]') ||
      e.target.closest('[data-role="close"]') ||
      e.target.closest('[data-role="block-panel"]')
    ) return;
    const node = findNode(nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    dragStateRef.current = {
      id: nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
    e.preventDefault();
  };

  /** Quita un nodo del lienzo (y sus cables) — ya decidido, sin más preguntas */
  const performDeleteNode = (nodeId) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((ed) => ed.from !== nodeId && ed.to !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    saveToFirestore(nextNodes, nextEdges);
  };

  const handleCloseNode = (nodeId) => {
    if (!canEditDiagram) return;
    const node = findNode(nodeId);
    // Un Bloque con actividades reales adentro no se borra directo: hay que confirmar
    // primero si también se eliminan esas actividades del sistema (ver handleConfirmDeleteBlockWithActivities).
    if (node?.type === 'bloque' && (node.activityIds || []).length > 0) {
      setDeleteBlockConfirm({ isOpen: true, nodeId });
      return;
    }
    performDeleteNode(nodeId);
  };

  const closeDeleteBlockConfirm = () => setDeleteBlockConfirm({ isOpen: false, nodeId: null });

  /**
   * Confirma el borrado de un Bloque junto con TODAS sus actividades reales. Es todo o
   * nada: si alguna actividad ya tiene avance (no está "pendiente") y no se puede borrar,
   * se aborta por completo — el bloque tampoco se elimina.
   */
  const handleConfirmDeleteBlockWithActivities = async () => {
    const node = findNode(deleteBlockConfirm.nodeId);
    if (!node) {
      closeDeleteBlockConfirm();
      return;
    }

    const linkedActivities = (node.activityIds || [])
      .map((id) => actividades.find((a) => a.id === id))
      .filter(Boolean);

    const blocked = linkedActivities.find((a) => a.status !== 'pendiente');
    if (blocked) {
      toast.danger(`No se puede eliminar: "${blocked.title}" ya tiene avance (${blocked.status}). Cámbiala a pendiente o elimínala manualmente desde Actividades antes de borrar el bloque.`);
      return;
    }

    for (const activity of linkedActivities) {
      // eslint-disable-next-line no-await-in-loop
      const res = await deleteActividad(activity.id);
      if (!res.ok) {
        toast.danger(`No se pudo eliminar "${activity.title}": ${res.error}`);
        return;
      }
    }

    performDeleteNode(node.id);
    toast.success('🗑️ Bloque y sus actividades eliminados.');
    closeDeleteBlockConfirm();
  };

  const handlePortMouseDown = (e, nodeId, side) => {
    if (!canEditDiagram) return;
    e.preventDefault();
    e.stopPropagation();
    connectStateRef.current = { fromId: nodeId, side };
    setPreviewWire({ x1: 0, y1: 0, x2: 0, y2: 0 });
  };

  const localPoint = (e) => {
    const rect = canvasWrapRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - worldOffsetRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top - worldOffsetRef.current.y) / zoomRef.current,
    };
  };

  // ============================================
  // PANNING DEL LIENZO (ESTILO INVENTOR / SOLIDWORKS)
  // Permite arrastre con botón central (rueda), botón derecho, clic izquierdo en fondo o Espacio
  // ============================================
  const handleCanvasMouseDown = (e) => {
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isBackgroundLeft = e.button === 0 && (
      e.target === canvasWrapRef.current ||
      e.target.dataset.canvasBg ||
      e.target === worldRef.current ||
      isSpacePressedRef.current
    );

    if (isMiddle || isRight || isBackgroundLeft) {
      e.preventDefault();
      panStateRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startOffset: worldOffsetRef.current,
      };
      setIsPanning(true);
    }
  };

  const handleWindowMouseMove = (e) => {
    if (canvasWrapRef.current) {
      const rect = canvasWrapRef.current.getBoundingClientRect();
      const curX = Math.round((e.clientX - rect.left - worldOffsetRef.current.x) / zoomRef.current);
      const curY = Math.round((e.clientY - rect.top - worldOffsetRef.current.y) / zoomRef.current);
      setCursorCoords({ x: curX, y: curY });
    }

    if (dragStateRef.current) {
      const { id, startMouseX, startMouseY, startNodeX, startNodeY } = dragStateRef.current;
      const dx = (e.clientX - startMouseX) / zoomRef.current;
      const dy = (e.clientY - startMouseY) / zoomRef.current;
      const rawX = startNodeX + dx;
      const rawY = startNodeY + dy;
      const finalX = snapToGrid ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : rawX;
      const finalY = snapToGrid ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : rawY;
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? {
          ...n,
          x: Math.max(0, Math.min(WORKSPACE_WIDTH - NODE_WIDTH, finalX)),
          y: Math.max(0, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT, finalY)),
        } : n))
      );
    } else if (connectStateRef.current) {
      const { fromId, side } = connectStateRef.current;
      const fromNode = findNode(fromId);
      if (!fromNode) return;
      const start = portPos(fromNode, side === 'out' ? 'out' : 'in');
      const end = localPoint(e);
      setPreviewWire(
        side === 'out'
          ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
          : { x1: end.x, y1: end.y, x2: start.x, y2: start.y }
      );
    } else if (panStateRef.current) {
      const { startMouseX, startMouseY, startOffset } = panStateRef.current;
      setWorldOffset({
        x: startOffset.x + (e.clientX - startMouseX),
        y: startOffset.y + (e.clientY - startMouseY),
      });
    }
  };

  const handleWindowMouseUp = (e) => {
    let dragNodeId = null;
    if (dragStateRef.current) {
      dragNodeId = dragStateRef.current.id;
      dragStateRef.current = null;
    }

    if (dragNodeId) {
      setNodes((latestNodes) => {
        saveToFirestore(latestNodes, edges);
        return latestNodes;
      });
    }

    if (connectStateRef.current) {
      const portEl = e.target.closest('[data-role="port"]');
      if (portEl) {
        const targetId = portEl.dataset.nodeId;
        const targetSide = portEl.dataset.side;
        const { fromId, side } = connectStateRef.current;
        if (targetId !== fromId && targetSide !== side) {
          const from = side === 'out' ? fromId : targetId;
          const to = side === 'out' ? targetId : fromId;
          let didCreateEdge = false;
          setEdges((latestEdges) => {
            const alreadyExists = latestEdges.some((ed) => ed.from === from && ed.to === to);
            if (!alreadyExists) {
              const nextEdges = [...latestEdges, { id: nextEdgeId(), from, to }];
              saveToFirestore(nodes, nextEdges);
              didCreateEdge = true;
              return nextEdges;
            }
            return latestEdges;
          });

          // Si el cable nuevo conecta un Bloque con un Colaborador, se asignan de
          // inmediato las actividades que el bloque ya tenía (no hace falta acordarse
          // de dar clic aparte en "Reasignar todas") — conectar el cable ya ES la
          // acción de asignar, sin importar el orden en que se hicieron las cosas.
          if (didCreateEdge) {
            const fromNode = findNode(from);
            const toNode = findNode(to);
            const blockNode = fromNode?.type === 'bloque' ? fromNode : toNode?.type === 'bloque' ? toNode : null;
            const colabNode = fromNode?.type === 'colaborador' ? fromNode : toNode?.type === 'colaborador' ? toNode : null;
            if (blockNode && colabNode && (blockNode.activityIds || []).length > 0) {
              handleReassignBlockActivities(blockNode, colabNode);
            }
          }
        }
      }
      connectStateRef.current = null;
      setPreviewWire(null);
    }

    if (panStateRef.current) {
      panStateRef.current = null;
      setIsPanning(false);
      setWorldOffset((latestOffset) => {
        saveToFirestore(nodes, edges, latestOffset);
        return latestOffset;
      });
    }
  };

  /**
   * Cambia el zoom manteniendo fijo el punto del lienzo que está bajo (cursorX, cursorY)
   * en coordenadas de pantalla — igual que Figma/Inventor/SolidWorks.
   */
  const zoomAtPoint = (deltaZoom, cursorX, cursorY) => {
    const prevZoom = zoomRef.current;
    const nextZoom = clampZoom(prevZoom + deltaZoom);
    if (nextZoom === prevZoom) return;
    const prevOffset = worldOffsetRef.current;
    const nextOffset = {
      x: cursorX - ((cursorX - prevOffset.x) / prevZoom) * nextZoom,
      y: cursorY - ((cursorY - prevOffset.y) / prevZoom) * nextZoom,
    };
    setZoom(nextZoom);
    setWorldOffset(nextOffset);
  };

  const handleZoomButton = (delta) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(delta, rect.width / 2, rect.height / 2);
  };

  const handleResetView = () => {
    setZoom(1);
    setWorldOffset({ x: 80, y: 60 });
  };

  /**
   * Ajusta y centra automáticamente la cámara a todo el diagrama (Zoom to Fit / Tecla F)
   */
  const handleFitToView = useCallback(() => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) {
      setZoom(1);
      setWorldOffset({ x: 80, y: 60 });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT + (n.type === 'bloque' && expandedBlocks.has(n.id) ? 220 : 0));
    });

    const diagramWidth = Math.max(100, maxX - minX);
    const diagramHeight = Math.max(100, maxY - minY);
    const padding = 120;

    const availableWidth = Math.max(100, rect.width - padding * 2);
    const availableHeight = Math.max(100, rect.height - padding * 2);

    const fitZoom = clampZoom(Math.min(availableWidth / diagramWidth, availableHeight / diagramHeight, 1.1));

    const centerX = minX + diagramWidth / 2;
    const centerY = minY + diagramHeight / 2;

    const nextOffset = {
      x: Math.round(rect.width / 2 - centerX * fitZoom),
      y: Math.round(rect.height / 2 - centerY * fitZoom),
    };

    setZoom(fitZoom);
    setWorldOffset(nextOffset);
  }, [nodes, expandedBlocks]);

  // Zoom suave directo con la rueda del ratón (CAD standard)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAtPoint(delta, e.clientX - rect.left, e.clientY - rect.top);
    };

    const onContextMenu = (e) => {
      if (panStateRef.current) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Atajos de teclado CAD: Espacio para arrastrar el lienzo, F para centrar diagrama
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.code === 'Space' && !isInput) {
        if (!isSpacePressedRef.current) {
          isSpacePressedRef.current = true;
          setIsSpacePressed(true);
        }
        e.preventDefault();
      }
      if (e.key.toLowerCase() === 'f' && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleFitToView();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleFitToView]);

  /**
   * Reacomoda todos los nodos en la misma cuadrícula ordenada que usa spawnNode al
   * crearlos, conservando su orden de creación — una forma simple y predecible de
   * "auto-organizar" sin reinterpretar las relaciones del diagrama.
   */
  const handleAutoArrange = () => {
    if (!canEditDiagram) return;
    const nextNodes = nodes.map((n, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      return { ...n, x: 40 + column * (NODE_WIDTH + 70), y: 40 + row * (NODE_HEIGHT + 90) };
    });
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success('🧹 Nodos reorganizados en cuadrícula.');
  };

  // ============================================
  // BUSCAR Y CENTRAR UN NODO
  // ============================================
  const nodeSearchMatches = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => nodeTitle(n).toLowerCase().includes(q)).slice(0, 8);
  }, [nodeSearch, nodes, nodeTitle]);

  const handleFocusNode = (node) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nodeCenterX = node.x + NODE_WIDTH / 2;
    const nodeCenterY = node.y + NODE_HEIGHT / 2;
    setWorldOffset({
      x: rect.width / 2 - nodeCenterX * zoom,
      y: rect.height / 2 - nodeCenterY * zoom,
    });
    setSelectedNodeId(node.id);
  };

  // ============================================
  // EXPORTAR EL DIAGRAMA COMO IMAGEN
  // ============================================
  const handleExportDiagram = async () => {
    if (!worldRef.current || nodes.length === 0) {
      toast.warning('No hay nodos en el lienzo para exportar.');
      return;
    }
    setIsExporting(true);
    const prevOffset = worldOffset;
    const prevZoom = zoom;
    try {
      // Se resetea el pan/zoom a (0,0)/100% para capturar el lienzo completo sin
      // recortes ni desplazamientos, y se restaura la vista original al terminar. Se
      // esperan dos frames para asegurar que el navegador ya pintó con la transformación
      // reseteada antes de tomar la captura.
      setWorldOffset({ x: 0, y: 0 });
      setZoom(1);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Import dinámico: igual que jsPDF/xlsx en otras páginas, html2canvas solo se
      // descarga cuando realmente se exporta un diagrama.
      const { default: html2canvas } = await import('html2canvas');
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-gray-50').trim() || '#f5f5f7';
      const canvas = await html2canvas(worldRef.current, {
        backgroundColor: bgColor || null,
        width: worldBounds.width,
        height: worldBounds.height,
      });

      const projectName = proyectos.find((p) => p.id === proyectoActivoId)?.name || 'diagrama';
      const fileSafeName = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const link = document.createElement('a');
      link.download = `dicrejart-editor-visual-${fileSafeName || 'diagrama'}-${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('📥 Diagrama exportado como imagen PNG.');
    } catch (error) {
      console.error('Error al exportar el diagrama:', error);
      toast.danger('No se pudo exportar el diagrama.');
    } finally {
      setWorldOffset(prevOffset);
      setZoom(prevZoom);
      setIsExporting(false);
    }
  };

  // ============================================
  // PICKER: BUSCAR EXISTENTE O CREAR NUEVO
  // ============================================
  const [picker, setPicker] = useState({ isOpen: false, type: null, query: '' });

  const catalogFor = useCallback(
    (type) => {
      if (type === 'proyecto') return proyectos.map((p) => ({ id: p.id, label: p.name }));
      if (type === 'juego') return juegos.map((j) => ({ id: j.id, label: `${j.name} (${j.projectName})` }));
      if (type === 'actividad') return actividades.map((a) => ({ id: a.id, label: a.title }));
      if (type === 'colaborador') {
        return operarios.map((o) => {
          const areaName = dynamicAreas.find((a) => a.id === o.currentArea)?.name || o.currentArea;
          const loanTag = o.currentArea !== o.homeArea ? ' · prestado' : '';
          return { id: o.id, label: `${o.name} — ${areaName}${loanTag}` };
        });
      }
      if (type === 'area') return dynamicAreas.map((a) => ({ id: a.id, label: a.name }));
      return [];
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

  const openPicker = (type) => {
    if (!canEditDiagram) return;
    setPicker({ isOpen: true, type, query: '' });
  };
  
  const closePicker = () => setPicker({ isOpen: false, type: null, query: '' });

  const spawnNode = (type, node) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    let spawnX, spawnY;
    if (rect) {
      const centerX = (rect.width / 2 - worldOffsetRef.current.x) / zoomRef.current;
      const centerY = (rect.height / 2 - worldOffsetRef.current.y) / zoomRef.current;
      const offsetCount = (nodes.length % 6) * 30;
      spawnX = Math.max(60, Math.min(WORKSPACE_WIDTH - NODE_WIDTH - 60, centerX - NODE_WIDTH / 2 + offsetCount));
      spawnY = Math.max(60, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT - 60, centerY - NODE_HEIGHT / 2 + offsetCount));
    } else {
      const column = nodes.length % 4;
      const row = Math.floor(nodes.length / 4);
      spawnX = 60 + column * (NODE_WIDTH + 70);
      spawnY = 60 + row * (NODE_HEIGHT + 90);
    }
    if (snapToGrid) {
      spawnX = Math.round(spawnX / GRID_SIZE) * GRID_SIZE;
      spawnY = Math.round(spawnY / GRID_SIZE) * GRID_SIZE;
    }
    const created = { id: nextNodeId(), type, x: spawnX, y: spawnY, ...node };
    const nextNodes = [...nodes, created];
    setNodes(nextNodes);
    setSelectedNodeId(created.id);
    saveToFirestore(nextNodes, edges);
  };

  const handlePickExisting = (type, entityId) => {
    spawnNode(type, { draft: false, refId: entityId, draftFields: {} });
    closePicker();
  };

  const handleCreateNewDraft = (type, name) => {
    const draftDefaults = {
      proyecto: { name, client: '', status: 'diseno' },
      juego: { name, meta_piezas: '10' },
      actividad: { title: name, description: '', priority: 'media', dueDate: '' },
    }[type];
    spawnNode(type, { draft: true, refId: null, draftFields: draftDefaults });
    closePicker();
  };

  const filteredCatalog = useMemo(() => {
    if (!picker.type) return [];
    const q = picker.query.trim().toLowerCase();
    return catalogFor(picker.type).filter((c) => c.label.toLowerCase().includes(q));
  }, [picker.type, picker.query, catalogFor]);

  // ============================================
  // ASISTENTE GUIADO DE CREACIÓN DE NODOS (WIZARD)
  // ============================================
  const EMPTY_WIZARD = {
    isOpen: false,
    step: 1, // 1: Rol, 2: Proyecto, 3: Juego (si aplica), 4: Área/Responsable
    role: 'juego', // 'proyecto' | 'juego' | 'bloque'
    name: '',

    // Proyecto
    projectMode: 'existing', // 'existing' | 'new'
    projectId: '',
    newProjectName: '',
    newProjectClient: '',
    newProjectDesc: '',
    newProjectStartDate: '',
    newProjectEndDate: '',
    newProjectStatus: 'diseno',

    // Juego
    gameMode: 'existing', // 'existing' | 'new'
    gameId: '',
    newGameName: '',
    newGameAreas: ['herreria', 'corte-laser'],
    newGameTargets: { herreria: 10, 'corte-laser': 10 },

    // Área y Operario
    areaId: '',
    operarioId: '',
  };

  const [wizard, setWizard] = useState(EMPTY_WIZARD);

  const openBlockSetup = () => {
    if (!canEditDiagram) return;
    const today = getTodayLocalDateStr();
    const hasProjects = proyectos.length > 0;
    const firstProjId = proyectoActivoId || (hasProjects ? proyectos[0].id : '');

    setWizard({
      ...EMPTY_WIZARD,
      isOpen: true,
      step: 1,
      role: 'juego',
      projectMode: hasProjects ? 'existing' : 'new',
      projectId: firstProjId,
      newProjectStartDate: today,
      newProjectEndDate: today,
      newGameAreas: ['herreria', 'corte-laser'],
      newGameTargets: { herreria: 10, 'corte-laser': 10 },
      areaId: dynamicAreas[0]?.id || 'herreria',
    });
  };

  const closeWizard = () => setWizard(EMPTY_WIZARD);

  const handleToggleWizardGameArea = (areaId) => {
    setWizard((prev) => {
      const isSelected = prev.newGameAreas.includes(areaId);
      let nextAreas = isSelected
        ? prev.newGameAreas.filter((id) => id !== areaId)
        : [...prev.newGameAreas, areaId];

      const nextTargets = { ...prev.newGameTargets };

      if (isSelected && areaId === 'corte-laser' && nextAreas.includes('herreria')) {
        nextAreas = nextAreas.filter((id) => id !== 'herreria');
        delete nextTargets['herreria'];
      }
      if (!isSelected && areaId === 'herreria' && !nextAreas.includes('corte-laser')) {
        nextAreas.push('corte-laser');
        nextTargets['corte-laser'] = nextTargets['corte-laser'] || 10;
      }

      if (isSelected) {
        delete nextTargets[areaId];
      } else {
        nextTargets[areaId] = nextTargets[areaId] || 10;
      }

      return {
        ...prev,
        newGameAreas: nextAreas,
        newGameTargets: nextTargets,
      };
    });
  };

  const handleWizardNext = () => {
    if (wizard.step === 1) {
      if (wizard.role === 'juego') {
        if (proyectos.length === 0) {
          setWizard((prev) => ({ ...prev, projectMode: 'new', step: 2 }));
        } else {
          setWizard((prev) => ({ ...prev, step: 2 }));
        }
      } else {
        setWizard((prev) => ({ ...prev, step: 2 }));
      }
      return;
    }

    if (wizard.step === 2 && wizard.role === 'juego') {
      if (wizard.projectMode === 'new') {
        if (!wizard.newProjectName.trim() || !wizard.newProjectClient.trim()) {
          toast.danger('Por favor ingresa el Nombre del Proyecto y el Cliente.');
          return;
        }
      } else {
        if (!wizard.projectId) {
          toast.danger('Selecciona el proyecto al que pertenecerá el juego.');
          return;
        }
      }
      const availableGames = juegos.filter((j) => j.projectId === wizard.projectId);
      const autoGameMode = (wizard.projectMode === 'new' || availableGames.length === 0) ? 'new' : 'existing';
      setWizard((prev) => ({ ...prev, gameMode: autoGameMode, step: 3 }));
      return;
    }

    if (wizard.step === 3 && wizard.role === 'juego') {
      if (wizard.gameMode === 'new') {
        if (!wizard.newGameName.trim()) {
          toast.danger('Ingresa el nombre del juego / modelo.');
          return;
        }
      } else {
        if (!wizard.gameId) {
          toast.danger('Selecciona un juego existente.');
          return;
        }
      }
      setWizard((prev) => ({
        ...prev,
        step: 4,
        name: prev.name || (prev.gameMode === 'new' ? prev.newGameName.trim() : (juegos.find((j) => j.id === prev.gameId)?.name || 'Nodo de Juego')),
      }));
      return;
    }
  };

  const handleWizardBack = () => {
    setWizard((prev) => ({ ...prev, step: Math.max(1, prev.step - 1) }));
  };

  const handleWizardFinish = async () => {
    let finalProjectId = wizard.projectId;
    let finalProjectName = proyectos.find((p) => p.id === finalProjectId)?.name || '';

    // 1. Crear proyecto nuevo si aplica
    if (wizard.projectMode === 'new' && (wizard.role === 'proyecto' || wizard.role === 'juego' || wizard.newProjectName.trim())) {
      if (!wizard.newProjectName.trim() || !wizard.newProjectClient.trim()) {
        toast.danger('Ingresa Nombre del Proyecto y Cliente.');
        return;
      }
      const today = getTodayLocalDateStr();
      try {
        finalProjectId = await addProject({
          name: wizard.newProjectName.trim(),
          client: wizard.newProjectClient.trim(),
          description: wizard.newProjectDesc.trim() || 'Sin descripción',
          startDate: wizard.newProjectStartDate || today,
          endDate: wizard.newProjectEndDate || today,
          status: wizard.newProjectStatus || 'diseno',
        });
        finalProjectName = wizard.newProjectName.trim();
        toast.success(`🗂️ Proyecto "${finalProjectName}" registrado.`);
      } catch (err) {
        console.error('Error creando proyecto en wizard:', err);
      }
    }

    let finalGameId = wizard.gameId;

    // 2. Crear juego nuevo si aplica
    if (wizard.role === 'juego' && wizard.gameMode === 'new') {
      if (!wizard.newGameName.trim()) {
        toast.danger('Ingresa el nombre del juego.');
        return;
      }
      let chosenAreas = wizard.newGameAreas && wizard.newGameAreas.length > 0
        ? wizard.newGameAreas
        : [wizard.areaId || 'herreria'];

      if (chosenAreas.includes('herreria') && !chosenAreas.includes('corte-laser')) {
        chosenAreas.push('corte-laser');
      }

      const targets = {};
      chosenAreas.forEach((ar) => {
        targets[ar] = Number(wizard.newGameTargets?.[ar]) || 10;
      });

      try {
        finalGameId = await addGame({
          name: wizard.newGameName.trim(),
          projectName: finalProjectName || 'General',
          projectId: finalProjectId || null,
          areas: chosenAreas,
          targetPieces: targets,
        });
        toast.success(`🎮 Juego "${wizard.newGameName.trim()}" registrado.`);
      } catch (err) {
        console.error('Error creando juego en wizard:', err);
      }
    }

    const defaultNodeName =
      wizard.name.trim() ||
      (wizard.role === 'proyecto'
        ? (wizard.projectMode === 'new' ? wizard.newProjectName : finalProjectName || 'Proyecto')
        : wizard.role === 'juego'
        ? (wizard.gameMode === 'new' ? wizard.newGameName : juegos.find((j) => j.id === finalGameId)?.name || 'Juego')
        : 'Nodo de Trabajo');

    spawnNode('bloque', {
      blockName: defaultNodeName,
      nodeRole: wizard.role,
      projectId: finalProjectId || null,
      gameId: finalGameId || null,
      areaId: wizard.areaId || (dynamicAreas[0]?.id || 'herreria'),
      operarioId: wizard.operarioId || null,
      activityIds: [],
    });

    closeWizard();
    toast.success('📦 Nodo creado con éxito en el lienzo.');
  };

  /** Actualiza cualquier propiedad de un Bloque (nombre, proyecto, juego, área, colaborador) */
  const updateBlockField = (nodeId, field, value) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === nodeId ? { ...n, [field]: value } : n));
      saveToFirestore(next, edges);
      return next;
    });
  };

  const updateBlockName = (nodeId, value) => {
    updateBlockField(nodeId, 'blockName', value);
  };

  // ---- Crear una actividad NUEVA (real, en Firestore) directamente dentro de un Bloque ----
  const EMPTY_BLOCK_ACTIVITY = {
    isOpen: false,
    blockNodeId: null,
    title: '',
    description: '',
    priority: 'media',
    dueDate: '',
    attachments: [],
    linksText: '',
    modelFile: null,
    modelLink: '',
  };
  const [blockActivityForm, setBlockActivityForm] = useState(EMPTY_BLOCK_ACTIVITY);
  const [isSavingBlockActivity, setIsSavingBlockActivity] = useState(false);

  const openBlockActivityForm = (blockNodeId) => setBlockActivityForm({ ...EMPTY_BLOCK_ACTIVITY, isOpen: true, blockNodeId });
  const closeBlockActivityForm = () => setBlockActivityForm(EMPTY_BLOCK_ACTIVITY);

  const handleBlockActivityFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBlockActivityForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...files] }));
    e.target.value = '';
  };

  const handleRemoveBlockActivityFile = (idx) => {
    setBlockActivityForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== idx) }));
  };

  const handleBlockActivityModelFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlockActivityForm((prev) => ({ ...prev, modelFile: file }));
    e.target.value = '';
  };

  const handleCreateBlockActivity = async () => {
    const blockNode = findNode(blockActivityForm.blockNodeId);
    if (!blockNode || !blockActivityForm.title.trim()) {
      toast.danger('Ingresa un título para la actividad.');
      return;
    }
    const colaboradorNode = getConnectedColaboradorNode(blockNode.id);
    const assignedOperarioId = blockNode.operarioId || colaboradorNode?.refId || null;
    const links = blockActivityForm.linksText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    setIsSavingBlockActivity(true);
    const newId = await addActividad({
      title: blockActivityForm.title.trim(),
      description: blockActivityForm.description || 'Sin descripción.',
      areaId: blockNode.areaId,
      projectId: blockNode.projectId || null,
      gameId: blockNode.gameId || null,
      operarioId: assignedOperarioId,
      dueDate: blockActivityForm.dueDate || null,
      priority: blockActivityForm.priority,
      attachments: blockActivityForm.attachments,
      links,
      modelFile: blockActivityForm.modelFile,
      modelLink: blockActivityForm.modelLink,
    });
    setIsSavingBlockActivity(false);
    if (!newId) {
      toast.danger('❌ No se pudo crear la actividad. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === blockNode.id ? { ...n, activityIds: [...(n.activityIds || []), newId] } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Actividad "${blockActivityForm.title.trim()}" creada y agregada al nodo.`);
    closeBlockActivityForm();
  };

  // ---- Enlazar al Bloque una actividad que YA existe en el sistema (sin crear una nueva) ----
  const [blockLinkPicker, setBlockLinkPicker] = useState({ isOpen: false, blockNodeId: null, query: '' });

  const openBlockLinkPicker = (blockNodeId) => setBlockLinkPicker({ isOpen: true, blockNodeId, query: '' });
  const closeBlockLinkPicker = () => setBlockLinkPicker({ isOpen: false, blockNodeId: null, query: '' });

  const blockLinkCandidates = useMemo(() => {
    const blockNode = findNode(blockLinkPicker.blockNodeId);
    if (!blockNode) return [];
    const q = blockLinkPicker.query.trim().toLowerCase();
    return actividades.filter(
      (a) => !blockNode.activityIds.includes(a.id) && a.title.toLowerCase().includes(q)
    );
  }, [blockLinkPicker.blockNodeId, blockLinkPicker.query, actividades, findNode]);

  const handleLinkExistingActivity = (activityId) => {
    const blockNode = findNode(blockLinkPicker.blockNodeId);
    if (!blockNode) return;
    const nextNodes = nodes.map((n) => (n.id === blockNode.id ? { ...n, activityIds: [...n.activityIds, activityId] } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    closeBlockLinkPicker();
  };

  /** Quita una actividad del Bloque (solo la desvincula de este lienzo; no la borra del sistema) */
  const handleUnlinkActivity = (blockNodeId, activityId) => {
    const nextNodes = nodes.map((n) =>
      n.id === blockNodeId ? { ...n, activityIds: (n.activityIds || []).filter((id) => id !== activityId) } : n
    );
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.info('Actividad desvinculada del nodo visual.');
  };

  /** Elimina la actividad permanentemente de Firestore y despacha aviso al chat del personal */
  const handleDeleteActivityCompletely = async (blockNodeId, activityId) => {
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    if (act.status !== 'pendiente') {
      toast.warning('Solo se pueden eliminar actividades en estado pendiente.');
      return;
    }
    const res = await deleteActividad(activityId);
    if (res?.ok) {
      const nextNodes = nodes.map((n) =>
        n.id === blockNodeId ? { ...n, activityIds: (n.activityIds || []).filter((id) => id !== activityId) } : n
      );
      setNodes(nextNodes);
      saveToFirestore(nextNodes, edges);
      toast.success(`🗑️ Actividad "${act.title}" eliminada y aviso enviado al chat interno.`);
    } else {
      toast.danger(res?.error || 'No se pudo eliminar la actividad.');
    }
  };

  /**
   * Un Bloque se puede conectar (con cable, igual que cualquier otro nodo) a un
   * Colaborador — esa conexión es lo que determina quién queda como responsable de las
   * actividades del bloque: no se asigna a mano por actividad, se asigna al ligar el
   * bloque con el colaborador. Acepta el cable en cualquier dirección (Bloque→Colaborador
   * o Colaborador→Bloque), según de qué lado lo haya arrastrado quien conecta.
   */
  const getConnectedColaboradorNode = (blockNodeId) => {
    const edge = edges.find(
      (e) =>
        (e.from === blockNodeId && findNode(e.to)?.type === 'colaborador') ||
        (e.to === blockNodeId && findNode(e.from)?.type === 'colaborador')
    );
    if (!edge) return null;
    const colabNodeId = findNode(edge.from)?.type === 'colaborador' ? edge.from : edge.to;
    return findNode(colabNodeId);
  };

  /**
   * Reasigna TODAS las actividades ya existentes del bloque al colaborador actualmente
   * conectado — para cuando el cable se conecta (o se cambia) después de que el bloque
   * ya tenía actividades creadas con otro responsable (o sin ninguno).
   */
  const handleReassignBlockActivities = async (blockNode, colaboradorNodeOverride) => {
    // Acepta el nodo Colaborador ya resuelto (colaboradorNodeOverride) para cuando se
    // llama justo al terminar de crear el cable: en ese instante el estado "edges" del
    // render todavía no incluye el cable nuevo (setState es asíncrono), así que
    // getConnectedColaboradorNode(blockNode.id) — que lee "edges" — no lo encontraría.
    const colaboradorNode = colaboradorNodeOverride || getConnectedColaboradorNode(blockNode.id);
    if (!colaboradorNode) return;
    const activityIds = blockNode.activityIds || [];
    if (activityIds.length === 0) return;

    const results = await Promise.all(
      activityIds.map((activityId) => updateActividad(activityId, { operarioId: colaboradorNode.refId }))
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      toast.danger(`No se pudieron reasignar ${failed} de ${activityIds.length} actividad(es).`);
    } else {
      toast.success(`🔗 ${activityIds.length} actividad(es) reasignada(s) a ${nodeTitle(colaboradorNode)}.`);
    }
  };

  // ============================================
  // GUARDAR BORRADORES EN EL SISTEMA (acciones reales)
  // ============================================
  const handleSaveProyecto = async (node) => {
    const newId = await addProject({ name: node.draftFields.name, client: node.draftFields.client, status: node.draftFields.status });
    if (!newId) {
      toast.danger('❌ No se pudo guardar el Proyecto. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Proyecto "${node.draftFields.name}" creado en el sistema.`);
  };

  const handleSaveJuego = async (node) => {
    const projectEdge = edges.find((e) => e.to === node.id && findNode(e.from)?.type === 'proyecto');
    if (!projectEdge) {
      toast.danger('Conecta este Juego a un Proyecto antes de guardarlo.');
      return;
    }
    const projectNode = findNode(projectEdge.from);
    if (projectNode.draft) {
      toast.danger('Primero guarda el Proyecto conectado, luego este Juego.');
      return;
    }
    const areaEdges = edges.filter((e) => e.from === node.id && findNode(e.to)?.type === 'area');
    if (areaEdges.length === 0) {
      toast.danger('Conecta al menos un Área a este Juego antes de guardarlo.');
      return;
    }
    const areas = areaEdges.map((e) => findNode(e.to).refId);
    const targetPieces = {};
    areas.forEach((areaId) => {
      targetPieces[areaId] = Number(node.draftFields.meta_piezas) || 10;
    });

    const newId = await addGame({ name: node.draftFields.name, projectId: projectNode.refId, areas, targetPieces });
    if (!newId) {
      toast.danger('❌ No se pudo guardar el Juego. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Juego "${node.draftFields.name}" creado en el sistema.`);
  };

  const handleSaveActividad = async (node) => {
    const areaEdge = edges.find((e) => e.to === node.id && findNode(e.from)?.type === 'area');
    if (!areaEdge) {
      toast.danger('Conecta esta Actividad a un Área antes de guardarla.');
      return;
    }
    const areaId = findNode(areaEdge.from).refId;
    const colabEdge = edges.find((e) => e.from === node.id && findNode(e.to)?.type === 'colaborador');
    const operarioId = colabEdge ? findNode(colabEdge.to).refId : null;

    const newId = await addActividad({
      title: node.draftFields.title,
      description: node.draftFields.description || 'Sin descripción.',
      areaId,
      operarioId,
      dueDate: node.draftFields.dueDate || null,
      priority: node.draftFields.priority || 'media',
    });
    if (!newId) {
      toast.danger('❌ No se pudo guardar la Actividad. Intenta de nuevo.');
      return;
    }

    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Actividad "${node.draftFields.title}" creada en el sistema.`);
  };

  const updateDraftField = (nodeId, key, value) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, draftFields: { ...n.draftFields, [key]: value } } : n))
    );
  };

  // ============================================
  // REASIGNAR COLABORADOR A ÁREA (acción real)
  // ============================================
  const getConnectedAreaNode = (colabNodeId) => {
    const edge = edges.find((e) => e.to === colabNodeId && findNode(e.from)?.type === 'area');
    if (!edge) return null;
    return findNode(edge.from);
  };

  const handleAssignColaboradorToArea = (colaboradorEntity, areaNode) => {
    assignToArea(colaboradorEntity.id, areaNode.refId);
    toast.success(`🔁 ${colaboradorEntity.name} fue reasignado a ${nodeTitle(areaNode)}.`);
  };

  const handleOpenStandalone = () => {
    if (!proyectoActivoId) {
      toast.warning('Por favor selecciona un proyecto primero.');
      return;
    }
    window.open(
      `/editor-visual/ventana?proyectoId=${proyectoActivoId}`,
      'DicrejartEditorVisual',
      'width=1680,height=960,menubar=no,toolbar=no,location=no,status=no'
    );
  };

  const handleMinimapClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;
    const targetWorldX = clickX * WORKSPACE_WIDTH;
    const targetWorldY = clickY * WORKSPACE_HEIGHT;

    const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;

    setWorldOffset({
      x: Math.round(wrapRect.width / 2 - targetWorldX * zoom),
      y: Math.round(wrapRect.height / 2 - targetWorldY * zoom),
    });
  };

  // ============================================
  // ANIMACIONES
  // ============================================
  const containerVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.3 } },
  };

  const selectedNode = findNode(selectedNodeId);

  return (
    <motion.div className={`${styles.page} ${standalone ? styles.standalonePage : ''}`} variants={containerVariants} initial="initial" animate="animate">
      <PageHeader
        title="Editor Visual de Asignaciones"
        subtitle="Crea y relaciona Proyectos, Juegos, Actividades, Áreas y Colaboradores arrastrando conexiones."
        shape="arco-doble"
        accentColor="var(--color-secondary)"
      >
        {!standalone && (
          <div style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }}>
            <select
              value={proyectoActivoId}
              onChange={(e) => setProyectoActivoId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-gray-300)',
                backgroundColor: 'var(--input-bg, var(--color-white))',
                color: 'var(--color-dark)',
                minWidth: '200px',
                cursor: 'pointer',
              }}
            >
              <option value="" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>Seleccionar Proyecto...</option>
              {proyectos.filter((p) => p.status !== 'completado').length > 0 && (
                <optgroup label="⚡ Proyectos Activos" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                  {proyectos
                    .filter((p) => p.status !== 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>{p.name}</option>
                    ))}
                </optgroup>
              )}
              {proyectos.filter((p) => p.status === 'completado').length > 0 && (
                <optgroup label="📁 Historial (Finalizados)" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                  {proyectos
                    .filter((p) => p.status === 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>{p.name} (Completado)</option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {standalone && (
          <Button variant="secondary" size="md" onClick={() => window.close()}>
            ✕ Cerrar Ventana
          </Button>
        )}
        {!standalone && (
          <Button
            variant="secondary"
            size="md"
            disabled={!proyectoActivoId}
            onClick={handleOpenStandalone}
          >
            🗔 Abrir en Ventana Aparte
          </Button>
        )}
        {proyectoActivoId && canEditDiagram && nodes.length > 0 && (
          <Button variant="secondary" size="md" onClick={handleAutoArrange}>
            🧹 Reorganizar
          </Button>
        )}
        {proyectoActivoId && nodes.length > 0 && (
          <Button variant="secondary" size="md" onClick={handleExportDiagram} isLoading={isExporting}>
            📥 Exportar PNG
          </Button>
        )}
        <Button variant="secondary" size="md" onClick={() => setHowtoOpen(true)}>
          ¿Cómo funciona?
        </Button>
      </PageHeader>

      {proyectoActivoId ? (
        <div className={styles.workspace}>
          {/* ---------- Rail: paleta + leyenda ---------- */}
          <aside className={styles.rail}>
            {canEditDiagram ? (
              <div>
                <h2 className={styles.railTitle}>Estructura</h2>
                <div className={styles.palette}>
                  <button
                    type="button"
                    className={styles.addNodeMainBtn}
                    onClick={openBlockSetup}
                    title="Crear un nuevo nodo de trabajo integral con proyecto, juego, área y actividades"
                  >
                    <span style={{ fontSize: '18px' }}>➕</span>
                    <div style={{ textAlign: 'left' }}>
                      <strong style={{ display: 'block', fontSize: '13.5px', letterSpacing: '-0.01em' }}>Agregar Nodo</strong>
                      <small style={{ fontSize: '11px', opacity: 0.9, fontWeight: 400 }}>Configuración de proyecto y actividades</small>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.calloutBox} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-gray-400)', fontSize: '12px' }}>
                ℹ️ Solo los Administradores pueden editar o arrastrar nodos en el diagrama.
              </div>
            )}

            <div>
              <h2 className={styles.railTitle}>Buscar Nodo</h2>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Buscar por nombre..."
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
              />
              {nodeSearch.trim() && (
                <div className={styles.searchResults}>
                  {nodeSearchMatches.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={styles.searchResultItem}
                      onClick={() => handleFocusNode(n)}
                    >
                      {NODE_TYPES[n.type].icon} <span>{nodeTitle(n)}</span>
                    </button>
                  ))}
                  {nodeSearchMatches.length === 0 && (
                    <div className={styles.searchResultEmpty}>Sin coincidencias.</div>
                  )}
                </div>
              )}
            </div>

            <div>
              <h2 className={styles.railTitle}>Qué Significa Cada Línea</h2>
              <ul className={styles.legend}>
                <li><span className={styles.dot} style={{ background: 'var(--color-secondary)' }} /><span>Proyecto → Juego: <em>pertenece a</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-tiffany-blue)' }} /><span>Juego → Área: <em>requiere</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área ↔ Colaborador: <em>asignado a</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área → Actividad: <em>incluye</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-golden-yellow)' }} /><span>Actividad → Colaborador: <em>responsable</em></span></li>
              </ul>
            </div>

            <p className={styles.hint}>
              Arrastra desde el punto derecho de un nodo hasta el punto izquierdo de otro para conectar. Haz clic
              en un nodo para ver o guardar sus datos a la derecha. Arrastra el fondo del lienzo para desplazarte
              si tienes varios nodos. Ningún cambio real ocurre hasta que lo confirmes explícitamente en el panel
              derecho.
            </p>
          </aside>

          {/* ---------- Lienzo de Ingeniería CAD (Inventor / SolidWorks Style) ---------- */}
          <div
            ref={canvasWrapRef}
            data-canvas-bg="true"
            className={`${styles.canvasWrap} ${isPanning ? styles.panning : ''} ${isSpacePressed ? styles.spaceGrab : ''}`}
            style={{
              backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px, ${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px, ${GRID_MAJOR_SIZE * zoom}px ${GRID_MAJOR_SIZE * zoom}px, ${GRID_MAJOR_SIZE * zoom}px ${GRID_MAJOR_SIZE * zoom}px`,
              backgroundPosition: `${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px`,
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleWindowMouseMove}
            onMouseUp={handleWindowMouseUp}
            onMouseLeave={handleWindowMouseUp}
          >
            {/* Minimapa CAD flotante (Radar) */}
            {showMinimap && (
              <div
                className={styles.minimapWrap}
                onClick={handleMinimapClick}
                title="Radar CAD: Clic en cualquier zona para centrar vista"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={styles.minimapTitle}>🗺️ Radar CAD</div>
                <div className={styles.minimapCanvas}>
                  {nodes.map((n) => {
                    const nodeX = (n.x / WORKSPACE_WIDTH) * 100;
                    const nodeY = (n.y / WORKSPACE_HEIGHT) * 100;
                    const nodeW = Math.max(4, (NODE_WIDTH / WORKSPACE_WIDTH) * 100);
                    const nodeH = Math.max(3, (NODE_HEIGHT / WORKSPACE_HEIGHT) * 100);
                    return (
                      <div
                        key={`mini-${n.id}`}
                        className={styles.minimapNode}
                        style={{
                          left: `${nodeX}%`,
                          top: `${nodeY}%`,
                          width: `${nodeW}%`,
                          height: `${nodeH}%`,
                          backgroundColor: NODE_TYPES[n.type]?.colorVar || '#ea580c',
                        }}
                      />
                    );
                  })}

                  {(() => {
                    const rect = canvasWrapRef.current?.getBoundingClientRect() || { width: 800, height: 600 };
                    const viewWorldX = (-worldOffset.x / zoom) / WORKSPACE_WIDTH * 100;
                    const viewWorldY = (-worldOffset.y / zoom) / WORKSPACE_HEIGHT * 100;
                    const viewWorldW = (rect.width / zoom) / WORKSPACE_WIDTH * 100;
                    const viewWorldH = (rect.height / zoom) / WORKSPACE_HEIGHT * 100;
                    return (
                      <div
                        className={styles.minimapViewport}
                        style={{
                          left: `${Math.max(0, Math.min(96, viewWorldX))}%`,
                          top: `${Math.max(0, Math.min(96, viewWorldY))}%`,
                          width: `${Math.max(6, Math.min(100, viewWorldW))}%`,
                          height: `${Math.max(6, Math.min(100, viewWorldH))}%`,
                        }}
                      />
                    );
                  })()}
                </div>
              </div>
            )}

            <div
              ref={worldRef}
              className={styles.world}
              style={{
                transform: `translate(${worldOffset.x}px, ${worldOffset.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: WORKSPACE_WIDTH,
                height: WORKSPACE_HEIGHT,
              }}
            >
              {/* Marco delimitador visual del espacio de trabajo */}
              <div className={styles.workspaceBoundary}>
                <div className={styles.originMarker}>
                  <span className={styles.originIcon}>⌖</span>
                  <span>Origen</span>
                  <span className={styles.axisX}>X →</span>
                  <span className={styles.axisY}>↓ Y</span>
                </div>
                <div className={styles.workspaceDimLabelTop}>Espacio de Trabajo: 6,000 × 6,000 mm</div>
              </div>
              <svg className={styles.wires} width={worldBounds.width} height={worldBounds.height}>
                {edges.map((edge) => {
                  const fromNode = findNode(edge.from);
                  const toNode = findNode(edge.to);
                  if (!fromNode || !toNode) return null;
                  const p1 = portPos(fromNode, 'out');
                  const p2 = portPos(toNode, 'in');

                  const juegoEntity = fromNode.type === 'juego' ? getLinkedEntity(fromNode) : null;
                  const areaEntity = toNode.type === 'area' ? getLinkedEntity(toNode) : null;
                  const isBlockedLink = Boolean(
                    juegoEntity && areaEntity && isAreaBlockedBySequence(juegoEntity, areaEntity.id)
                  );

                  const pathData = bezierPath(p1, p2);
                  const color = isBlockedLink ? 'var(--color-alert)' : NODE_TYPES[fromNode.type].colorVar;

                  return (
                    <g key={edge.id} className={styles.wireGroup}>
                      {/* Trazo base de cable físico flexible */}
                      <path
                        d={pathData}
                        className={styles.wireBase}
                        stroke={color}
                      />
                      {/* Línea punteada técnica de conexión interactiva */}
                      <path
                        d={pathData}
                        className={`${styles.wirePath} ${styles.wireDashed}`}
                        stroke={color}
                        strokeDasharray={isBlockedLink ? '4 4' : '7 5'}
                        onClick={() => {
                          if (!canEditDiagram) return;
                          const nextEdges = edges.filter((e) => e.id !== edge.id);
                          setEdges(nextEdges);
                          saveToFirestore(nodes, nextEdges);
                        }}
                      >
                        <title>
                          {isBlockedLink
                            ? `🔒 Bloqueado: ${dynamicAreas.find((a) => a.id === AREA_SEQUENCE_DEPENDENCIES[areaEntity.id])?.name} todavía no completa su meta. Clic para eliminar este cable.`
                            : 'Clic para desconectar este cable'}
                        </title>
                      </path>
                    </g>
                  );
                })}
                {previewWire && (
                  <path className={styles.wirePreview} d={bezierPath({ x: previewWire.x1, y: previewWire.y1 }, { x: previewWire.x2, y: previewWire.y2 })} />
                )}
              </svg>

              {nodes.map((node) => {
                const meta = NODE_TYPES[node.type];
                return (
                  <div
                    key={node.id}
                    className={`${styles.node} ${selectedNodeId === node.id ? styles.selected : ''}`}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, '--node-color': meta.colorVar }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  >
                    <div className={styles.nodeHead}>
                      <span className={styles.nodeIcon}>{meta.icon}</span>
                      <span className={styles.nodeTitle}>{nodeTitle(node)}</span>
                      {node.type !== 'area' && node.type !== 'bloque' && (
                        <span className={styles.nodeBadge}>{node.draft ? '🆕 Nuevo' : '🔗 Existente'}</span>
                      )}
                      {canEditDiagram && (
                        <button
                          type="button"
                          data-role="close"
                          className={styles.nodeClose}
                          title="Quitar del lienzo"
                          onClick={() => handleCloseNode(node.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div
                      className={styles.nodeBody}
                      onMouseDown={(e) => node.type === 'bloque' && e.stopPropagation()}
                      onClick={() => node.type === 'bloque' && toggleBlockExpanded(node.id)}
                      style={node.type === 'bloque' ? { cursor: 'pointer' } : undefined}
                    >
                      <span className={styles.nodeEyebrow}>{meta.label}</span>
                      {node.type === 'bloque' ? (
                        <div className={styles.nodeBadgesGrid}>
                          <div className={styles.nodeBadgeTag} title="Proyecto">
                            🗂️ {proyectos.find((p) => p.id === node.projectId)?.name || 'Sin proyecto'}
                          </div>
                          <div className={styles.nodeBadgeTag} title="Juego">
                            🎮 {juegos.find((j) => j.id === node.gameId)?.name || 'Sin juego'}
                          </div>
                          <div className={styles.nodeBadgeTag} title="Área">
                            🏭 {allBlockAreas.find((a) => a.id === node.areaId)?.name || node.areaId}
                          </div>
                          <div className={styles.nodeBadgeTag} title="Responsable">
                            👷 {operarios.find((o) => o.id === node.operarioId)?.name || (
                              getConnectedColaboradorNode(node.id) ? nodeTitle(getConnectedColaboradorNode(node.id)) : 'Sin asignar'
                            )}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                            <span>📌 {(node.activityIds || []).length} actividades</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{expandedBlocks.has(node.id) ? '▲ Ocultar' : '▼ Ver detalles'}</span>
                          </div>
                        </div>
                      ) : (
                        <span className={styles.nodeTag}>
                          {nodeSummary(node)}
                        </span>
                      )}
                    </div>

                    {node.type === 'bloque' && expandedBlocks.has(node.id) && (
                      <div
                        data-role="block-panel"
                        className={styles.blockDropdown}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {(() => {
                          const colaboradorNode = getConnectedColaboradorNode(node.id);
                          const directOperario = operarios.find((o) => o.id === node.operarioId);
                          const currentResponsable = directOperario?.name || (colaboradorNode ? nodeTitle(colaboradorNode) : null);
                          return (
                            <div className={styles.blockDropdownResponsable}>
                              <span>👷 Responsable: <strong>{currentResponsable || 'Sin asignar'}</strong></span>
                              {canEditDiagram && currentResponsable && (node.activityIds || []).length > 0 && (
                                <button
                                  type="button"
                                  className={styles.blockDropdownAction}
                                  onClick={() => handleReassignBlockActivities(node, colaboradorNode)}
                                  title="Reasignar todas las actividades de este nodo al responsable actual"
                                >
                                  🔗 Reasignar todas
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {(node.activityIds || []).length === 0 && (
                          <p className={styles.blockDropdownEmpty}>Aún no hay actividades en este nodo.</p>
                        )}
                        {(node.activityIds || []).map((activityId) => {
                          const act = actividades.find((a) => a.id === activityId);
                          if (!act) return null;
                          const responsable = operarios.find((o) => o.id === act.operarioId)?.name;
                          const attachmentCount = act.attachments?.length || 0;
                          const linkCount = act.links?.length || 0;
                          const modelUrl = act.modelFile?.url || act.modelLink || null;
                          return (
                            <div key={activityId} className={styles.blockDropdownItem}>
                              <div>
                                <strong>📌 {act.title}</strong>
                                <div className={styles.blockDropdownMeta}>
                                  <span>{act.status}</span>
                                  <span>· {act.priority}</span>
                                  {responsable && <span>· 👷 {responsable}</span>}
                                  {attachmentCount > 0 && <span>· 📎 {attachmentCount}</span>}
                                  {linkCount > 0 && <span>· 🔗 {linkCount}</span>}
                                </div>
                                {linkCount > 0 && (
                                  <div className={styles.blockDropdownLinks}>
                                    {act.links.map((url) => (
                                      <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
                                    ))}
                                  </div>
                                )}
                                {modelUrl && (
                                  <button
                                    type="button"
                                    className={styles.blockDropdownModelBtn}
                                    onClick={() => window.open(modelUrl, '_blank', 'noreferrer')}
                                    title={act.modelFile ? `Abrir ${act.modelFile.name}` : 'Abrir link del modelo'}
                                  >
                                    🎬 Abrir Modelo
                                  </button>
                                )}
                              </div>
                              {canEditDiagram && (
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    className={styles.blockDropdownRemove}
                                    title="Desvincular del nodo visual"
                                    onClick={() => handleUnlinkActivity(node.id, activityId)}
                                  >
                                    ✕
                                  </button>
                                  {act.status === 'pendiente' && (
                                    <button
                                      type="button"
                                      className={styles.blockDropdownRemove}
                                      style={{ color: 'var(--color-alert)' }}
                                      title="Eliminar actividad permanentemente y avisar al personal en el chat"
                                      onClick={() => handleDeleteActivityCompletely(node.id, activityId)}
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {canEditDiagram && (
                          <div className={styles.blockDropdownActions}>
                            <button type="button" className={styles.blockDropdownAction} onClick={() => openBlockActivityForm(node.id)}>
                              ➕ Nueva actividad
                            </button>
                            <button type="button" className={styles.blockDropdownAction} onClick={() => openBlockLinkPicker(node.id)}>
                              🔗 Existente
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {canEditDiagram && (
                      <>
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="in"
                          className={`${styles.port} ${styles.portIn}`}
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="out"
                          className={`${styles.port} ${styles.portOut}`}
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {nodes.length === 0 && (
                <div style={{ position: 'absolute', left: 40, top: 40, width: 360 }}>
                  <EmptyState
                    message="Agrega tu primer nodo desde la paleta de la izquierda para empezar."
                    shape="mancha"
                    color="var(--color-secondary)"
                  />
                </div>
              )}
            </div>

            {/* ---------- Barra de Información Técnica CAD (Inferior Izquierda) ---------- */}
            <div className={styles.cadInfoBar} onMouseDown={(e) => e.stopPropagation()}>
              <div className={styles.cadCoords}>
                <span>📍</span> X: {cursorCoords.x} mm &nbsp;|&nbsp; Y: {cursorCoords.y} mm
              </div>
              <div className={styles.cadShortcuts}>
                🖱️ Rueda: Zoom · Clic Rueda / Espacio: Mover · F: Centrar
              </div>
            </div>

            {/* ---------- Controles de Zoom y HUD (Flotantes, Esquina Inferior Derecha) ---------- */}
            <div className={styles.zoomControls} onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" className={styles.zoomBtn} title="Alejar (Rueda hacia abajo)" onClick={() => handleZoomButton(-ZOOM_STEP)}>
                −
              </button>
              <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
              <button type="button" className={styles.zoomBtn} title="Acercar (Rueda hacia arriba)" onClick={() => handleZoomButton(ZOOM_STEP)}>
                +
              </button>
              <button
                type="button"
                className={styles.zoomResetBtn}
                title="Centrar y ajustar todo el diagrama (Tecla F)"
                onClick={handleFitToView}
              >
                🎯 Centrar (F)
              </button>
              <button
                type="button"
                className={styles.zoomResetBtn}
                title="Restablecer zoom a 100%"
                onClick={handleResetView}
              >
                ⤢ 100%
              </button>
              <button
                type="button"
                className={`${styles.snapToggleBtn} ${snapToGrid ? styles.active : ''}`}
                title={snapToGrid ? 'Alineación magnética a cuadrícula activa (25mm)' : 'Alineación magnética desactivada'}
                onClick={() => setSnapToGrid((prev) => !prev)}
              >
                🧲 {snapToGrid ? 'Snap ON' : 'Snap OFF'}
              </button>
              <button
                type="button"
                className={styles.snapToggleBtn}
                title={showMinimap ? 'Ocultar radar CAD' : 'Mostrar radar CAD'}
                onClick={() => setShowMinimap((prev) => !prev)}
              >
                🗺️ Radar
              </button>
            </div>
          </div>

          {/* ---------- Inspector ---------- */}
          {selectedNode && (
            <aside className={styles.inspector}>
              <NodeInspector
                node={selectedNode}
                entity={getLinkedEntity(selectedNode)}
                edges={edges}
                findNode={findNode}
                nodeTitle={nodeTitle}
                updateDraftField={(key, value) => updateDraftField(selectedNode.id, key, value)}
                onSaveProyecto={() => handleSaveProyecto(selectedNode)}
                onSaveJuego={() => handleSaveJuego(selectedNode)}
                onSaveActividad={() => handleSaveActividad(selectedNode)}
                onAssignColaborador={handleAssignColaboradorToArea}
                getConnectedAreaNode={getConnectedAreaNode}
                getConnectedColaboradorNode={getConnectedColaboradorNode}
                actividades={actividades}
                operarios={operarios}
                proyectos={proyectos}
                juegos={juegos}
                addProject={addProject}
                addGame={addGame}
                canEditDiagram={canEditDiagram}
                updateBlockField={(field, value) => updateBlockField(selectedNode.id, field, value)}
                updateBlockName={(value) => updateBlockName(selectedNode.id, value)}
                onSaveBlockName={() => saveToFirestore(nodes, edges)}
                openBlockActivityForm={() => openBlockActivityForm(selectedNode.id)}
                handleReassignBlockActivities={(colabNode) => handleReassignBlockActivities(selectedNode, colabNode)}
                dynamicAreas={dynamicAreas}
                allBlockAreas={allBlockAreas}
              />
            </aside>
          )}
        </div>
      ) : (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <EmptyState
            title="Selecciona un Proyecto"
            description="Para comenzar a diseñar o ver la asignación de nodos, selecciona uno de los proyectos activos en el menú superior."
            icon="🗂️"
          />
        </div>
      )}

      {/* ---------- MODAL: PICKER ---------- */}
      <Modal isOpen={picker.isOpen} onClose={closePicker} title={picker.type ? `Agregar ${NODE_TYPES[picker.type].label}` : 'Agregar'}>
        <input
          type="text"
          autoFocus
          className={styles.pickerSearch}
          placeholder={picker.type && NODE_TYPES[picker.type].allowCreate ? 'Buscar existente o escribir un nombre nuevo...' : 'Buscar en el catálogo...'}
          value={picker.query}
          onChange={(e) => setPicker((prev) => ({ ...prev, query: e.target.value }))}
        />
        <div className={styles.pickerList}>
          {filteredCatalog.map((entry) => (
            <button key={entry.id} type="button" className={styles.pickerItem} onClick={() => handlePickExisting(picker.type, entry.id)}>
              {NODE_TYPES[picker.type]?.icon} <span>{entry.label}</span>
              <span className={styles.pickerBadge}>🔗 existente</span>
            </button>
          ))}
          {picker.type && NODE_TYPES[picker.type].allowCreate && picker.query.trim() && !filteredCatalog.some((c) => c.label.toLowerCase() === picker.query.trim().toLowerCase()) && (
            <button
              type="button"
              className={`${styles.pickerItem} ${styles.pickerCreate}`}
              onClick={() => handleCreateNewDraft(picker.type, picker.query.trim())}
            >
              ➕ <span>Crear &ldquo;{picker.query.trim()}&rdquo; como nuevo</span>
            </button>
          )}
          {filteredCatalog.length === 0 && !(picker.type && NODE_TYPES[picker.type].allowCreate && picker.query.trim()) && (
            <div className={styles.pickerEmpty}>
              {picker.type === 'colaborador'
                ? 'Sin coincidencias. Los colaboradores se dan de alta desde la página de Operarios.'
                : 'Sin coincidencias.'}
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- MODAL: ASISTENTE GUIADO DE CREACIÓN DE NODOS (WIZARD) ---------- */}
      <Modal
        isOpen={wizard.isOpen}
        onClose={closeWizard}
        title={
          wizard.step === 1
            ? '📦 Asistente de Creación: ¿Qué representará este nodo?'
            : wizard.role === 'proyecto'
            ? '🗂️ Configuración del Proyecto'
            : wizard.role === 'juego' && wizard.step === 2
            ? '🗂️ Paso 2: Proyecto Requerido para el Juego'
            : wizard.role === 'juego' && wizard.step === 3
            ? '🎮 Paso 3: Configuración del Juego / Modelo'
            : wizard.role === 'juego' && wizard.step === 4
            ? '🏭 Paso 4: Área y Colaborador Responsable'
            : '📌 Configuración de Actividades del Nodo'
        }
      >
        {/* PASO 1: SELECCIONAR QUÉ REPRESENTARÁ EL NODO */}
        {wizard.step === 1 && (
          <div className={styles.wizardContainer}>
            <p style={{ fontSize: '13px', color: 'var(--color-gray-600)', margin: '0 0 6px 0' }}>
              Elige la función o entidad principal que representará este nodo en el diagrama:
            </p>
            <div className={styles.wizardRoleGrid}>
              {/* Tarjeta 1: Juego / Modelo */}
              <div
                className={`${styles.wizardRoleCard} ${wizard.role === 'juego' ? styles.wizardRoleCardActive : ''}`}
                onClick={() => setWizard((prev) => ({ ...prev, role: 'juego' }))}
              >
                <div className={styles.wizardRoleIcon}>🎮</div>
                <div className={styles.wizardRoleText}>
                  <span className={styles.wizardRoleTitle}>Juego / Modelo de Producción</span>
                  <span className={styles.wizardRoleDesc}>
                    Modelo físico que pasa por manufactura (Herrería, Láser, Pintura, etc.) con metas de piezas y control de calidad. Requiere un Proyecto.
                  </span>
                </div>
              </div>

              {/* Tarjeta 2: Proyecto General */}
              <div
                className={`${styles.wizardRoleCard} ${wizard.role === 'proyecto' ? styles.wizardRoleCardActive : ''}`}
                onClick={() => setWizard((prev) => ({ ...prev, role: 'proyecto' }))}
              >
                <div className={styles.wizardRoleIcon}>🗂️</div>
                <div className={styles.wizardRoleText}>
                  <span className={styles.wizardRoleTitle}>Proyecto General</span>
                  <span className={styles.wizardRoleDesc}>
                    Representa un contrato, cliente, parque o proyecto maestro en el sistema.
                  </span>
                </div>
              </div>

              {/* Tarjeta 3: Bloque de Actividades */}
              <div
                className={`${styles.wizardRoleCard} ${wizard.role === 'bloque' ? styles.wizardRoleCardActive : ''}`}
                onClick={() => setWizard((prev) => ({ ...prev, role: 'bloque' }))}
              >
                <div className={styles.wizardRoleIcon}>📌</div>
                <div className={styles.wizardRoleText}>
                  <span className={styles.wizardRoleTitle}>Bloque Operativo de Actividades</span>
                  <span className={styles.wizardRoleDesc}>
                    Contenedor de tareas y actividades operativas para un área de trabajo o colaborador.
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.wizardFooterNav}>
              <Button variant="ghost" size="md" onClick={closeWizard}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleWizardNext}>Continuar →</Button>
            </div>
          </div>
        )}

        {/* PASO 2: PROYECTO (Para Rol Proyecto) */}
        {wizard.step === 2 && wizard.role === 'proyecto' && (
          <div className={styles.wizardContainer}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ margin: 0, fontWeight: 600 }}>Configuración del Proyecto</label>
              {proyectos.length > 0 && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setWizard((prev) => ({ ...prev, projectMode: prev.projectMode === 'new' ? 'existing' : 'new' }))}
                >
                  {wizard.projectMode === 'new' ? '✕ Usar existente' : '➕ Crear Proyecto Nuevo'}
                </button>
              )}
            </div>

            {wizard.projectMode === 'existing' && proyectos.length > 0 ? (
              <div className={styles.field}>
                <label>Seleccionar Proyecto Existente</label>
                <select
                  value={wizard.projectId}
                  onChange={(e) => setWizard((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Seleccionar Proyecto...</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className={styles.inlineCreateBox}>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Nombre del Proyecto *</label>
                    <input
                      type="text"
                      placeholder="Nombre..."
                      value={wizard.newProjectName}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Cliente / Entidad *</label>
                    <input
                      type="text"
                      placeholder="Cliente..."
                      value={wizard.newProjectClient}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectClient: e.target.value }))}
                    />
                  </div>
                </div>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Inicio</label>
                    <input
                      type="date"
                      value={wizard.newProjectStartDate}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectStartDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Entrega</label>
                    <input
                      type="date"
                      value={wizard.newProjectEndDate}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectEndDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Descripción</label>
                  <textarea
                    rows="2"
                    placeholder="Descripción u observaciones..."
                    value={wizard.newProjectDesc}
                    onChange={(e) => setWizard((prev) => ({ ...prev, newProjectDesc: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className={styles.field}>
              <label>Nombre del Nodo en el Lienzo (Opcional)</label>
              <input
                type="text"
                placeholder="Por defecto tomará el nombre del proyecto"
                value={wizard.name}
                onChange={(e) => setWizard((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className={styles.wizardFooterNav}>
              <Button variant="ghost" size="md" onClick={handleWizardBack}>← Volver</Button>
              <Button variant="primary" size="md" onClick={handleWizardFinish}>➕ Crear Nodo en el Lienzo</Button>
            </div>
          </div>
        )}

        {/* PASO 2: PROYECTO OBLIGATORIO PARA JUEGO */}
        {wizard.step === 2 && wizard.role === 'juego' && (
          <div className={styles.wizardContainer}>
            {proyectos.length === 0 ? (
              <div className={styles.calloutBox} style={{ background: 'rgba(234, 88, 12, 0.08)', border: '1px solid rgba(234, 88, 12, 0.3)' }}>
                ℹ️ <strong>Todo modelo de juego debe pertenecer a un Proyecto.</strong> Como aún no hay proyectos registrados, regístralo a continuación para continuar con el juego:
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0, fontWeight: 600 }}>¿A qué proyecto pertenecerá este juego?</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setWizard((prev) => ({ ...prev, projectMode: prev.projectMode === 'new' ? 'existing' : 'new' }))}
                >
                  {wizard.projectMode === 'new' ? '✕ Elegir proyecto existente' : '➕ Crear Proyecto Nuevo'}
                </button>
              </div>
            )}

            {wizard.projectMode === 'existing' && proyectos.length > 0 ? (
              <div className={styles.field}>
                <select
                  value={wizard.projectId}
                  onChange={(e) => setWizard((prev) => ({ ...prev, projectId: e.target.value, gameId: '' }))}
                >
                  <option value="">Selecciona el Proyecto...</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className={styles.inlineCreateBox}>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Nombre del Proyecto *</label>
                    <input
                      type="text"
                      placeholder="Ej. Parque Metropolitano 2026..."
                      value={wizard.newProjectName}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Cliente / Entidad *</label>
                    <input
                      type="text"
                      placeholder="Ej. Municipio / Constructora..."
                      value={wizard.newProjectClient}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectClient: e.target.value }))}
                    />
                  </div>
                </div>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Inicio</label>
                    <input
                      type="date"
                      value={wizard.newProjectStartDate}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectStartDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Entrega</label>
                    <input
                      type="date"
                      value={wizard.newProjectEndDate}
                      onChange={(e) => setWizard((prev) => ({ ...prev, newProjectEndDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Descripción</label>
                  <textarea
                    rows="2"
                    placeholder="Descripción u observaciones del proyecto..."
                    value={wizard.newProjectDesc}
                    onChange={(e) => setWizard((prev) => ({ ...prev, newProjectDesc: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className={styles.wizardFooterNav}>
              <Button variant="ghost" size="md" onClick={handleWizardBack}>← Volver</Button>
              <Button variant="primary" size="md" onClick={handleWizardNext}>Continuar al Juego →</Button>
            </div>
          </div>
        )}

        {/* PASO 3: CONFIGURACIÓN DEL JUEGO / MODELO */}
        {wizard.step === 3 && wizard.role === 'juego' && (
          <div className={styles.wizardContainer}>
            {wizard.projectMode === 'existing' && juegos.filter((j) => j.projectId === wizard.projectId).length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0, fontWeight: 600 }}>Modelo de Juego</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setWizard((prev) => ({ ...prev, gameMode: prev.gameMode === 'new' ? 'existing' : 'new' }))}
                >
                  {wizard.gameMode === 'new' ? '✕ Usar juego existente' : '➕ Crear Juego Nuevo'}
                </button>
              </div>
            )}

            {wizard.gameMode === 'existing' && juegos.filter((j) => j.projectId === wizard.projectId).length > 0 ? (
              <div className={styles.field}>
                <label>Seleccionar Juego Existente</label>
                <select
                  value={wizard.gameId}
                  onChange={(e) => setWizard((prev) => ({ ...prev, gameId: e.target.value }))}
                >
                  <option value="">Selecciona el Juego...</option>
                  {juegos
                    .filter((j) => j.projectId === wizard.projectId || j.projectName === proyectos.find((p) => p.id === wizard.projectId)?.name)
                    .map((j) => (
                      <option key={j.id} value={j.id}>{j.name} ({j.projectName || 'General'})</option>
                    ))}
                </select>
              </div>
            ) : (
              <div className={styles.inlineCreateBox}>
                <label style={{ fontSize: '11.5px', color: 'var(--color-gray-700)', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                  Nombre del Modelo / Juego *
                </label>
                <input
                  type="text"
                  placeholder="Ej. Resbaladilla Acero Inoxidable..."
                  value={wizard.newGameName}
                  onChange={(e) => setWizard((prev) => ({ ...prev, newGameName: e.target.value }))}
                />

                <label style={{ fontSize: '11.5px', color: 'var(--color-gray-700)', fontWeight: 600, display: 'block', marginTop: '6px', marginBottom: '2px' }}>
                  Áreas de Manufactura Requeridas:
                </label>
                <div className={styles.areasGridPills}>
                  {dynamicAreas.map((a) => {
                    const isSelected = wizard.newGameAreas?.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                        onClick={() => handleToggleWizardGameArea(a.id)}
                      >
                        {isSelected ? '✓' : '＋'} {a.name}
                      </button>
                    );
                  })}
                </div>

                {wizard.newGameAreas?.length > 0 && (
                  <div className={styles.areaTargetsList}>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>
                      Metas de piezas por área:
                    </label>
                    {wizard.newGameAreas.map((areaId) => {
                      const aName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
                      return (
                        <div key={areaId} className={styles.areaTargetItem}>
                          <span>🏭 {aName}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '70px', padding: '3px 6px', fontSize: '12px' }}
                              value={wizard.newGameTargets?.[areaId] ?? 10}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWizard((prev) => ({
                                  ...prev,
                                  newGameTargets: { ...prev.newGameTargets, [areaId]: val }
                                }));
                              }}
                            />
                            <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>pzas</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className={styles.wizardFooterNav}>
              <Button variant="ghost" size="md" onClick={handleWizardBack}>← Volver</Button>
              <Button variant="primary" size="md" onClick={handleWizardNext}>Continuar a Asignación →</Button>
            </div>
          </div>
        )}

        {/* PASO 4 (Para Juego) O PASO 2 (Para Bloque): ÁREA Y RESPONSABLE */}
        {((wizard.step === 4 && wizard.role === 'juego') || (wizard.step === 2 && wizard.role === 'bloque')) && (
          <div className={styles.wizardContainer}>
            <div className={styles.field}>
              <label>Nombre del Nodo en el Lienzo</label>
              <input
                type="text"
                placeholder="Ej. Estructura — Herrería"
                value={wizard.name}
                onChange={(e) => setWizard((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {wizard.role === 'bloque' && (
              <div className={styles.field}>
                <label>🗂️ Proyecto Ligado (Opcional)</label>
                <select
                  value={wizard.projectId}
                  onChange={(e) => setWizard((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Sin proyecto ligado...</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.field}>
              <label>🏭 Área Asignada</label>
              <select
                value={wizard.areaId}
                onChange={(e) => setWizard((prev) => ({ ...prev, areaId: e.target.value }))}
              >
                <option value="">Seleccionar área...</option>
                <optgroup label="🏭 Áreas de manufactura">
                  {dynamicAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
                <optgroup label="✏️ Otras áreas">
                  {NON_PRODUCTION_AREAS.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className={styles.field}>
              <label>👷 Colaborador Responsable (Opcional)</label>
              <select
                value={wizard.operarioId}
                onChange={(e) => setWizard((prev) => ({ ...prev, operarioId: e.target.value }))}
              >
                <option value="">Sin asignar (o conectar por cable)</option>
                {operarios.map((o) => {
                  const areaName = dynamicAreas.find((a) => a.id === o.currentArea)?.name || o.currentArea;
                  return (
                    <option key={o.id} value={o.id}>{o.name} — {areaName}</option>
                  );
                })}
              </select>
            </div>

            <div className={styles.wizardFooterNav}>
              <Button variant="ghost" size="md" onClick={handleWizardBack}>← Volver</Button>
              <Button variant="primary" size="md" onClick={handleWizardFinish}>➕ Crear Nodo en el Lienzo</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- MODAL: NUEVA ACTIVIDAD DENTRO DE UN BLOQUE ---------- */}
      <Modal isOpen={blockActivityForm.isOpen} onClose={closeBlockActivityForm} title="📌 Nueva Actividad">
        <div className={styles.field}>
          <label>Título</label>
          <input
            type="text"
            autoFocus
            value={blockActivityForm.title}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, title: e.target.value }))}
          />
        </div>
        <div className={styles.field}>
          <label>Descripción</label>
          <textarea
            rows="3"
            value={blockActivityForm.description}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </div>
        <div className={styles.field}>
          <label>Prioridad</label>
          <select
            value={blockActivityForm.priority}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, priority: e.target.value }))}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Fecha Límite</label>
          <input
            type="date"
            value={blockActivityForm.dueDate}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, dueDate: e.target.value }))}
          />
        </div>
        {(() => {
          const blockNode = findNode(blockActivityForm.blockNodeId);
          if (!blockNode) return null;
          const colaboradorNode = getConnectedColaboradorNode(blockNode.id);
          return (
            <div
              className={styles.calloutBox}
              style={
                colaboradorNode
                  ? { background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }
                  : { background: 'rgba(153, 51, 255, 0.08)', border: '1px solid rgba(153, 51, 255, 0.25)' }
              }
            >
              {colaboradorNode ? (
                <>👷 Se asignará automáticamente a <strong>{nodeTitle(colaboradorNode)}</strong> (colaborador conectado a este bloque).</>
              ) : (
                <>ℹ️ Este bloque no tiene un Colaborador conectado — la actividad se creará sin responsable. Conecta un
                  nodo Colaborador al bloque (arrastra desde sus puertos) para asignarla automáticamente.</>
              )}
            </div>
          );
        })()}
        <div className={styles.field}>
          <label>Adjuntar Archivos de Referencia (opcional)</label>
          <input
            type="file"
            accept="image/*,application/pdf,.dwg,.dxf,.step,.stp,.iges,.igs"
            multiple
            onChange={handleBlockActivityFileChange}
          />
          {blockActivityForm.attachments.length > 0 && (
            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {blockActivityForm.attachments.map((file, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>📎 {file.name}</span>
                  <button type="button" onClick={() => handleRemoveBlockActivityFile(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-alert)', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.field}>
          <label>Links de Referencia (opcional, uno por línea)</label>
          <textarea
            rows="2"
            placeholder="https://..."
            value={blockActivityForm.linksText}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, linksText: e.target.value }))}
          />
        </div>

        {/* "Modelo": distinto de los adjuntos de referencia de arriba — es lo que abre el
            botón "🎬 Abrir Modelo" del bloque (planos de Arquitectura o modelos 3D de
            SolidWorks de Diseño, pendientes de integrarse con el visualizador/renderizador
            — por ahora el botón simplemente abre el archivo o el link tal cual). */}
        {(() => {
          const blockNode = findNode(blockActivityForm.blockNodeId);
          const colaboradorNode = blockNode ? getConnectedColaboradorNode(blockNode.id) : null;
          const puesto = colaboradorNode ? operarios.find((o) => o.id === colaboradorNode.refId)?.puesto : null;
          const hint =
            puesto === 'arquitecto'
              ? '📐 Sugerido para Arquitectura: el plano del proyecto (PDF, imagen o DWG/DXF), o el link de Drive donde está guardado.'
              : puesto === 'disenador'
              ? '✏️ Sugerido para Diseño: el archivo del modelo 3D (SolidWorks) o el link de Drive/visualizador donde está guardado.'
              : 'Sube el archivo del modelo/plano o pega el link donde está guardado (ej. Drive).';
          return (
            <>
              <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '14px', marginBottom: '2px' }}>{hint}</p>
              <div className={styles.field}>
                <label>🎬 Archivo del Modelo/Plano (opcional)</label>
                <input type="file" onChange={handleBlockActivityModelFileChange} />
                {blockActivityForm.modelFile && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                    <span>🎬 {blockActivityForm.modelFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setBlockActivityForm((prev) => ({ ...prev, modelFile: null }))}
                      style={{ border: 'none', background: 'none', color: 'var(--color-alert)', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className={styles.field}>
                <label>O Link del Modelo/Plano (ej. Drive)</label>
                <input
                  type="text"
                  placeholder="https://drive.google.com/..."
                  value={blockActivityForm.modelLink}
                  onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, modelLink: e.target.value }))}
                />
              </div>
            </>
          );
        })()}
        <Button variant="primary" size="md" onClick={handleCreateBlockActivity} isLoading={isSavingBlockActivity} style={{ marginTop: '10px' }}>
          💾 Crear y agregar al bloque
        </Button>
      </Modal>

      {/* ---------- MODAL: ENLAZAR ACTIVIDAD EXISTENTE A UN BLOQUE ---------- */}
      <Modal isOpen={blockLinkPicker.isOpen} onClose={closeBlockLinkPicker} title="🔗 Enlazar Actividad Existente">
        <input
          type="text"
          autoFocus
          className={styles.pickerSearch}
          placeholder="Buscar actividad existente..."
          value={blockLinkPicker.query}
          onChange={(e) => setBlockLinkPicker((prev) => ({ ...prev, query: e.target.value }))}
        />
        <div className={styles.pickerList}>
          {blockLinkCandidates.map((a) => (
            <button key={a.id} type="button" className={styles.pickerItem} onClick={() => handleLinkExistingActivity(a.id)}>
              📌 <span>{a.title}</span>
              <span className={styles.pickerBadge}>{dynamicAreas.find((ar) => ar.id === a.areaId)?.name || a.areaId}</span>
            </button>
          ))}
          {blockLinkCandidates.length === 0 && (
            <div className={styles.pickerEmpty}>Sin coincidencias.</div>
          )}
        </div>
      </Modal>

      {/* ---------- MODAL: CONFIRMAR BORRADO DE BLOQUE CON ACTIVIDADES ---------- */}
      <Modal isOpen={deleteBlockConfirm.isOpen} onClose={closeDeleteBlockConfirm} title="🗑️ Eliminar Bloque">
        {(() => {
          const node = findNode(deleteBlockConfirm.nodeId);
          if (!node) return null;
          const count = (node.activityIds || []).length;
          return (
            <div style={{ padding: 'var(--space-2) 0' }}>
              <p style={{ marginBottom: 'var(--space-4)' }}>
                El bloque <strong>{node.blockName}</strong> tiene <strong>{count}</strong> actividad{count === 1 ? '' : 'es'} real
                {count === 1 ? '' : 'es'} en el sistema.
              </p>
              <p style={{ fontSize: '12.5px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
                Para eliminar el bloque, esas actividades también se eliminarán del sistema (no solo se desvincularán).
                Si prefieres conservarlas, cancela y quítalas del bloque una por una con &ldquo;✕&rdquo; antes de borrarlo.
                Una actividad que ya tenga avance (no esté &ldquo;pendiente&rdquo;) impedirá el borrado por completo.
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="md" onClick={closeDeleteBlockConfirm}>Cancelar</Button>
                <Button variant="danger" size="md" onClick={handleConfirmDeleteBlockWithActivities}>Eliminar bloque y actividades</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ---------- MODAL: CÓMO FUNCIONA ---------- */}
      <Modal isOpen={howtoOpen} onClose={() => setHowtoOpen(false)} title="¿Cómo funciona el Editor Visual?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--color-gray-700)' }}>
          <p>
            Cada tarjeta (nodo) representa un Proyecto, Juego, Actividad, Área o Colaborador real de Dicrejart.
            Puedes vincular uno ya existente o crear uno nuevo desde la paleta de la izquierda.
          </p>
          <p>
            <strong>El lienzo se auto-guarda en tiempo real en la nube.</strong> Un nodo nuevo (🆕) se crea en el sistema
            hasta que presionas &ldquo;Guardar en el Sistema&rdquo; en su panel derecho — ahí se valida que tenga las
            conexiones necesarias (por ejemplo, un Juego nuevo necesita estar conectado a un Proyecto y a al menos
            un Área antes de poder guardarse).
          </p>
          <p>
            Área es un catálogo cerrado de las 8 áreas de manufactura; nunca se crea una nueva desde aquí.
            Colaborador siempre se vincula a un Operario ya existente — para dar de alta gente nueva, usa la
            página de Operarios — pero sí puedes reasignarlo de área desde el panel derecho.
          </p>
          <p>
            El botón &ldquo;🗔 Abrir en Ventana Aparte&rdquo; abre este mismo editor en una ventana independiente, sin la barra lateral.
            Como ahora está conectado a Firebase, **cualquier cambio que realices en cualquiera de las dos ventanas se reflejará instantáneamente en la otra en tiempo real**.
          </p>
          <p>
            <strong>Navegación:</strong> arrastra el fondo para desplazarte, usa los botones de zoom (esquina inferior
            derecha del lienzo) o mantén presionado Ctrl/Cmd mientras giras la rueda del mouse para acercar/alejar hacia
            donde apunta el cursor. El zoom es solo tuyo — no se comparte con otras personas viendo el mismo lienzo.
            &ldquo;🔎 Buscar Nodo&rdquo; en el panel izquierdo centra la vista en cualquier nodo por nombre, y
            &ldquo;🧹 Reorganizar&rdquo; (solo Admin) reacomoda todos los nodos en una cuadrícula ordenada si el diagrama
            se volvió difícil de leer. &ldquo;📥 Exportar PNG&rdquo; descarga una imagen del lienzo completo tal como está,
            para compartirlo o imprimirlo fuera del sistema.
          </p>
          <p>
            <strong>📦 Bloque de Actividades</strong> es distinto a los demás nodos: al crearlo eliges un nombre y un área
            (de manufactura, o &ldquo;Diseño&rdquo;) — esa área se asigna automáticamente a cada actividad que agregues
            dentro. Haz clic en el cuerpo del bloque para desplegar su lista de actividades, donde puedes crear
            actividades nuevas (se registran de una vez en el sistema, igual que desde la página de Actividades) o
            enlazar unas que ya existían. Quitar una actividad del bloque no la borra del sistema, solo la desvincula
            de este lienzo.
          </p>
          <p>
            <strong>Asignar responsable a un Bloque:</strong> a diferencia de los demás campos de una actividad, el
            responsable NO se elige a mano al crearla — se asigna conectando con un cable un nodo{' '}
            <strong>Colaborador</strong> al Bloque (arrastra desde cualquiera de los dos puertos, en cualquier
            dirección). Toda actividad nueva que agregues después de conectar el cable se asigna automáticamente a
            ese colaborador; el botón &ldquo;🔗 Reasignar todas&rdquo; dentro del bloque aplica ese mismo colaborador a
            las actividades que ya existían antes de conectarlo. Quitar el cable (clic sobre la línea) deja al bloque
            sin responsable para las actividades que crees después.
          </p>
          <p>
            <strong>Adjuntos y links:</strong> al crear una actividad nueva dentro de un bloque puedes adjuntar
            archivos de referencia (imagen, PDF, DWG/DXF/STEP) o links de referencia — quedan guardados en la
            actividad real del sistema, visibles en la lista desplegable del bloque.
          </p>
          <p>
            <strong>🎬 Modelo del proyecto (Arquitectura/Diseño):</strong> además de los adjuntos de referencia, cada
            actividad tiene un campo separado para el plano (Arquitectura) o el modelo 3D — SolidWorks u otro (Diseño):
            sube el archivo o pega un link (ej. Drive). Si la actividad tiene un modelo cargado, aparece el botón
            &ldquo;🎬 Abrir Modelo&rdquo; en la lista del bloque. Por ahora ese botón solo abre el archivo/link tal
            cual — es la base para integrarlo más adelante con la aplicación de renderizado.
          </p>
        </div>
      </Modal>
    </motion.div>
  );
};

/**
 * Panel de inspección del nodo seleccionado: muestra datos reales (si ya existe) o
 * un formulario editable de borrador (si aún no se ha guardado en el sistema)
 */
const NodeInspector = ({
  node,
  entity,
  edges,
  findNode,
  nodeTitle,
  updateDraftField,
  onSaveProyecto,
  onSaveJuego,
  onSaveActividad,
  onAssignColaborador,
  getConnectedAreaNode,
  getConnectedColaboradorNode,
  actividades,
  operarios,
  proyectos = [],
  juegos = [],
  addProject,
  addGame,
  canEditDiagram,
  updateBlockField,
  updateBlockName,
  onSaveBlockName,
  openBlockActivityForm,
  handleReassignBlockActivities,
  dynamicAreas,
  allBlockAreas,
}) => {
  const meta = NODE_TYPES[node.type];
  const toast = useToast();

  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjClient, setNewProjClient] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjStartDate, setNewProjStartDate] = useState(getTodayLocalDateStr());
  const [newProjEndDate, setNewProjEndDate] = useState(getTodayLocalDateStr());
  const [newProjStatus, setNewProjStatus] = useState('diseno');

  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGameAreas, setNewGameAreas] = useState(['herreria', 'corte-laser']);
  const [newGameTargets, setNewGameTargets] = useState({ herreria: 10, 'corte-laser': 10 });

  const incoming = edges.filter((e) => e.to === node.id);
  const outgoing = edges.filter((e) => e.from === node.id);

  const handleToggleInspectorGameArea = (areaId) => {
    const isSelected = newGameAreas.includes(areaId);
    let nextAreas = isSelected ? newGameAreas.filter((id) => id !== areaId) : [...newGameAreas, areaId];
    const nextTargets = { ...newGameTargets };

    if (isSelected && areaId === 'corte-laser' && nextAreas.includes('herreria')) {
      nextAreas = nextAreas.filter((id) => id !== 'herreria');
      delete nextTargets['herreria'];
    }
    if (!isSelected && areaId === 'herreria' && !nextAreas.includes('corte-laser')) {
      nextAreas.push('corte-laser');
      nextTargets['corte-laser'] = nextTargets['corte-laser'] || 10;
    }

    if (isSelected) {
      delete nextTargets[areaId];
    } else {
      nextTargets[areaId] = nextTargets[areaId] || 10;
    }

    setNewGameAreas(nextAreas);
    setNewGameTargets(nextTargets);
  };

  const handleQuickCreateProject = async () => {
    if (!newProjName.trim() || !newProjClient.trim()) {
      toast.danger('Ingresa el Nombre del proyecto y el Cliente.');
      return;
    }
    const newId = await addProject({
      name: newProjName.trim(),
      client: newProjClient.trim(),
      description: newProjDesc.trim() || 'Sin descripción',
      startDate: newProjStartDate || getTodayLocalDateStr(),
      endDate: newProjEndDate || getTodayLocalDateStr(),
      status: newProjStatus || 'diseno',
    });
    if (newId) {
      updateBlockField('projectId', newId);
      setIsCreatingProj(false);
      setNewProjName('');
      setNewProjClient('');
      setNewProjDesc('');
      toast.success(`🗂️ Proyecto "${newProjName.trim()}" registrado y asignado.`);
    }
  };

  const handleQuickCreateGame = async () => {
    if (!newGameName.trim()) {
      toast.danger('Ingresa un nombre para el juego.');
      return;
    }
    let chosenAreas = newGameAreas.length > 0 ? newGameAreas : [node.areaId || 'herreria'];
    if (chosenAreas.includes('herreria') && !chosenAreas.includes('corte-laser')) {
      chosenAreas.push('corte-laser');
    }

    const targets = {};
    chosenAreas.forEach((ar) => {
      targets[ar] = Number(newGameTargets[ar]) || 10;
    });

    const projName = proyectos.find((p) => p.id === node.projectId)?.name || 'General';
    const newId = await addGame({
      name: newGameName.trim(),
      projectName: projName,
      projectId: node.projectId || null,
      areas: chosenAreas,
      targetPieces: targets,
    });
    if (newId) {
      updateBlockField('gameId', newId);
      setIsCreatingGame(false);
      setNewGameName('');
      toast.success(`🎮 Juego "${newGameName.trim()}" registrado y asignado.`);
    }
  };

  return (
    <>
      <p className={styles.inspectorEyebrow}>{meta.label}</p>
      <h2 className={styles.inspectorTitle}>{nodeTitle(node)}</h2>

      {node.draft && node.type === 'proyecto' && (
        <>
          <div className={styles.field}>
            <label>Nombre</label>
            <input type="text" value={node.draftFields.name} disabled={!canEditDiagram} onChange={(e) => updateDraftField('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Cliente</label>
            <input type="text" value={node.draftFields.client} disabled={!canEditDiagram} onChange={(e) => updateDraftField('client', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Estado</label>
            <select value={node.draftFields.status} disabled={!canEditDiagram} onChange={(e) => updateDraftField('status', e.target.value)}>
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveProyecto}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {node.draft && node.type === 'juego' && (
        <>
          <div className={styles.field}>
            <label>Nombre</label>
            <input type="text" value={node.draftFields.name} disabled={!canEditDiagram} onChange={(e) => updateDraftField('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Meta de Piezas por Área</label>
            <input type="number" min="1" value={node.draftFields.meta_piezas} disabled={!canEditDiagram} onChange={(e) => updateDraftField('meta_piezas', e.target.value)} />
          </div>
          <div className={styles.calloutBox} style={{ background: 'rgba(0, 153, 204, 0.08)', border: '1px solid rgba(0, 153, 204, 0.25)' }}>
            Conecta este Juego a un <strong>Proyecto</strong> y a al menos un <strong>Área</strong> antes de guardar.
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveJuego} style={{ marginTop: '10px' }}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {node.draft && node.type === 'actividad' && (
        <>
          <div className={styles.field}>
            <label>Título</label>
            <input type="text" value={node.draftFields.title} disabled={!canEditDiagram} onChange={(e) => updateDraftField('title', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Descripción</label>
            <textarea rows="3" value={node.draftFields.description} disabled={!canEditDiagram} onChange={(e) => updateDraftField('description', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Prioridad</label>
            <select value={node.draftFields.priority} disabled={!canEditDiagram} onChange={(e) => updateDraftField('priority', e.target.value)}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Fecha Límite</label>
            <input type="date" value={node.draftFields.dueDate} disabled={!canEditDiagram} onChange={(e) => updateDraftField('dueDate', e.target.value)} />
          </div>
          <div className={styles.calloutBox} style={{ background: 'rgba(255, 204, 0, 0.12)', border: '1px solid rgba(255, 204, 0, 0.35)' }}>
            Conecta esta Actividad a un <strong>Área</strong> antes de guardar (el Colaborador responsable es opcional).
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveActividad} style={{ marginTop: '10px' }}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {!node.draft && entity && node.type === 'proyecto' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Cliente</label><input type="text" value={entity.client || ''} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Progreso</label><input type="text" value={`${entity.progress ?? 0}%`} disabled /></div>
        </>
      )}

      {!node.draft && entity && node.type === 'juego' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Proyecto</label><input type="text" value={entity.projectName} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Progreso</label><input type="text" value={`${entity.progress ?? 0}%`} disabled /></div>
          {(entity.areas || [])
            .filter((areaId) => isAreaBlockedBySequence(entity, areaId))
            .map((areaId) => {
              const requiredAreaId = AREA_SEQUENCE_DEPENDENCIES[areaId];
              const requiredAreaName = dynamicAreas.find((a) => a.id === requiredAreaId)?.name;
              const blockedAreaName = dynamicAreas.find((a) => a.id === areaId)?.name;
              const produced = entity.producedPieces?.[requiredAreaId] || 0;
              const target = entity.targetPieces?.[requiredAreaId] || 0;
              return (
                <div key={areaId} className={styles.calloutBox} style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                  🔒 <strong>{blockedAreaName}</strong> bloqueada: espera a que <strong>{requiredAreaName}</strong>{' '}
                  complete su meta ({produced}/{target} pzas).
                </div>
              );
            })}

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Manufactura por Área</p>
          <div className={styles.areaStatusList}>
            {[...(entity.areas || []), 'producto-terminado'].map((areaId) => {
              const areaName = areaId === 'producto-terminado'
                ? 'Producto Terminado'
                : dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
              const produced = entity.producedPieces?.[areaId] || 0;
              const target = entity.targetPieces?.[areaId] || 0;
              const areaStat = entity.areaStatus?.[areaId] || 'pendiente';
              const delivery = entity.areaDeliveryStatus?.[areaId] || 'pendiente';
              const quality = entity.qualityReview?.[areaId]?.status;
              return (
                <div key={areaId} className={styles.areaStatusRow}>
                  <strong>{areaName}</strong>
                  <div className={styles.areaStatusMeta}>
                    <span>{produced}/{target} pzas</span>
                    <span>· {areaStat}</span>
                    {areaId !== 'producto-terminado' && (
                      <span style={{ color: quality === 'aprobado' ? 'var(--color-tiffany-blue)' : quality === 'rechazado' ? 'var(--color-alert)' : 'var(--color-gray-500)' }}>
                        · Calidad: {quality === 'aprobado' ? '✅ Aprobado' : quality === 'rechazado' ? '❌ Rechazado' : '⏳ Pendiente'}
                      </span>
                    )}
                    {delivery !== 'pendiente' && <span>· Entrega PT: {delivery.replace('_', ' ')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'actividad' && (
        <>
          <div className={styles.field}><label>Título</label><input type="text" value={entity.title} disabled /></div>
          <div className={styles.field}><label>Área</label><input type="text" value={dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Prioridad</label><input type="text" value={entity.priority} disabled /></div>
          <div className={styles.field}>
            <label>Responsable</label>
            <input type="text" value={operarios.find((o) => o.id === entity.operarioId)?.name || 'Sin asignar'} disabled />
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'area' && (
        <div className={styles.field}><label>Nombre del Área</label><input type="text" value={entity.name} disabled /></div>
      )}

      {!node.draft && entity && node.type === 'colaborador' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Área Actual</label><input type="text" value={dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea} disabled /></div>
          {(() => {
            const areaNode = getConnectedAreaNode(node.id);
            if (!areaNode) return null;
            const alreadyThere = areaNode.refId === entity.currentArea;
            return alreadyThere ? (
              <div className={styles.calloutBox} style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                ✅ Ya está asignado a esta área conectada.
              </div>
            ) : (
              canEditDiagram && (
                <Button variant="primary" size="md" onClick={() => onAssignColaborador(entity, areaNode)}>
                  🔁 Asignar a {dynamicAreas.find((a) => a.id === areaNode.refId)?.name}
                </Button>
              )
            );
          })()}

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Responsable De</p>
          {(() => {
            const asignadas = actividades.filter((a) => a.operarioId === entity.id);
            if (asignadas.length === 0) {
              return <span className={styles.emptyConns}>Sin actividades asignadas todavía.</span>;
            }
            return (
              <div className={styles.areaStatusList}>
                {asignadas.map((a) => (
                  <div key={a.id} className={styles.areaStatusRow}>
                    <strong>📌 {a.title}</strong>
                    <div className={styles.areaStatusMeta}>
                      <span>{dynamicAreas.find((ar) => ar.id === a.areaId)?.name || a.areaId}</span>
                      <span>· {a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {node.type === 'bloque' && (
        <>
          {/* Nombre del Nodo */}
          <div className={styles.field}>
            <label>Nombre del Nodo</label>
            <input
              type="text"
              value={node.blockName}
              disabled={!canEditDiagram}
              onChange={(e) => updateBlockName(e.target.value)}
              onBlur={onSaveBlockName}
            />
          </div>

          {/* 🗂️ Proyecto Ligado */}
          <div className={styles.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ margin: 0 }}>🗂️ Proyecto Ligado</label>
              {canEditDiagram && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setIsCreatingProj((prev) => !prev)}
                >
                  {isCreatingProj ? '✕ Usar existente' : '➕ Nuevo Proyecto'}
                </button>
              )}
            </div>
            {!isCreatingProj ? (
              <select
                value={node.projectId || ''}
                disabled={!canEditDiagram}
                onChange={(e) => {
                  updateBlockField('projectId', e.target.value);
                  updateBlockField('gameId', '');
                }}
              >
                <option value="">Sin proyecto asignado...</option>
                {proyectos.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
                ))}
              </select>
            ) : (
              <div className={styles.inlineCreateBox}>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Nombre *</label>
                    <input
                      type="text"
                      placeholder="Nombre..."
                      value={newProjName}
                      onChange={(e) => setNewProjName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Cliente *</label>
                    <input
                      type="text"
                      placeholder="Cliente..."
                      value={newProjClient}
                      onChange={(e) => setNewProjClient(e.target.value)}
                    />
                  </div>
                </div>
                <div className={styles.createGrid2}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Inicio</label>
                    <input
                      type="date"
                      value={newProjStartDate}
                      onChange={(e) => setNewProjStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Fecha Entrega</label>
                    <input
                      type="date"
                      value={newProjEndDate}
                      onChange={(e) => setNewProjEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Descripción</label>
                  <textarea
                    rows="2"
                    placeholder="Descripción..."
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                  />
                </div>
                <Button variant="primary" size="sm" onClick={handleQuickCreateProject} style={{ alignSelf: 'flex-start' }}>
                  💾 Guardar y Asignar
                </Button>
              </div>
            )}
          </div>

          {/* 🎮 Juego Ligado */}
          <div className={styles.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ margin: 0 }}>🎮 Juego Ligado</label>
              {canEditDiagram && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setIsCreatingGame((prev) => !prev)}
                >
                  {isCreatingGame ? '✕ Usar existente' : '➕ Nuevo Juego'}
                </button>
              )}
            </div>
            {!isCreatingGame ? (
              <select
                value={node.gameId || ''}
                disabled={!canEditDiagram}
                onChange={(e) => updateBlockField('gameId', e.target.value)}
              >
                <option value="">Sin juego asignado...</option>
                {juegos
                  .filter((j) => !node.projectId || j.projectId === node.projectId || j.projectName === proyectos.find((p) => p.id === node.projectId)?.name)
                  .map((j) => (
                    <option key={j.id} value={j.id}>{j.name} ({j.projectName || 'General'})</option>
                  ))}
              </select>
            ) : (
              <div className={styles.inlineCreateBox}>
                <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>Nombre del Modelo / Juego *</label>
                <input
                  type="text"
                  placeholder="Ej. Resbaladilla Acero Inox..."
                  value={newGameName}
                  onChange={(e) => setNewGameName(e.target.value)}
                />

                <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginTop: '4px', marginBottom: '2px' }}>
                  Áreas de Manufactura Requeridas:
                </label>
                <div className={styles.areasGridPills}>
                  {dynamicAreas.map((a) => {
                    const isSelected = newGameAreas.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                        onClick={() => handleToggleInspectorGameArea(a.id)}
                      >
                        {isSelected ? '✓' : '＋'} {a.name}
                      </button>
                    );
                  })}
                </div>

                {newGameAreas.length > 0 && (
                  <div className={styles.areaTargetsList}>
                    <label style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '2px' }}>
                      Metas de piezas por área:
                    </label>
                    {newGameAreas.map((areaId) => {
                      const aName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
                      return (
                        <div key={areaId} className={styles.areaTargetItem}>
                          <span>🏭 {aName}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '70px', padding: '3px 6px', fontSize: '12px' }}
                              value={newGameTargets[areaId] ?? 10}
                              onChange={(e) => {
                                const val = e.target.value;
                                setNewGameTargets((prev) => ({ ...prev, [areaId]: val }));
                              }}
                            />
                            <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>pzas</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Button variant="primary" size="sm" onClick={handleQuickCreateGame} style={{ alignSelf: 'flex-start', marginTop: '4px' }}>
                  💾 Guardar y Asignar
                </Button>
              </div>
            )}
          </div>

          {/* 🏭 Área Asignada */}
          <div className={styles.field}>
            <label>🏭 Área Asignada</label>
            <select
              value={node.areaId || ''}
              disabled={!canEditDiagram}
              onChange={(e) => updateBlockField('areaId', e.target.value)}
            >
              <option value="">Seleccionar área...</option>
              <optgroup label="🏭 Áreas de manufactura">
                {dynamicAreas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
              <optgroup label="✏️ Otras áreas">
                {NON_PRODUCTION_AREAS.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* 👷 Colaborador Responsable */}
          <div className={styles.field}>
            <label>👷 Colaborador Responsable</label>
            <select
              value={node.operarioId || ''}
              disabled={!canEditDiagram}
              onChange={(e) => updateBlockField('operarioId', e.target.value)}
            >
              <option value="">Sin asignar (o conectar por cable)</option>
              {operarios.map((o) => {
                const areaName = dynamicAreas.find((a) => a.id === o.currentArea)?.name || o.currentArea;
                return (
                  <option key={o.id} value={o.id}>{o.name} — {areaName}</option>
                );
              })}
            </select>
            {(() => {
              const colaboradorNode = getConnectedColaboradorNode?.(node.id);
              const directOperario = operarios.find((o) => o.id === node.operarioId);
              const currentResponsable = directOperario?.name || (colaboradorNode ? nodeTitle(colaboradorNode) : null);
              if (currentResponsable && canEditDiagram && (node.activityIds || []).length > 0) {
                return (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleReassignBlockActivities?.(colaboradorNode)}
                    style={{ marginTop: '6px', width: '100%', fontSize: '11px' }}
                  >
                    🔗 Reasignar {(node.activityIds || []).length} actividades a {currentResponsable}
                  </Button>
                );
              }
              return null;
            })()}
          </div>

          {/* 📌 Actividades del Bloque */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <p className={styles.inspectorEyebrow} style={{ margin: 0 }}>
                Actividades ({(node.activityIds || []).length})
              </p>
              {canEditDiagram && (
                <Button variant="primary" size="sm" onClick={openBlockActivityForm}>
                  ➕ Nueva Actividad
                </Button>
              )}
            </div>

            {(node.activityIds || []).length === 0 ? (
              <span className={styles.emptyConns}>Sin actividades agregadas en este nodo.</span>
            ) : (
              <div className={styles.areaStatusList}>
                {(node.activityIds || []).map((actId) => {
                  const act = actividades.find((a) => a.id === actId);
                  if (!act) return null;
                  const responsable = operarios.find((o) => o.id === act.operarioId)?.name;
                  return (
                    <div key={actId} className={styles.areaStatusRow}>
                      <strong>📌 {act.title}</strong>
                      <div className={styles.areaStatusMeta}>
                        <span>{act.status}</span>
                        <span>· {act.priority}</span>
                        {responsable && <span>· 👷 {responsable}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!node.draft && !entity && node.type !== 'bloque' && (
        <p style={{ fontSize: '12.5px', color: 'var(--color-alert)' }}>Este registro ya no existe.</p>
      )}

      <div className={styles.calloutBox} style={{ marginTop: '18px', background: 'rgba(255, 51, 0, 0.06)', border: '1px solid rgba(255, 51, 0, 0.2)' }}>
        <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--color-primary)' }}>Conexiones</strong>
        {incoming.length === 0 && outgoing.length === 0 && <span className={styles.emptyConns}>Sin conexiones todavía.</span>}
        {incoming.map((e) => {
          const other = findNode(e.from);
          return other ? (
            <div key={e.id} className={styles.connRow}><span className={styles.connArrow}>←</span><span>{NODE_TYPES[other.type].icon} {nodeTitle(other)}</span></div>
          ) : null;
        })}
        {outgoing.map((e) => {
          const other = findNode(e.to);
          return other ? (
            <div key={e.id} className={styles.connRow}><span className={styles.connArrow}>→</span><span>{NODE_TYPES[other.type].icon} {nodeTitle(other)}</span></div>
          ) : null;
        })}
      </div>
    </>
  );
};

EditorVisualPage.propTypes = {
  standalone: PropTypes.bool,
};

export default EditorVisualPage;
