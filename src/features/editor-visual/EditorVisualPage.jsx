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
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, updateDoc, onSnapshot, collection, deleteDoc, query, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import LienzoSwitcherModal from './LienzoSwitcherModal';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import useAuth from '../../hooks/useAuth';
import { sendSystemChatMessage } from '../../services/chatNotificationService';
import { uploadEvidenceFile, deleteNasFile } from '../../services/nasUploadService';
import { isAreaBlockedByRoute, getBlockingAreaForRoute } from '../../context/ProduccionContext';
import useAreas from '../../hooks/useAreas';
import { NON_PRODUCTION_AREAS } from '../../data/nonProductionAreasConfig';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { compressImage } from '../../utils/imageCompressor';
import { isReadOnlySection, canUserEditRoute, canUserEditProjectAudit } from '../../utils/roleAccess';
import RegisterDeliveryModal from './RegisterDeliveryModal';
import styles from './EditorVisualPage.module.css';

/** Dimensiones del Gran Espacio de Trabajo CAD (Inventor / SolidWorks style) */
const WORKSPACE_WIDTH = 20000;
const WORKSPACE_HEIGHT = 20000;
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
const PRESET_COLORS = [
  { name: 'Naranja Dicrejart', value: '#ea580c' },
  { name: 'Azul Zafiro', value: '#2563eb' },
  { name: 'Turquesa Menta', value: '#0d9488' },
  { name: 'Verde Esmeralda', value: '#16a34a' },
  { name: 'Púrpura Neón', value: '#9333ea' },
  { name: 'Ámbar Dorado', value: '#d97706' },
  { name: 'Rojo Carmesí', value: '#dc2626' },
  { name: 'Rosa Fucsia', value: '#db2777' },
  { name: 'Cian Profundo', value: '#0284c7' },
  { name: 'Grafito Oscuro', value: '#475569' },
];

const DEFAULT_NODE_META = {
  icon: '📦',
  label: 'Bloque de Trabajo',
  badgeText: 'BLOQUE',
  colorVar: '#ea580c',
  allowCreate: true,
};

const NODE_TYPES = {
  recurso: { icon: '📎', label: 'Ayuda Visual / Archivo', badgeText: 'AYUDA VISUAL', colorVar: '#06b6d4', allowCreate: true },
  proyecto: { icon: '🗂️', label: 'Proyecto', badgeText: 'PROYECTO', colorVar: '#2563eb', allowCreate: true },
  juego: { icon: '🎮', label: 'Juego / Modelo', badgeText: 'MODELO', colorVar: '#0d9488', allowCreate: true },
  actividad: { icon: '📌', label: 'Actividad', badgeText: 'ACTIVIDAD', colorVar: '#d97706', allowCreate: true },
  area: { icon: '🏭', label: 'Área de Taller', badgeText: 'TALLER', colorVar: '#6366f1', allowCreate: false },
  colaborador: { icon: '👷', label: 'Colaborador', badgeText: 'PERSONAL', colorVar: '#9333ea', allowCreate: false },
  bloque: { icon: '📦', label: 'Bloque de Trabajo', badgeText: 'BLOQUE', colorVar: '#ea580c', allowCreate: true },
  'auditoria-calidad': { icon: '🔍', label: 'Auditoría de Calidad', badgeText: 'AUDITORÍA', colorVar: '#dc2626', allowCreate: false },
};

const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const formatExternalUrl = (url) => {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

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
 * Trazo Bezier para previsualización durante arrastre manual desde un puerto
 */
const previewBezier = (p1, p2, dir1 = null) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const curvature = Math.max(25, Math.min(dist * 0.45, 140));
  const d = dir1 || (dx >= 0 ? { x: 1, y: 0 } : { x: -1, y: 0 });
  const cp1x = p1.x + d.x * curvature;
  const cp1y = p1.y + d.y * curvature;
  return `M ${p1.x} ${p1.y} Q ${cp1x} ${cp1y}, ${p2.x} ${p2.y}`;
};

/**
 * Extrae la metadata y la URL de imagen, documento, link o modelo CAD 3D (SolidWorks, Inventor, STEP, etc.)
 */
const getResourcePreviewInfo = (nodeOrDraft) => {
  if (!nodeOrDraft) {
    return { resType: 'imagen', previewImgSrc: null, rawUrl: '', fileName: '', fileSize: 0, isPdf: false, isModel: false, isLink: false, effectiveUrl: '' };
  }

  const fields = nodeOrDraft.draftFields || nodeOrDraft;
  const fileData = fields.fileData;
  const rawUrl = (fields.url || nodeOrDraft.url || '').trim();
  const explicitType = fields.resourceType || nodeOrDraft.resourceType;
  const resType = explicitType || (fileData ? 'imagen' : (rawUrl ? 'link' : 'imagen'));

  // 1. Archivo subido o local
  const fileUrl = fileData?.url || fileData?.dataUrl;
  const fileName = fileData?.name || '';
  const fileSize = fileData?.size || 0;
  const lowerFileName = (fileName || rawUrl).toLowerCase();

  // 2. Detección especializada de CAD (SolidWorks, Inventor, STEP, AutoCAD, SketchUp)
  let cadBrand = null;
  let cadLabel = null;
  let cadIcon = '🧊';
  let cadColor = '#0d9488';

  if (lowerFileName.match(/\.(sldprt|sldasm|slddrw)($|\?)/)) {
    cadBrand = 'solidworks';
    cadIcon = '🔴';
    cadColor = '#e11d48';
    cadLabel = lowerFileName.includes('.sldasm') ? 'Ensamblaje SolidWorks (.sldasm)' : lowerFileName.includes('.slddrw') ? 'Dibujo SolidWorks (.slddrw)' : 'Pieza SolidWorks (.sldprt)';
  } else if (lowerFileName.match(/\.(ipt|iam|idw)($|\?)/)) {
    cadBrand = 'inventor';
    cadIcon = '🟡';
    cadColor = '#d97706';
    cadLabel = lowerFileName.includes('.iam') ? 'Ensamblaje Inventor (.iam)' : lowerFileName.includes('.idw') ? 'Plano Inventor (.idw)' : 'Pieza Inventor (.ipt)';
  } else if (lowerFileName.match(/\.(step|stp)($|\?)/)) {
    cadBrand = 'step';
    cadIcon = '🧊';
    cadColor = '#0284c7';
    cadLabel = 'Modelo 3D ISO STEP (.step)';
  } else if (lowerFileName.match(/\.(dwg|dxf)($|\?)/)) {
    cadBrand = 'dwg';
    cadIcon = '📐';
    cadColor = '#2563eb';
    cadLabel = 'Plano CAD Técnico (.dwg/.dxf)';
  } else if (lowerFileName.match(/\.(skp)($|\?)/)) {
    cadBrand = 'sketchup';
    cadIcon = '🔴';
    cadColor = '#ea580c';
    cadLabel = 'Modelo 3D SketchUp (.skp)';
  } else if (lowerFileName.match(/\.(stl|obj|iges|igs|fbx|3ds|blend)($|\?)/)) {
    cadBrand = '3d';
    cadIcon = '🧊';
    cadColor = '#0d9488';
    cadLabel = 'Modelo 3D CAD';
  }

  // 3. Detección especializada de Enlaces (Google Drive, Figma, OneDrive, Autodesk Viewer)
  let linkProvider = null;
  let googleDriveImgSrc = null;
  let googleDriveFileId = null;

  if (rawUrl) {
    const driveMatch = rawUrl.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]{25,})/i);
    if (driveMatch && driveMatch[1]) {
      googleDriveFileId = driveMatch[1];
      googleDriveImgSrc = `https://lh3.googleusercontent.com/d/${googleDriveFileId}`;
      linkProvider = { name: 'Google Drive', icon: '📁', color: '#16a34a', isDrive: true };
    } else if (rawUrl.includes('figma.com')) {
      linkProvider = { name: 'Figma', icon: '🎨', color: '#a855f7', isFigma: true };
    } else if (rawUrl.includes('onedrive') || rawUrl.includes('1drv.ms') || rawUrl.includes('sharepoint.com')) {
      linkProvider = { name: 'OneDrive / Cloud', icon: '☁️', color: '#0284c7' };
    } else if (rawUrl.includes('autodesk') || rawUrl.includes('viewer.autodesk')) {
      linkProvider = { name: 'Autodesk Viewer 3D', icon: '📐', color: '#ea580c' };
    } else if (rawUrl.match(/(youtube\.com|youtu\.be|vimeo\.com|loom\.com)/i)) {
      linkProvider = { name: 'Video / Tutorial', icon: '▶️', color: '#dc2626' };
    } else {
      let cleanDomain = rawUrl.replace(/^https?:\/\//i, '').split('/')[0];
      linkProvider = { name: cleanDomain || 'Enlace Web', icon: '🌐', color: '#2563eb' };
    }
  }

  // 4. Distinción limpia: Archivo de Imagen subido vs Enlace Web/Nube
  const isUploadedImage = Boolean(
    fileData?.type?.startsWith('image/') ||
    fileUrl?.startsWith('data:image') ||
    (fileUrl && fileUrl.includes('firebasestorage.googleapis.com')) ||
    (fileData && lowerFileName.match(/\.(jpeg|jpg|png|webp|gif|svg|avif)($|\?)/i))
  );

  const isDirectImageLink = Boolean(
    rawUrl &&
    !linkProvider?.isDrive &&
    !linkProvider?.isFigma &&
    !rawUrl.includes('autodesk') &&
    (rawUrl.startsWith('data:image') || rawUrl.match(/\.(jpeg|jpg|png|webp|gif|svg|avif)($|\?)/i))
  );

  const isImage = (resType === 'imagen' && !rawUrl && !linkProvider) || isUploadedImage || isDirectImageLink;

  let previewImgSrc = null;
  if (isImage) {
    previewImgSrc = fileUrl || (isDirectImageLink ? rawUrl : null);
  }

  const isPdf = resType === 'documento' || fileData?.type?.includes('pdf') || lowerFileName.endsWith('.pdf') || lowerFileName.includes('.pdf?');
  const isModel = Boolean(cadBrand) || resType === 'modelo';
  const isLink = !isImage && !isPdf && !isModel && Boolean(rawUrl || linkProvider || resType === 'link');

  return {
    resType,
    previewImgSrc,
    rawUrl,
    fileUrl,
    fileName,
    fileSize,
    isPdf,
    isModel,
    cadBrand,
    cadLabel,
    cadIcon,
    cadColor,
    isLink,
    linkProvider,
    googleDriveFileId,
    effectiveUrl: fileUrl || rawUrl,
  };
};

/**
 * Coordenadas EXACTAS de los 4 puertos físicos (in, out, top, bottom) colocados en cualquier tipo de nodo
 */
const getNodePortCoords = (node, side, nodeSizes = {}) => {
  if (!node) return { x: 0, y: 0, dir: { x: 1, y: 0 }, side: side || 'out' };

  const info = node.type === 'recurso' ? getResourcePreviewInfo(node) : null;
  const isLinkResource = node.type === 'recurso' && Boolean(
    info?.isLink ||
    node.draftFields?.resourceType === 'link' ||
    (node.draftFields?.url && !node.draftFields?.fileData && !node.draftFields?.url?.match(/\.(jpeg|jpg|png|webp|gif|svg|avif)($|\?)/i))
  );
  const isImageResource = node.type === 'recurso' && !isLinkResource && Boolean(
    info?.previewImgSrc ||
    node.draftFields?.resourceType === 'imagen' ||
    node.draftFields?.fileData?.dataUrl ||
    node.draftFields?.fileData?.url
  );

  // 1. Caso: Emblema de enlace flotante (círculo 68x68 centrado horizontalmente en 140px)
  if (isLinkResource) {
    const cx = node.x + 70;
    const cy = node.y + 34;
    const r = 34;
    switch (side) {
      case 'in':
        return { x: cx - r, y: cy, dir: { x: -1, y: 0 }, side: 'in' };
      case 'out':
        return { x: cx + r, y: cy, dir: { x: 1, y: 0 }, side: 'out' };
      case 'top':
        return { x: cx, y: cy - r, dir: { x: 0, y: -1 }, side: 'top' };
      case 'bottom':
        return { x: cx, y: cy + r, dir: { x: 0, y: 1 }, side: 'bottom' };
      default:
        return { x: cx + r, y: cy, dir: { x: 1, y: 0 }, side: 'out' };
    }
  }

  // 2. Caso: Tarjeta de imagen o Tarjeta estándar de nodo
  const measured = nodeSizes[node.id];
  const width = measured?.width || (isImageResource ? 230 : NODE_WIDTH);
  const height = measured?.height || (isImageResource ? 180 : (node.type === 'bloque' ? 140 : node.type === 'actividad' ? 120 : 100));

  switch (side) {
    case 'in':
      return { x: node.x, y: node.y + height / 2, dir: { x: -1, y: 0 }, side: 'in' };
    case 'out':
      return { x: node.x + width, y: node.y + height / 2, dir: { x: 1, y: 0 }, side: 'out' };
    case 'top':
      return { x: node.x + width / 2, y: node.y, dir: { x: 0, y: -1 }, side: 'top' };
    case 'bottom':
      return { x: node.x + width / 2, y: node.y + height, dir: { x: 0, y: 1 }, side: 'bottom' };
    default:
      return { x: node.x + width, y: node.y + height / 2, dir: { x: 1, y: 0 }, side: 'out' };
  }
};

/**
 * Obtiene los 4 puertos oficiales del nodo
 */
const getAllNodePorts = (node, nodeSizes) => {
  return ['in', 'out', 'top', 'bottom'].map((s) => getNodePortCoords(node, s, nodeSizes));
};

/**
 * Genera el trazo de cable conectando SIEMPRE los puntos físicos de los puertos colocados en los nodos (arriba, abajo, izquierda, derecha).
 * A medida que los nodos se mueven o cambian de posición en el lienzo, la conexión se adapta automáticamente seleccionando el par de
 * puertos más natural, limpio y directo entre los 4 puertos físicos reales de cada nodo.
 */
const getSmartWirePath = (fromNode, toNode, edge = null, nodeSizes = {}) => {
  if (!fromNode || !toNode) return { path: '', p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };

  // Siempre evaluamos dinámicamente los 4 puertos físicos de cada nodo según sus posiciones actuales
  const fromPorts = getAllNodePorts(fromNode, nodeSizes);
  const toPorts = getAllNodePorts(toNode, nodeSizes);

  let bestPair = null;
  let minScore = Infinity;

  fromPorts.forEach((fp) => {
    toPorts.forEach((tp) => {
      const dx = tp.x - fp.x;
      const dy = tp.y - fp.y;
      const dist = Math.hypot(dx, dy);

      const len = Math.max(1, dist);
      const nx = dx / len;
      const ny = dy / len;

      // Dirección de salida del puerto fp y entrada a tp
      const dotFrom = fp.dir.x * nx + fp.dir.y * ny;
      const dotTo = tp.dir.x * (-nx) + tp.dir.y * (-ny);

      // Penalizamos fuertemente si el puerto apunta en sentido contrario al cable
      const penaltyFrom = dotFrom < 0 ? (1 - dotFrom) * 260 : (1 - dotFrom) * 30;
      const penaltyTo = dotTo < 0 ? (1 - dotTo) * 260 : (1 - dotTo) * 30;

      const score = dist + penaltyFrom + penaltyTo;

      if (score < minScore) {
        minScore = score;
        bestPair = { p1: fp, p2: tp };
      }
    });
  });

  const p1 = bestPair ? bestPair.p1 : fromPorts[1]; // puerto físico origen
  const p2 = bestPair ? bestPair.p2 : toPorts[0];   // puerto físico destino

  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const curvature = Math.max(20, Math.min(dist * 0.42, 130));

  const cp1x = p1.x + p1.dir.x * curvature;
  const cp1y = p1.y + p1.dir.y * curvature;
  const cp2x = p2.x + p2.dir.x * curvature;
  const cp2y = p2.y + p2.dir.y * curvature;

  const path = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  return { path, p1, p2, fromPort: p1.side, toPort: p2.side };
};

/**
 * Sube un archivo a Firebase Storage con compresión automática para imágenes,
 * incluyendo fallback ligero transparente (< 30KB) si la red o Storage presentaran intermitencia.
 */
const uploadResourceFile = async (file, lienzoId = 'general') => {
  if (!file) return null;
  const isImage = file.type?.startsWith('image/');
  let toUpload = file;
  let compressedBase64 = null;

  if (isImage) {
    try {
      toUpload = await compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.85 });
      // Versión ultraligera (~20KB) para garantizar persistencia y vista inmediata en cualquier escenario
      const thumbBlob = await compressImage(file, { maxWidth: 720, maxHeight: 720, quality: 0.65 });
      compressedBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(thumbBlob);
      });
    } catch (e) {
      console.warn('Compresión falló, subiendo original:', e);
      toUpload = file;
    }
  }

  const safeName = (file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `lienzos_recursos/${lienzoId}/${Date.now()}_${safeName}`;

  if (storage) {
    try {
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, toUpload);
      const downloadUrl = await getDownloadURL(fileRef);

      return {
        name: file.name,
        size: file.size,
        type: file.type,
        url: downloadUrl,
        storagePath: path,
        isUploading: false,
      };
    } catch (storageErr) {
      console.warn('Fallo subida a Firebase Storage, usando respaldo optimizado:', storageErr);
      if (compressedBase64) {
        return {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: compressedBase64,
          url: compressedBase64,
          isUploading: false,
        };
      }
    }
  }

  // Fallback si no hay storage o si no es imagen pero se quiere guardar metadata
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    dataUrl: compressedBase64 || null,
    url: compressedBase64 || '',
    isUploading: false,
  };
};

/**
 * Componente EditorVisualPage - Editor visual tipo grafo para crear/relacionar entidades
 * @component
 * @returns {ReactElement}
 */
const EditorVisualPage = ({ standalone = false }) => {
  const navigate = useNavigate();
  const {
    proyectos, juegos, addProject, addGame, updateProject,
    setQualityVerdict, setQualityVerdictEvidenceLink, assignQualityAudit, cancelQualityAudit,
    setQualityVerdictProject, setQualityVerdictEvidenceLinkProject, assignQualityAuditProject, cancelQualityAuditProject,
  } = useProduccion();
  const { actividades, addActividad, updateActividad, deleteActividad, advanceStatus } = useActividades();
  const { operarios, assignToArea } = useOperarios();
  const { areas: dynamicAreas } = useAreas();
  const allBlockAreas = useMemo(() => [...dynamicAreas, ...NON_PRODUCTION_AREAS], [dynamicAreas]);

  // Catálogo completo de Áreas disponibles (Manufactura + Técnicas: Supervisión, Arquitectura, Diseño)
  const allAvailableAreas = useMemo(() => {
    const map = new Map();
    (dynamicAreas || []).forEach((a) => {
      map.set(a.id, { id: a.id, name: a.name, icon: a.icon || '🏭' });
    });
    NON_PRODUCTION_AREAS.forEach((a) => {
      if (!map.has(a.id)) {
        map.set(a.id, { id: a.id, name: a.name, icon: a.icon || '📋' });
      }
    });
    return Array.from(map.values());
  }, [dynamicAreas]);

  const { user, users } = useAuth();

  // Padrón unificado de colaboradores: Operarios de planta + Usuarios del sistema (supervisores, arquitectura, diseño, calidad, etc.)
  const allCollaborators = useMemo(() => {
    const list = [];
    const seenIds = new Set();

    // A. Operarios
    (operarios || []).forEach((op) => {
      if (!seenIds.has(op.id)) {
        seenIds.add(op.id);
        list.push({
          id: op.id,
          name: op.name,
          area: op.currentArea || op.homeArea || op.area || op.areaId || '',
          areas: op.areas || (op.currentArea ? [op.currentArea] : []),
          puesto: op.puesto || 'Operario de Planta',
          roleType: op.roleType || 'operario',
          isUser: false,
        });
      }
    });

    // B. Usuarios del sistema
    (users || []).forEach((u) => {
      if (!seenIds.has(u.id)) {
        seenIds.add(u.id);
        const uArea = u.areaId || u.area || (u.areaIds && u.areaIds[0]) || '';
        list.push({
          id: u.id,
          name: u.name || u.displayName || u.email,
          area: uArea,
          areas: u.areaIds || (uArea ? [uArea] : []),
          puesto: u.roleLabel || u.roleType || 'Personal Técnico/Admin',
          roleType: u.roleType || 'user',
          isUser: true,
        });
      }
    });

    return list;
  }, [operarios, users]);

  // Filtrado flexible de colaboradores para un área específica
  const getCollaboratorsForArea = useCallback((areaId) => {
    if (!areaId) return allCollaborators;
    const target = String(areaId).toLowerCase().trim();

    return allCollaborators.filter((c) => {
      const cArea = String(c.area || '').toLowerCase().trim();
      const cRole = String(c.roleType || c.puesto || '').toLowerCase().trim();
      const cAreas = (c.areas || []).map((a) => String(a).toLowerCase().trim());

      // Coincidencia directa
      if (cArea === target || cRole === target || cAreas.includes(target)) return true;

      // Coincidencias por sinonimia técnica
      if (target === 'supervision' && (cRole.includes('supervis') || cRole.includes('encargad') || cArea.includes('supervis'))) return true;
      if (target === 'diseno' && (cRole.includes('dise') || cArea.includes('dise'))) return true;
      if (target === 'arquitectura' && (cRole.includes('arqui') || cArea.includes('arqui'))) return true;
      if (target === 'calidad' && (cRole.includes('calidad') || cArea.includes('calidad'))) return true;
      if (target === 'corte-laser' && (cArea.includes('laser') || cRole.includes('laser'))) return true;
      if (target === 'herreria' && (cArea.includes('herreria') || cArea.includes('soldadura') || cRole.includes('herrero') || cRole.includes('soldador'))) return true;
      if (target === 'carpinteria' && (cArea.includes('carpinter') || cRole.includes('carpinter'))) return true;

      return false;
    });
  }, [allCollaborators]);

  const toast = useToast();

  // ============================================
  // LIENZO GENERAL MULTI-PROYECTO
  // Un solo lienzo unificado donde residen todos los proyectos
  // ============================================
  const [isLeftRailOpen, setIsLeftRailOpen] = useState(false);
  // Sin id en la URL cae en 'general' — mismo comportamiento de siempre para quien no
  // usa lienzos adicionales (ver LienzoSwitcherModal.jsx para crear/elegir otros).
  const { lienzoId: lienzoIdParam } = useParams();
  const lienzoActivoId = lienzoIdParam || 'general';

  // Modal para confirmar vaciar todos los nodos del lienzo
  const [clearNodesConfirm, setClearNodesConfirm] = useState(false);

  // Modal para consultar tareas del área en el lienzo sin redirigir
  const [areaTasksModal, setAreaTasksModal] = useState({ isOpen: false, areaId: null, areaName: '' });

  // Modal para marcar una actividad como completada con notas de entrega
  const [completeModal, setCompleteModal] = useState({ isOpen: false, activityId: null, title: '', notes: '' });

  // Modal dedicado a capturar el link de evidencia de una actividad — la evidencia real
  // vive en el NAS local del taller (fuera de la app); aquí solo se guarda el enlace que
  // redirige a ella, mismo patrón que el campo de enlace NAS de Proyecto/Juego.
  // Independiente de iniciar/pausar/terminar, se puede usar en cualquier momento.
  const [evidenceModal, setEvidenceModal] = useState({ isOpen: false, activityId: null, title: '', linkInput: '' });
  const [evidenceUploading, setEvidenceUploading] = useState(false);

  // Modal de "Registrar Entrega" abierto directo desde una insignia de área en el nodo
  // Juego del lienzo libre — mismo componente que ya usa RutaFabricacionView.jsx, para no
  // duplicar esa lógica en dos lugares. Se guarda solo el gameId (no el objeto juego
  // completo) para que el juego pasado al modal siempre sea el más reciente de `juegos`,
  // igual que hace RutaFabricacionView.jsx, y no una copia congelada del momento del clic.
  const [deliveryModal, setDeliveryModal] = useState({ isOpen: false, gameId: null, areaId: null, areaLabel: '' });

  // Borrador del motivo de "No Cumple" del nodo semáforo de Auditoría de Calidad,
  // guardado por nodeId — no puede ser un useState suelto porque se usa dentro de
  // nodes.map(), donde no se pueden declarar hooks condicionalmente por iteración.
  const [auditReasonDrafts, setAuditReasonDrafts] = useState({});
  // Borrador del enlace de evidencia (NAS) del semáforo, por nodeId — mismo motivo que
  // auditReasonDrafts: no puede ser un useState suelto dentro de nodes.map().
  const [auditEvidenceDrafts, setAuditEvidenceDrafts] = useState({});
  // Sube-en-curso del archivo de evidencia del semáforo, por nodeId — mismo motivo que auditEvidenceDrafts.
  const [auditEvidenceUploading, setAuditEvidenceUploading] = useState({});
  // Nodos de Auditoría de Calidad expandidos (mostrando área/juego, botones y notas) —
  // colapsados por defecto, solo el semáforo, para que el lienzo no se sature.
  const [expandedAuditNodes, setExpandedAuditNodes] = useState(() => new Set());
  const toggleAuditExpanded = (nodeId) => {
    setExpandedAuditNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Modal para ver y ampliar Ayudas Visuales (Imágenes en alta resolución, PDFs, Modelos 3D y Enlaces)
  const [previewResourceModal, setPreviewResourceModal] = useState({
    isOpen: false,
    title: '',
    resourceType: 'imagen',
    url: '',
    notes: '',
  });

  // Modal para cambiar y personalizar color de un nodo o cable
  const [colorPickerModal, setColorPickerModal] = useState({
    isOpen: false,
    targetType: 'node',
    targetId: null,
    currentColor: '#ea580c',
  });

  /**
   * Cancela (si sigue pendiente sin resolver) la asignación de auditoría ligada a un
   * nodo semáforo, en cualquiera de los dos modos (Juego+Área o Proyecto sin Juego), y
   * notifica por chat directo a quien estaba asignado. Único punto que parsea `refId` —
   * antes `performDeleteNode` y "Vaciar Lienzo" lo hacían cada uno por su cuenta, y con
   * el prefijo `proyecto::` ambos habrían quedado rotos (tratando "proyecto" como si
   * fuera un gameId, sin cancelar ni avisar nada).
   */
  const cancelAuditForNode = async (node, contextLabel) => {
    if (!node?.refId) return null;
    const parts = node.refId.split('::');
    const isProject = parts[0] === 'proyecto';
    const res = isProject
      ? await cancelQualityAuditProject(parts[1])
      : await cancelQualityAudit(parts[0], parts[1]);
    if (res?.ok && res.canceledAssignee?.id) {
      const targetLabel = isProject
        ? `del Proyecto "${proyectos.find((p) => p.id === parts[1])?.name || parts[1]}" (sin Juego)`
        : `de la entrega de ${dynamicAreas.find((a) => a.id === parts[1])?.name || parts[1]} en "${juegos.find((j) => j.id === parts[0])?.name || parts[0]}"`;
      sendSystemChatMessage({
        targetUserId: res.canceledAssignee.id,
        targetUserName: res.canceledAssignee.name,
        text: `🚫 [Auditoría de Calidad Cancelada] ${contextLabel} la auditoría ${targetLabel} — ya no es necesario que la revises.`,
        senderId: user?.id || 'sistema',
        senderName: user?.name || 'Sistema Dicrejart',
        isGlobal: false,
      });
    }
    return res;
  };

  // Limpia / vacía todos los nodos del lienzo actual
  const handleClearCurrentCanvasNodes = () => {
    if (!canEditDiagram) return;
    // Antes de vaciar, cancelar (y avisar) cualquier semáforo de Auditoría de Calidad
    // que siga pendiente — "Vaciar Lienzo" no pasa por performDeleteNode/handleCloseNode
    // (borra todo de golpe), así que sin esto una auditoría asignada se quedaba
    // "huérfana" en Firestore sin que la persona asignada se enterara de que ya no
    // aplica.
    nodes
      .filter((n) => n.type === 'auditoria-calidad' && n.refId)
      .forEach((n) => cancelAuditForNode(n, 'Se vació el lienzo y se quitó'));

    setNodes([]);
    setEdges([]);
    saveToFirestore([], []);
    setClearNodesConfirm(false);
    toast.success('🧹 Lienzo vaciado. Todos los nodos fueron removidos.');
  };

  // Proyecto vinculado si el lienzo actual corresponde al ID de un proyecto
  const currentProject = useMemo(() => {
    return proyectos.find((p) => p.id === lienzoActivoId) || null;
  }, [proyectos, lienzoActivoId]);

  // Todos los miembros autenticados con acceso al editor pueden diseñar y guardar sus lienzos
  const canEditDiagram = Boolean(user);
  const isAdmin = user?.role === 'admin' || user?.roleType === 'admin' || user?.roleType === 'director';

  // Estado de sincronización en la nube ('saved' | 'saving' | 'error')
  const [saveStatus, setSaveStatus] = useState('saved');

  // ============================================
  // ESTADO DEL GRAFO
  // ============================================
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState(() => new Set());
  const [selectionBox, setSelectionBox] = useState(null);
  const selectionBoxRef = useRef(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
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

  // Qué nodos están "colapsados" — se guarda en el propio documento del lienzo
  // (`lienzos/{id}.collapsedNodeIds`, ver el listener de abajo y toggleNodeCollapsed),
  // así que se ve igual para cualquiera que abra este lienzo, no solo para quien colapsó.
  const [collapsedNodeIds, setCollapsedNodeIds] = useState(() => new Set());

  // Solo cuenta como "hijo" (se oculta al colapsar) el nodo del lado "to" del cable — el
  // "from" nunca se oculta a sí mismo ni hacia atrás. Si un cable apunta al revés de lo
  // esperado, se corrige con "⇄ Invertir dirección" en la barra del cable seleccionado
  // (reverseEdgeDirection), no cambiando esta función.
  const getDirectChildIds = useCallback((nodeId) => {
    const ids = new Set();
    edges.forEach((e) => {
      if (e.from === nodeId) ids.add(e.to);
    });
    return ids;
  }, [edges]);

  /**
   * "Grupo de colapso" de un nodo: él mismo + todos los que comparten su mismo padre
   * (nodo(s) del lado "from" de un cable que apunta a él) — el "mismo nivel" del que
   * habló el usuario. Un Proyecto con dos Juegos debajo: los dos Juegos son un grupo.
   * Ocho Actividades colgando del mismo Juego: las ocho son un grupo, sin importar su
   * tipo. Un nodo sin padre (raíz de todo, ej. un Proyecto) no tiene grupo — regresa
   * solo él mismo, para poder colapsarlo de forma independiente de sus propios hijos.
   */
  const getCollapseGroupIds = useCallback((nodeId) => {
    const parentIds = new Set(edges.filter((e) => e.to === nodeId).map((e) => e.from));
    if (parentIds.size === 0) return new Set([nodeId]);
    const group = new Set([nodeId]);
    edges.forEach((e) => {
      if (parentIds.has(e.from)) group.add(e.to);
    });
    return group;
  }, [edges]);

  // Colapsar oculta TODA la cadena que cuelga del ancla (en cascada, siguiendo la
  // dirección de los cables) — no solo el primer salto. Un nodo de la cadena solo se
  // oculta si TODOS sus cables de entrada vienen de un ancla colapsada o de otro nodo ya
  // oculto — si le sigue entrando un cable desde algo que sigue visible (una rama
  // compartida que no colapsaste), se queda visible, para no ocultar por accidente algo
  // que sigue siendo relevante en esa otra rama.
  const hiddenNodeIds = useMemo(() => {
    if (collapsedNodeIds.size === 0) return new Set();

    // 1. Alcance: todo lo alcanzable hacia adelante desde cualquier ancla colapsada
    const candidates = new Set();
    const visited = new Set(collapsedNodeIds);
    const queue = [...collapsedNodeIds];
    while (queue.length) {
      const current = queue.shift();
      edges.forEach((e) => {
        if (e.from === current && !visited.has(e.to)) {
          visited.add(e.to);
          candidates.add(e.to);
          queue.push(e.to);
        }
      });
    }

    // 2. De ese alcance, ocultar solo lo que quede completamente "cubierto" — sin ningún
    //    cable de entrada proveniente de un nodo que siga visible
    const hidden = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      candidates.forEach((nodeId) => {
        if (hidden.has(nodeId)) return;
        const incomingSources = edges.filter((e) => e.to === nodeId).map((e) => e.from);
        const fullyCovered = incomingSources.every((src) => collapsedNodeIds.has(src) || hidden.has(src));
        if (fullyCovered) {
          hidden.add(nodeId);
          changed = true;
        }
      });
    }
    return hidden;
  }, [collapsedNodeIds, edges]);

  const toggleNodeCollapsed = (nodeId) => {
    // Colapsa/expande TODO el grupo (el nodo + sus hermanos del mismo padre) a la vez —
    // así, por ejemplo, dos Juegos del mismo Proyecto se colapsan juntos en un solo clic,
    // y lo que ambos alimentan en común (ej. una Actividad de recepción compartida) sí
    // termina ocultándose, en vez de quedar a medias esperando que colapses cada uno por
    // separado. Cada nodo del grupo sigue siendo visible por su cuenta — solo se oculta
    // lo que cuelga de ellos (ver hiddenNodeIds).
    const groupIds = getCollapseGroupIds(nodeId);
    const willCollapse = !collapsedNodeIds.has(nodeId);
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev);
      groupIds.forEach((id) => {
        if (willCollapse) next.add(id);
        else next.delete(id);
      });
      // Escritura propia y ligera (no pasa por saveToFirestore/todo el arreglo de nodos y
      // cables) — así colapsar/expandir no compite por la misma escritura completa del
      // lienzo que ya usan mover nodos o conectar cables.
      if (db && lienzoActivoId) {
        setDoc(doc(db, 'lienzos', lienzoActivoId), { collapsedNodeIds: [...next] }, { merge: true }).catch((err) => {
          console.error('Error al guardar estado de colapso del nodo:', err);
        });
      }
      return next;
    });
  };

  // Si el nodo abierto en el Inspector queda oculto porque otro nodo se colapsó, cierra
  // el Inspector — no tiene caso seguir inspeccionando algo que ya no se ve.
  useEffect(() => {
    if (selectedNodeId && hiddenNodeIds.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, hiddenNodeIds]);

  const canvasWrapRef = useRef(null);
  const worldRef = useRef(null);
  const dragStateRef = useRef(null);
  // true justo después de soltar un nodo que sí se arrastró (no un clic estacionario) —
  // evita que el clic nativo del navegador, que dispara igual tras soltar, abra un enlace
  // o dispare otra acción de "clic simple" cuando en realidad se estaba moviendo el nodo.
  const justDraggedRef = useRef(false);
  // La cámara (worldOffset) solo se debe tomar de Firestore UNA vez, al abrir el lienzo —
  // no en cada actualización remota (ej. alguien colapsa un nodo, otro usuario mueve algo
  // en otra parte). Si se reaplicara siempre, cualquier escritura ajena "regresaba" la
  // vista al último worldOffset guardado, aunque el usuario ya hubiera hecho pan/zoom
  // desde entonces sin guardar (paneo/zoom no se persiste en cada movimiento).
  const hasAppliedInitialOffsetRef = useRef(false);
  const connectStateRef = useRef(null);
  const panStateRef = useRef(null);
  const nodeSizesRef = useRef({});
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
  // Marco delimitador del área de trabajo — oculto por defecto: en un lienzo con mucho
  // contenido estorba más de lo que orienta, se puede volver a mostrar con el botón.
  const [showWorkspaceBoundary, setShowWorkspaceBoundary] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');

  // 🗂️ Localizador y Filtro de Proyectos en el Lienzo
  const [focusedProjectId, setFocusedProjectId] = useState('');
  const [isIsolateProjectMode, setIsIsolateProjectMode] = useState(false);
  const [isCameraAnimating, setIsCameraAnimating] = useState(false);

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE CON RESPALDO LOCAL
  // ============================================
  useEffect(() => {
    if (!db || !lienzoActivoId) {
      setNodes([]);
      setEdges([]);
      setCollapsedNodeIds(new Set());
      return;
    }

    hasAppliedInitialOffsetRef.current = false;

    try {
      const unsubscribe = onSnapshot(
        doc(db, 'lienzos', lienzoActivoId),
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setNodes(data.nodes || []);
            setEdges(data.edges || []);
            // Compartido entre todos los que abren este lienzo — no es preferencia local.
            setCollapsedNodeIds(new Set(data.collapsedNodeIds || []));
            // Solo la primera vez que se abre este lienzo — ver hasAppliedInitialOffsetRef.
            if (data.worldOffset && !hasAppliedInitialOffsetRef.current) {
              setWorldOffset(data.worldOffset);
            }
            hasAppliedInitialOffsetRef.current = true;
            // Actualizar backup local con la versión de Firestore
            try {
              localStorage.setItem(
                `dicrejart_canvas_backup_${lienzoActivoId}`,
                JSON.stringify({
                  nodes: data.nodes || [],
                  edges: data.edges || [],
                  worldOffset: data.worldOffset || { x: 40, y: 30 },
                  collapsedNodeIds: data.collapsedNodeIds || [],
                  savedAt: Date.now(),
                })
              );
            } catch (_) {}
          } else {
            // Si el documento aún no existe en Firestore, verificar si hay un respaldo en localStorage
            const localBackup = localStorage.getItem(`dicrejart_canvas_backup_${lienzoActivoId}`);
            if (localBackup) {
              try {
                const parsed = JSON.parse(localBackup);
                if (parsed.nodes && parsed.nodes.length > 0) {
                  setNodes(parsed.nodes);
                  setEdges(parsed.edges || []);
                  setCollapsedNodeIds(new Set(parsed.collapsedNodeIds || []));
                  if (parsed.worldOffset) setWorldOffset(parsed.worldOffset);
                  return;
                }
              } catch (_) {}
            }
            setNodes([]);
            setEdges([]);
            setCollapsedNodeIds(new Set());
          }
        },
        (err) => {
          console.warn('Aviso leyendo lienzo activo:', err);
        }
      );
      return unsubscribe;
    } catch (e) {
      console.warn('Error en listener de lienzo activo:', e);
    }
  }, [lienzoActivoId]);

  // Lista de lienzos existentes (para el selector "🗂️ Lienzos" — ver LienzoSwitcherModal.jsx),
  // independiente del listener de arriba (que solo trae el lienzo activo).
  const [lienzosList, setLienzosList] = useState([]);
  const [isLienzoSwitcherOpen, setIsLienzoSwitcherOpen] = useState(false);

  useEffect(() => {
    if (!db) return undefined;
    const unsubscribe = onSnapshot(
      query(collection(db, 'lienzos'), orderBy('updatedAt', 'desc'), limit(50)),
      (snap) => {
        setLienzosList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.warn('Aviso leyendo lista de lienzos:', err)
    );
    return unsubscribe;
  }, []);

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
      if (node.type === 'auditoria-calidad') {
        const parts = (node.refId || '').split('::');
        if (parts[0] === 'proyecto') {
          const project = proyectos.find((p) => p.id === parts[1]);
          if (!project) return null;
          const verdict = project.qualityAuditProject || { status: 'pendiente', reviewedBy: null, reviewedAt: null, notes: '' };
          return { id: node.refId, mode: 'project', projectId: parts[1], project, ...verdict };
        }
        const [gameId, areaId] = parts;
        const game = juegos.find((j) => j.id === gameId);
        if (!game) return null;
        const verdict = game.qualityVerdict?.[areaId] || { status: 'pendiente', reviewedBy: null, reviewedAt: null, notes: '' };
        return { id: node.refId, mode: 'game', gameId, areaId, game, ...verdict };
      }
      return null;
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

  const nodeTitle = useCallback(
    (node) => {
      if (!node) return 'Sin nombre';
      if (node.type === 'recurso') {
        return node.draftFields?.title || node.title || 'Ayuda Visual / Archivo';
      }
      if (node.draft) return node.draftFields?.name || node.draftFields?.title || 'Sin nombre';
      const entity = getLinkedEntity(node);
      if (!entity) return '(no encontrado)';
      if (node.type === 'auditoria-calidad') {
        if (entity.mode === 'project') return `🔍 Auditoría — ${entity.project?.name || entity.projectId}`;
        const areaName = dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId;
        return `🔍 Auditoría — ${areaName}`;
      }
      return entity.name || entity.title || 'Sin nombre';
    },
    [getLinkedEntity, dynamicAreas]
  );

  /**
   * Obtiene el supervisor / encargado oficial de un área de manufactura
   */
  const getSupervisorForArea = useCallback(
    (areaId) => {
      if (!areaId) return { id: null, name: 'Supervisor de Área', role: 'Supervisor de Área' };
      const areaObj = dynamicAreas.find((a) => a.id === areaId);

      // 1. Buscar en usuarios registrados con rol supervisor-area o encargado-area
      const supervisorUser = (users || []).find(
        (u) =>
          u.status === 'activo' &&
          ((u.roleType === 'supervisor-area' && (u.areaIds || []).includes(areaId)) ||
           (u.roleType === 'encargado-area' && u.areaId === areaId))
      );
      if (supervisorUser) {
        return {
          id: supervisorUser.id,
          name: supervisorUser.name,
          role: supervisorUser.role || 'Supervisor de Área',
          email: supervisorUser.email,
        };
      }

      // 2. Buscar en plantilla de operarios con puesto de Supervisor o Encargado en esa área
      const supervisorOp = (operarios || []).find(
        (o) =>
          o.currentArea === areaId &&
          (o.puesto?.toLowerCase().includes('supervisor') || o.puesto?.toLowerCase().includes('encargado'))
      );
      if (supervisorOp) {
        return {
          id: supervisorOp.id,
          name: supervisorOp.name,
          role: supervisorOp.puesto || 'Supervisor de Área',
          email: supervisorOp.email || null,
        };
      }

      return {
        id: null,
        name: `Supervisor de ${areaObj?.name || areaId}`,
        role: 'Supervisor de Área',
        email: null,
      };
    },
    [dynamicAreas, users, operarios]
  );

  /**
   * Guarda de forma transparente el estado actual del lienzo en Firestore y en localStorage
   */
  const saveToFirestore = useCallback(async (newNodes, newEdges, newOffset) => {
    if (!db || !lienzoActivoId || !canEditDiagram) return;

    // Sanitizar nodos: si un recurso ya tiene url de Storage, remover dataUrl pesado para no inflar Firestore
    const sanitizedNodes = (newNodes || []).map((node) => {
      if (node.type === 'recurso') {
        const fileData = node.draftFields?.fileData;
        if (fileData?.url && fileData?.dataUrl) {
          const { dataUrl, ...restFileData } = fileData;
          return {
            ...node,
            draftFields: {
              ...node.draftFields,
              fileData: restFileData,
            },
          };
        }
      }
      return node;
    });

    // Respaldo inmediato en localStorage para evitar cualquier pérdida al recargar
    try {
      localStorage.setItem(
        `dicrejart_canvas_backup_${lienzoActivoId}`,
        JSON.stringify({
          nodes: sanitizedNodes,
          edges: newEdges,
          worldOffset: newOffset || worldOffset,
          savedAt: Date.now(),
        })
      );
    } catch (e) {
      console.warn('No se pudo guardar backup local:', e);
    }

    setSaveStatus('saving');
    try {
      // "name" NO va aquí a propósito: con múltiples lienzos, este autosave corre en
      // cada movimiento de nodo — si mandara un nombre fijo, pisaría el nombre real del
      // lienzo (asignado una sola vez al crearlo, ver LienzoSwitcherModal.jsx) apenas
      // alguien lo editara. Con {merge:true}, omitir la clave simplemente no la toca.
      await setDoc(doc(db, 'lienzos', lienzoActivoId), {
        nodes: sanitizedNodes,
        edges: newEdges,
        worldOffset: newOffset || worldOffset,
        updatedAt: new Date().toISOString(),
        lastSavedBy: user?.name || user?.email || 'Usuario',
      }, { merge: true });
      setSaveStatus('saved');
    } catch (e) {
      console.error('Error al guardar lienzo en Firestore:', e);
      setSaveStatus('error');
    }
  }, [lienzoActivoId, proyectos, worldOffset, canEditDiagram, user]);

  /**
   * Actualiza un campo de borrador de cualquier nodo y persiste de inmediato
   */
  const updateDraftField = useCallback((nodeId, field, value) => {
    setNodes((prevNodes) => {
      const nextNodes = prevNodes.map((n) => {
        if (n.id === nodeId) {
          const updatedDraft = { ...(n.draftFields || {}), [field]: value };
          return {
            ...n,
            draftFields: updatedDraft,
            ...(field === 'title' ? { title: value } : {}),
            ...(field === 'url' ? { url: value } : {}),
          };
        }
        return n;
      });
      saveToFirestore(nextNodes, edges);
      return nextNodes;
    });
  }, [edges, saveToFirestore]);

  /**
   * Recorre todas las conexiones existentes en el lienzo y sincroniza automáticamente
   * en Firestore cualquier actividad, proyecto o juego que esté conectado pero que aún
   * no tenga grabado su responsable, área o proyecto en la base de datos.
   */
  const handleReconcileCanvasAssignments = useCallback(async (showNotification = true) => {
    let syncedCount = 0;
    for (const edge of edges) {
      const fromNode = findNode(edge.from);
      const toNode = findNode(edge.to);
      if (!fromNode || !toNode) continue;

      const colabNode = fromNode.type === 'colaborador' ? fromNode : toNode.type === 'colaborador' ? toNode : null;
      const actNode = fromNode.type === 'actividad' ? fromNode : toNode.type === 'actividad' ? toNode : null;
      const recursoNode = fromNode.type === 'recurso' ? fromNode : toNode.type === 'recurso' ? toNode : null;
      const projNode = fromNode.type === 'proyecto' ? fromNode : toNode.type === 'proyecto' ? toNode : null;
      const areaNode = fromNode.type === 'area' ? fromNode : toNode.type === 'area' ? toNode : null;
      const gameNode = fromNode.type === 'juego' ? fromNode : toNode.type === 'juego' ? toNode : null;

      // 1. Colaborador ↔ Actividad
      if (colabNode && actNode && actNode.refId) {
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && act.operarioId !== colabNode.refId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              operarioId: colabNode.refId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { operarioId: colabNode.refId });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 2. Recurso / Ayuda Visual ↔ Actividad
      if (recursoNode && actNode && actNode.refId) {
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act) {
          // Si el recurso tiene URL o archivo, validar sincronización
          const resUrl = recursoNode.draftFields?.url;
          if (resUrl && !(act.links || []).includes(resUrl)) {
            try {
              const updatedLinks = [...(act.links || []), resUrl];
              await updateDoc(doc(db, 'actividades', act.id), {
                links: updatedLinks,
                updatedAt: new Date().toISOString(),
              });
              updateActividad(act.id, { links: updatedLinks });
              syncedCount++;
            } catch (e) {}
          }
        }
      }

      // 3. Área ↔ Actividad
      if (areaNode && actNode && actNode.refId) {
        const areaId = areaNode.refId;
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && areaId && act.areaId !== areaId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              areaId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { areaId });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 4. Proyecto ↔ Actividad
      if (projNode && actNode && actNode.refId) {
        const projId = projNode.refId;
        const projEntity = getLinkedEntity(projNode);
        const projName = projEntity?.name || nodeTitle(projNode);
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && projId && act.projectId !== projId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              projectId: projId,
              projectName: projName,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { projectId: projId, projectName: projName });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 5. Juego ↔ Actividad
      if (gameNode && actNode && actNode.refId) {
        const gameId = gameNode.refId;
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && gameId && act.gameId !== gameId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              gameId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { gameId });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 6. Actividad Predecesora ↔ Actividad Sucesora (Secuencia de Producción en Cascada)
      const fromActNode = fromNode?.type === 'actividad' ? fromNode : null;
      const toActNode = toNode?.type === 'actividad' ? toNode : null;
      if (fromActNode && toActNode && fromActNode.id !== toActNode.id) {
        const isFromPredecessor = fromActNode.x < toActNode.x - 10 || (edge.from === fromActNode.id && edge.to === toActNode.id);
        const predNode = isFromPredecessor ? fromActNode : toActNode;
        const succNode = isFromPredecessor ? toActNode : fromActNode;

        const predAct = actividades.find((a) => a.id === (predNode.refId || predNode.id));
        const succAct = actividades.find((a) => a.id === (succNode.refId || succNode.id));
        if (predAct && succAct && succAct.predecessorId !== predAct.id) {
          try {
            await updateDoc(doc(db, 'actividades', succAct.id), {
              predecessorId: predAct.id,
              predecessorTitle: predAct.title,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(succAct.id, { predecessorId: predAct.id, predecessorTitle: predAct.title });
            syncedCount++;
          } catch (e) {}
        }
      }
    }

    if (showNotification) {
      if (syncedCount > 0) {
        toast.success(`⚡ Sincronización completa: ${syncedCount} asignación(es) actualizadas en base de datos.`);
      } else {
        toast.info('✅ Todas las conexiones del lienzo ya están sincronizadas con la base de datos.');
      }
    }
    return syncedCount;
  }, [edges, actividades, findNode, getLinkedEntity, nodeTitle, updateActividad, toast]);

  /**
   * Guardado manual explícito por botón para dar confirmación visual al usuario
   */
  const handleManualSaveCanvas = useCallback(async () => {
    saveToFirestore(nodes, edges, worldOffset);
    const count = await handleReconcileCanvasAssignments(false);
    if (count > 0) {
      toast.success(`💾 Lienzo guardado y ${count} asignación(es) sincronizadas en Firestore.`);
    } else {
      toast.success('💾 Lienzo y conexiones guardados correctamente en la nube.');
    }
  }, [nodes, edges, worldOffset, saveToFirestore, handleReconcileCanvasAssignments, toast]);

  /**
   * Obtiene la(s) actividad(es) predecesora(s) directas de un nodo de actividad en el lienzo.
   * Una actividad predecesora es cualquier actividad conectada que precede en el flujo (origen del cable,
   * o situada antes en el diagrama).
   */
  const getActivityPredecessors = useCallback(
    (actNodeOrId) => {
      const actNode =
        typeof actNodeOrId === 'string'
          ? findNode(actNodeOrId) || nodes.find((n) => (n.refId || n.id) === actNodeOrId)
          : actNodeOrId;
      if (!actNode || actNode.type !== 'actividad') return [];

      const connectedEdges = edges.filter((e) => e.to === actNode.id || e.from === actNode.id);
      const predecessors = [];

      for (const edge of connectedEdges) {
        const otherNodeId = edge.to === actNode.id ? edge.from : edge.to;
        const otherNode = findNode(otherNodeId);
        // El semáforo de Auditoría de Calidad también cuenta como predecesor válido —
        // una actividad de recepción conectada río abajo de un semáforo debe esperar a
        // que ese semáforo diga "Cumple", igual que espera a que otra actividad se
        // complete (ver el criterio de "resuelto" más abajo en getActivityBlockStatus).
        if (!otherNode || (otherNode.type !== 'actividad' && otherNode.type !== 'auditoria-calidad')) continue;

        // Determinar si otherNode es predecesor:
        // 1. Si el cable se conectó de otherNode -> actNode
        // 2. O si otherNode está a la izquierda en el lienzo
        const isPredecessor =
          (edge.from === otherNode.id && edge.to === actNode.id) ||
          (otherNode.x < actNode.x - 10);

        if (isPredecessor) {
          const entity =
            getLinkedEntity(otherNode) ||
            actividades.find((a) => a.id === (otherNode.refId || otherNode.id));
          if (entity && !predecessors.some((p) => (p.entity?.id || p.node.id) === (entity.id || otherNode.id))) {
            predecessors.push({ node: otherNode, entity });
          }
        }
      }
      return predecessors;
    },
    [edges, nodes, findNode, getLinkedEntity, actividades]
  );

  /**
   * Determina si una actividad está bloqueada por secuencia (porque alguna actividad previa no está culminada)
   */
  const getActivityBlockStatus = useCallback(
    (actNodeOrId) => {
      const predecessors = getActivityPredecessors(actNodeOrId);
      if (!predecessors || predecessors.length === 0) {
        return { isBlocked: false, blockers: [], predecessors: [] };
      }

      // Filtrar aquellos predecesores que NO estén resueltos — el criterio de "resuelto"
      // depende del tipo: una actividad normal debe estar 'completado'; un semáforo de
      // Auditoría de Calidad debe estar en 'cumple' (no tiene checklist ni fases
      // intermedias, solo pendiente/cumple/no_cumple).
      const uncompletedBlockers = predecessors.filter((p) => {
        if (p.node.type === 'auditoria-calidad') {
          return p.entity?.status !== 'cumple';
        }
        const status = p.entity?.status;
        return status !== 'completado' && status !== 'hecho' && status !== 'completada';
      });

      if (uncompletedBlockers.length > 0) {
        const blockerNames = uncompletedBlockers
          .map((b) => b.entity?.title || nodeTitle(b.node) || 'Actividad previa')
          .join(', ');
        return {
          isBlocked: true,
          blockers: uncompletedBlockers,
          predecessors,
          reason: `Espera que culmine la actividad previa: "${blockerNames}"`,
        };
      }

      return { isBlocked: false, blockers: [], predecessors };
    },
    [getActivityPredecessors, nodeTitle]
  );

  /** Áreas de un Juego real que están bloqueadas por secuencia (ej. Herrería esperando Corte Láser) */
  const getBlockedAreas = useCallback(
    (gameEntity) => (gameEntity?.areas || []).filter((areaId) => isAreaBlockedByRoute(gameEntity, areaId)),
    []
  );

  /** Sanitiza URLs externas para prevenir rutas relativas erróneas */
  const formatExternalUrl = useCallback((url) => {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  }, []);

  const nodeSummary = useCallback(
    (node) => {
      if (node.type === 'recurso') {
        const resType = node.draftFields?.resourceType || 'imagen';
        const typeLabel = resType === 'imagen' ? '🖼️ Imagen/Render' : resType === 'documento' ? '📄 Documento PDF' : resType === 'link' ? '🔗 Enlace Web' : '🎬 Modelo 3D';
        const targetEdge = edges.find(
          (e) =>
            (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
            (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
        );
        const targetNode = targetEdge ? findNode(findNode(targetEdge.from)?.type === 'actividad' || findNode(targetEdge.from)?.type === 'proyecto' ? targetEdge.from : targetEdge.to) : null;
        const targetName = targetNode ? nodeTitle(targetNode) : null;

        const parts = [typeLabel];
        if (targetName) parts.push(`📌 Ligado a: ${targetName}`);
        if (node.draftFields?.fileData?.name) parts.push(`📎 ${node.draftFields.fileData.name}`);
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
        const colabEdge = edges.find(
          (e) =>
            (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
            (e.to === node.id && findNode(e.from)?.type === 'colaborador')
        );
        const connectedColabNode = colabEdge
          ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
          : null;
        const directOperario = operarios.find((o) => o.id === (entity?.operarioId || node?.operarioId || node?.draftFields?.operarioId));
        const responsable = directOperario?.name || (connectedColabNode ? nodeTitle(connectedColabNode) : null);
        return `Área: ${dynamicAreas.find((a) => a.id === entity?.areaId)?.name || entity?.areaId || 'General'} · ${entity?.status || 'pendiente'}${responsable ? ` · 👷 ${responsable}` : ''}`;
      }
      if (node.type === 'colaborador') return `Área actual: ${dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}`;
      if (node.type === 'area') return 'Área de manufactura';
      return '';
    },
    [getLinkedEntity, getBlockedAreas, proyectos, juegos, operarios, dynamicAreas, allBlockAreas, edges, findNode, nodeTitle]
  );
  // POSICIONES DE PUERTOS Y LÍNEAS
  // ============================================
  const portPos = useCallback((node, side) => {
    return getNodePortCoords(node, side, nodeSizesRef.current);
  }, []);

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
  // SELECCIÓN MÚLTIPLE Y ARRASTRE DE NODOS EN GRUPO / CLUSTER
  // ============================================

  /**
   * Obtiene todos los nodos conectados en red o cadena al nodo indicado (Cluster / Subgrafo completo)
   */
  const getConnectedClusterNodeIds = useCallback(
    (startNodeId) => {
      if (!startNodeId) return new Set();
      const cluster = new Set();
      const queue = [startNodeId];
      while (queue.length > 0) {
        const currId = queue.shift();
        if (cluster.has(currId)) continue;
        cluster.add(currId);
        const connectedEdges = edges.filter((e) => e.from === currId || e.to === currId);
        for (const edge of connectedEdges) {
          const neighborId = edge.from === currId ? edge.to : edge.from;
          if (!cluster.has(neighborId)) {
            queue.push(neighborId);
          }
        }
      }
      return cluster;
    },
    [edges]
  );

  const handleSelectConnectedCluster = useCallback(
    (nodeId) => {
      const targetId = nodeId || selectedNodeId;
      if (!targetId) return;
      const cluster = getConnectedClusterNodeIds(targetId);
      setSelectedNodeIds(cluster);
      toast.info(`📦 Grupo seleccionado: ${cluster.size} nodo(s) listos para mover en conjunto.`);
    },
    [selectedNodeId, getConnectedClusterNodeIds, toast]
  );

  const handleSelectAllNodes = useCallback(() => {
    const allIds = new Set(nodes.map((n) => n.id));
    setSelectedNodeIds(allIds);
    if (nodes.length > 0) setSelectedNodeId(nodes[0].id);
    toast.info(`📦 Todos los nodos seleccionados (${nodes.length}).`);
  }, [nodes, toast]);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const handleNodeMouseDown = (e, nodeId) => {
    // Si se presiona el botón central o la tecla espacio, no arrastra el nodo, sino el lienzo
    if (e.button === 1 || isSpacePressedRef.current) return;
    if (!canEditDiagram) return;
    if (
      e.target.closest('[data-role="port"]') ||
      e.target.closest('[data-role="close"]') ||
      e.target.closest('[data-role="collapse"]') ||
      e.target.closest('[data-role="block-panel"]')
    ) return;
    const node = findNode(nodeId);
    if (!node) return;

    let activeSelected = new Set(selectedNodeIds);

    // 1. Si sostiene Alt: Seleccionar toda la rama / cadena conectada de inmediato
    if (e.altKey) {
      activeSelected = getConnectedClusterNodeIds(nodeId);
      setSelectedNodeIds(activeSelected);
    }
    // 2. Si sostiene Shift o Ctrl: Conmutar selección múltiple
    else if (e.shiftKey || e.ctrlKey) {
      if (activeSelected.has(nodeId)) {
        activeSelected.delete(nodeId);
      } else {
        activeSelected.add(nodeId);
      }
      setSelectedNodeIds(new Set(activeSelected));
    }
    // 3. Clic normal:
    else {
      // Si el nodo clicado ya forma parte de una selección múltiple existente, conservamos el grupo para arrastrarlos juntos
      if (!activeSelected.has(nodeId)) {
        activeSelected = new Set([nodeId]);
        setSelectedNodeIds(activeSelected);
      }
    }

    setSelectedEdgeId(null);

    // Capturar posiciones iniciales de TODOS los nodos del grupo seleccionado para moverlos juntos
    const nodesMap = {};
    nodes.forEach((n) => {
      if (activeSelected.has(n.id)) {
        nodesMap[n.id] = { startX: n.x, startY: n.y };
      }
    });

    // Si algún nodo arrastrado está colapsado, arrastrar también toda su cadena oculta
    // (mismo criterio que hiddenNodeIds) para que conserve su posición relativa al
    // expandir — si no, los nodos ocultos reaparecen donde siempre estuvieron, como si
    // no se hubieran movido junto con el ancla colapsada.
    activeSelected.forEach((id) => {
      if (!collapsedNodeIds.has(id)) return;
      const visited = new Set([id]);
      const queue = [id];
      while (queue.length) {
        const current = queue.shift();
        edges.forEach((e) => {
          if (e.from === current && !visited.has(e.to) && hiddenNodeIds.has(e.to)) {
            visited.add(e.to);
            queue.push(e.to);
            if (!nodesMap[e.to]) {
              const hiddenNode = nodes.find((n) => n.id === e.to);
              if (hiddenNode) nodesMap[e.to] = { startX: hiddenNode.x, startY: hiddenNode.y };
            }
          }
        });
      }
    });

    dragStateRef.current = {
      leadId: nodeId,
      nodesMap,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      hasMoved: false,
      isAlt: e.altKey,
      isShiftOrCtrl: Boolean(e.shiftKey || e.ctrlKey),
    };
    e.preventDefault();
  };

  /** Quita un nodo del lienzo (y sus cables) — solo retira la representación visual del lienzo, conservando los datos en la actividad */
  const performDeleteNode = (nodeId) => {
    const deletedNode = findNode(nodeId);
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((ed) => ed.from !== nodeId && ed.to !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setSelectedEdgeId(null);
    saveToFirestore(nextNodes, nextEdges);

    // Al borrar un semáforo de Auditoría de Calidad, se cancela la asignación (solo si
    // seguía pendiente sin resolver — ver cancelQualityAudit) y se avisa a quien estaba
    // asignado que ya no tiene que auditar esa entrega.
    if (deletedNode?.type === 'auditoria-calidad') {
      cancelAuditForNode(deletedNode, 'Se quitó del lienzo').then((res) => {
        if (res?.ok && res.canceledAssignee?.id) {
          toast.info(`🚫 Auditoría cancelada — se avisó a ${res.canceledAssignee.name}.`);
        }
      });
    }
  };

  const handleCloseNode = (nodeId) => {
    if (!canEditDiagram) return;
    const node = findNode(nodeId);
    if (node?.type === 'bloque' && (node.activityIds || []).length > 0) {
      setDeleteBlockConfirm({ isOpen: true, nodeId });
      return;
    }
    performDeleteNode(nodeId);
  };

  const closeDeleteBlockConfirm = () => setDeleteBlockConfirm({ isOpen: false, nodeId: null });

  /**
   * Confirma el borrado de un Bloque junto con TODAS sus actividades reales.
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
    const fromNode = findNode(nodeId);
    const startPoint = fromNode ? getNodePortCoords(fromNode, side, nodeSizesRef.current) : { x: 0, y: 0, dir: { x: 1, y: 0 } };
    setPreviewWire({ x1: startPoint.x, y1: startPoint.y, x2: startPoint.x, y2: startPoint.y, dir1: startPoint.dir });
  };

  const localPoint = (e) => {
    const rect = canvasWrapRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - worldOffsetRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top - worldOffsetRef.current.y) / zoomRef.current,
    };
  };

  // ============================================
  // PANNING DEL LIENZO Y SELECCIÓN MARQUEE
  // ============================================
  const handleCanvasMouseDown = (e) => {
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isBackgroundLeft = e.button === 0 && (
      e.target === canvasWrapRef.current ||
      e.target.dataset.canvasBg ||
      e.target === worldRef.current
    );

    // 1. Marquee Selection Box con Shift + Clic Izquierdo en el fondo
    if (e.button === 0 && (e.shiftKey || e.ctrlKey) && isBackgroundLeft) {
      e.preventDefault();
      const pt = localPoint(e);
      selectionBoxRef.current = {
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      };
      setSelectionBox({
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      });
      return;
    }

    // 2. Panning del lienzo
    if (isMiddle || isRight || isBackgroundLeft || isSpacePressedRef.current) {
      e.preventDefault();
      // Si hizo clic izquierdo en fondo vacío sin Shift ni Ctrl, limpiar selección
      if (e.button === 0 && !e.shiftKey && !e.ctrlKey) {
        setSelectedNodeIds(new Set());
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
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

    // 1. Actualizar caja de selección Marquee
    if (selectionBoxRef.current) {
      const pt = localPoint(e);
      const updated = {
        ...selectionBoxRef.current,
        currentX: pt.x,
        currentY: pt.y,
      };
      selectionBoxRef.current = updated;
      setSelectionBox(updated);

      // Detectar qué nodos caen dentro del rectángulo
      const minX = Math.min(updated.startX, updated.currentX);
      const maxX = Math.max(updated.startX, updated.currentX);
      const minY = Math.min(updated.startY, updated.currentY);
      const maxY = Math.max(updated.startY, updated.currentY);

      const boxedIds = new Set();
      nodes.forEach((n) => {
        const nodeW = nodeSizesRef.current[n.id]?.width || NODE_WIDTH;
        const nodeH = nodeSizesRef.current[n.id]?.height || NODE_HEIGHT;
        const intersects =
          n.x + nodeW >= minX &&
          n.x <= maxX &&
          n.y + nodeH >= minY &&
          n.y <= maxY;
        if (intersects) {
          boxedIds.add(n.id);
        }
      });
      setSelectedNodeIds(boxedIds);
      setSelectedNodeId(null);
    }
    // 2. Arrastre de grupo de nodos
    else if (dragStateRef.current) {
      const { nodesMap, startMouseX, startMouseY } = dragStateRef.current;
      const distX = Math.abs(e.clientX - startMouseX);
      const distY = Math.abs(e.clientY - startMouseY);
      if (distX > 3 || distY > 3) {
        dragStateRef.current.hasMoved = true;
      }
      const dx = (e.clientX - startMouseX) / zoomRef.current;
      const dy = (e.clientY - startMouseY) / zoomRef.current;

      setNodes((prev) =>
        prev.map((n) => {
          const initial = nodesMap[n.id];
          if (initial) {
            const rawX = initial.startX + dx;
            const rawY = initial.startY + dy;
            const finalX = snapToGrid ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : rawX;
            const finalY = snapToGrid ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : rawY;
            return {
              ...n,
              x: Math.max(0, Math.min(WORKSPACE_WIDTH - NODE_WIDTH, finalX)),
              y: Math.max(0, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT, finalY)),
            };
          }
          return n;
        })
      );
    } else if (connectStateRef.current) {
      const { fromId, side } = connectStateRef.current;
      const fromNode = findNode(fromId);
      if (!fromNode) return;
      const start = getNodePortCoords(fromNode, side, nodeSizesRef.current);
      const end = localPoint(e);
      setPreviewWire({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        dir1: start.dir,
      });
    } else if (panStateRef.current) {
      const { startMouseX, startMouseY, startOffset } = panStateRef.current;
      setWorldOffset({
        x: startOffset.x + (e.clientX - startMouseX),
        y: startOffset.y + (e.clientY - startMouseY),
      });
    }
  };

  const handleWindowMouseUp = (e) => {
    if (selectionBoxRef.current) {
      selectionBoxRef.current = null;
      setSelectionBox(null);
    }

    let hasDraggedNodes = false;
    let clickOnlyNodeId = null;

    if (dragStateRef.current) {
      const { leadId, hasMoved, isAlt, isShiftOrCtrl } = dragStateRef.current;
      if (hasMoved) {
        hasDraggedNodes = true;
        justDraggedRef.current = true;
      } else {
        // Fue un clic estacionario sin arrastrar
        if (!isShiftOrCtrl && !isAlt) {
          clickOnlyNodeId = leadId;
        }
      }
      dragStateRef.current = null;
    }

    if (hasDraggedNodes) {
      setNodes((latestNodes) => {
        saveToFirestore(latestNodes, edges);
        return latestNodes;
      });
      // El menú del inspector permanece cerrado durante y después de mover nodos
      setSelectedNodeId(null);
    } else if (clickOnlyNodeId) {
      // Solo abrir el inspector si el usuario hizo un clic simple sin arrastrar
      setSelectedNodeId(clickOnlyNodeId);
    }

    if (connectStateRef.current) {
      const portEl = e.target.closest('[data-role="port"]');
      if (portEl) {
        const targetId = portEl.dataset.nodeId;
        const targetSide = portEl.dataset.side;
        const { fromId, side } = connectStateRef.current;
        if (targetId !== fromId) {
          const from = fromId;
          const to = targetId;
          const fromPort = side;
          const toPort = targetSide;

          const alreadyExists = edges.some(
            (ed) =>
              (ed.from === from && ed.to === to && ed.fromPort === fromPort && ed.toPort === toPort) ||
              (ed.from === to && ed.to === from && ed.fromPort === toPort && ed.toPort === fromPort)
          );
          if (!alreadyExists) {
            const newEdge = { id: nextEdgeId(), from, to, fromPort, toPort };
            const nextEdges = [...edges, newEdge];
            setEdges(nextEdges);
            saveToFirestore(nodes, nextEdges);

            // Al conectar nodos con cables, se propaga y sincroniza automáticamente su relación en Firestore:
            const fromNode = findNode(from);
            const toNode = findNode(to);
            if (fromNode && toNode) {
              const projNode = fromNode.type === 'proyecto' ? fromNode : toNode.type === 'proyecto' ? toNode : null;
              const gameNode = fromNode.type === 'juego' ? fromNode : toNode.type === 'juego' ? toNode : null;
              const colabNode = fromNode.type === 'colaborador' ? fromNode : toNode.type === 'colaborador' ? toNode : null;
              const actNode = fromNode.type === 'actividad' ? fromNode : toNode.type === 'actividad' ? toNode : null;
              const areaNode = fromNode.type === 'area' ? fromNode : toNode.type === 'area' ? toNode : null;
              const blockNode = fromNode.type === 'bloque' ? fromNode : toNode.type === 'bloque' ? toNode : null;
              const recursoNode = fromNode.type === 'recurso' ? fromNode : toNode.type === 'recurso' ? toNode : null;
              const auditNode = fromNode.type === 'auditoria-calidad' ? fromNode : toNode.type === 'auditoria-calidad' ? toNode : null;

              // 1. Proyecto ↔ Juego: Vincular el juego al proyecto inmediatamente
              if (projNode && gameNode) {
                const projEntity = getLinkedEntity(projNode);
                const projId = projNode.refId || (projNode.draft ? null : projNode.id);
                const projName = projEntity?.name || nodeTitle(projNode);

                if (gameNode.refId && !gameNode.draft) {
                  updateDoc(doc(db, 'juegos', gameNode.refId), {
                    projectId: projId,
                    projectName: projName,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    toast.success(`🔗 Juego "${nodeTitle(gameNode)}" vinculado al Proyecto "${projName}".`);
                  }).catch((err) => console.error('Error al vincular juego a proyecto:', err));
                } else if (gameNode.draft) {
                  updateDraftField(gameNode.id, 'projectId', projId);
                  toast.success(`🔗 Juego vinculado al Proyecto "${projName}".`);
                }
              }

              // 2. Colaborador ↔ Juego: Asignar colaborador responsable al juego
              if (colabNode && gameNode) {
                const operario = operarios.find((o) => o.id === colabNode.refId);
                const operarioName = operario?.name || nodeTitle(colabNode);
                if (gameNode.refId && !gameNode.draft) {
                  updateDoc(doc(db, 'juegos', gameNode.refId), {
                    operarioId: colabNode.refId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    toast.success(`👷 ${operarioName} asignado como responsable del Juego "${nodeTitle(gameNode)}".`);
                  }).catch((err) => console.error('Error al asignar operario a juego:', err));
                } else if (gameNode.draft) {
                  updateDraftField(gameNode.id, 'operarioId', colabNode.refId);
                  toast.success(`👷 ${operarioName} asignado al juego.`);
                }
              }

              // 3. Colaborador ↔ Actividad: Asignar colaborador a la tarea y reflejar en Firestore
              if (colabNode && actNode) {
                const operario = operarios.find((o) => o.id === colabNode.refId);
                const operarioName = operario?.name || nodeTitle(colabNode);
                const actTitle = nodeTitle(actNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const actEntity = getLinkedEntity(actNode);
                const areaId = actEntity?.areaId;
                const areaName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId || 'General';
                const supervisor = getSupervisorForArea(areaId);

                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    operarioId: colabNode.refId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { operarioId: colabNode.refId });
                    toast.success(`👷 ${operarioName} asignado a la actividad "${actTitle}".`);
                    // Notificar al supervisor de área
                    if (areaId) {
                      sendSystemChatMessage({
                        targetUserId: supervisor.id,
                        targetUserName: supervisor.name,
                        text: `📌 [Tarea Asignada en ${areaName}] Se ha asignado a ${operarioName} para la actividad "${actTitle}". Supervisor responsable: ${supervisor.name}.`,
                        senderId: user?.id || 'admin',
                        senderName: user?.name || 'Administración',
                        isGlobal: true,
                      });
                    }
                  }).catch((err) => {
                    console.error('Error al asignar colaborador vía updateDoc:', err);
                    updateActividad(actId, { operarioId: colabNode.refId });
                  });
                } else if (actNode.draft) {
                  updateDraftField(actNode.id, 'operarioId', colabNode.refId);
                  toast.success(`👷 ${operarioName} asignado a la actividad.`);
                }
              }

              // 4. Recurso / Ayuda Visual ↔ Actividad: Vincular el recurso a la actividad
              if (recursoNode && actNode) {
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const actTitle = nodeTitle(actNode);
                const resTitle = nodeTitle(recursoNode);
                const resUrl = recursoNode.draftFields?.url;

                if (actId && !actNode.draft) {
                  const act = actividades.find((a) => a.id === actId);
                  const updatedLinks = resUrl && !(act?.links || []).includes(resUrl)
                    ? [...(act?.links || []), resUrl]
                    : (act?.links || []);

                  updateDoc(doc(db, 'actividades', actId), {
                    links: updatedLinks,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { links: updatedLinks });
                    toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                  }).catch(() => {
                    toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                  });
                } else {
                  toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                }
              }

              // 5. Recurso / Ayuda Visual ↔ Proyecto: Vincular el recurso al proyecto
              if (recursoNode && projNode) {
                const projName = nodeTitle(projNode);
                const resTitle = nodeTitle(recursoNode);
                toast.success(`📎 "${resTitle}" vinculada al Proyecto "${projName}".`);
              }

              // 6. Proyecto ↔ Actividad: Vincular proyecto directamente
              if (projNode && actNode) {
                const projId = projNode.refId || (projNode.draft ? null : projNode.id);
                const projEntity = getLinkedEntity(projNode);
                const projName = projEntity?.name || nodeTitle(projNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    projectId: projId,
                    projectName: projName,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { projectId: projId, projectName: projName });
                    toast.success(`🔗 Actividad vinculada al Proyecto "${projName}".`);
                  });
                }
              }

              // 7. Juego ↔ Actividad
              if (gameNode && actNode) {
                const gameId = gameNode.refId || (gameNode.draft ? null : gameNode.id);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    gameId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { gameId });
                    toast.success(`🔗 Actividad vinculada al Juego "${nodeTitle(gameNode)}".`);
                  });
                }
              }

              // 10. Área ↔ Actividad: Asignar área a la actividad y notificar al supervisor
              if (areaNode && actNode) {
                const areaEntity = getLinkedEntity(areaNode);
                const areaId = areaNode.refId || areaEntity?.id;
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const actTitle = nodeTitle(actNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const supervisor = getSupervisorForArea(areaId);

                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    areaId: areaId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { areaId });
                    toast.success(`🏭 Actividad "${actTitle}" asignada al área "${areaName}".`);
                    // Notificar al supervisor de área
                    sendSystemChatMessage({
                      targetUserId: supervisor.id,
                      targetUserName: supervisor.name,
                      text: `📌 [Nueva Tarea Asignada a ${areaName}] La actividad "${actTitle}" ha sido asignada al área "${areaName}". Supervisor responsable: ${supervisor.name}.`,
                      senderId: user?.id || 'admin',
                      senderName: user?.name || 'Administración',
                      isGlobal: true,
                    });
                  }).catch((err) => {
                    console.error('Error al actualizar área de actividad:', err);
                    updateActividad(actId, { areaId });
                  });
                } else if (actNode.draft) {
                  updateDraftField(actNode.id, 'areaId', areaId);
                  toast.success(`🏭 Actividad asignada al área "${areaName}".`);
                }
              }

              // 11. Área ↔ Proyecto: Notificar al supervisor del área que hay un nuevo proyecto que le corresponde trabajar
              if (areaNode && projNode) {
                const areaEntity = getLinkedEntity(areaNode);
                const areaId = areaNode.refId || areaEntity?.id;
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const projName = nodeTitle(projNode);
                const supervisor = getSupervisorForArea(areaId);

                const alertText = `📢 [Nuevo Proyecto Asignado a ${areaName}] El proyecto "${projName}" ha sido vinculado al área "${areaName}". Le corresponde al supervisor (${supervisor.name}) y a su equipo programar y coordinar los trabajos correspondientes.`;

                // Notificar al supervisor y al Chat Global del sistema
                sendSystemChatMessage({
                  targetUserId: supervisor.id,
                  targetUserName: supervisor.name,
                  text: alertText,
                  senderId: user?.id || 'admin',
                  senderName: user?.name || 'Administración',
                  isGlobal: true,
                });

                toast.success(`📢 Notificación enviada al supervisor (${supervisor.name}) de ${areaName} para el Proyecto "${projName}".`);
              }

              // 12. Juego ↔ Área: Añadir área a la ruta de manufactura del juego y notificar al supervisor
              if (gameNode && areaNode) {
                const areaId = areaNode.refId;
                const areaEntity = getLinkedEntity(areaNode);
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const gameEntity = getLinkedEntity(gameNode);
                const gameName = nodeTitle(gameNode);
                const supervisor = getSupervisorForArea(areaId);

                if (gameEntity && areaId) {
                  const currentAreas = gameEntity.areas || [];
                  if (gameEntity.useManufacturingRoute) {
                    // El orden de `areas` es el orden real de fabricación de este juego —
                    // se protege igual que en el Inspector: no se toca desde un cable
                    // suelto, se maneja con validación desde RutaFabricacionView. Como no
                    // cambió nada de verdad, tampoco se notifica al supervisor.
                    toast.info('🛤️ Este juego usa Ruta de Fabricación — agrega áreas nuevas desde "Ver Ruta de Fabricación", no conectando el cable.');
                  } else if (!currentAreas.includes(areaId)) {
                    const nextAreas = [...currentAreas, areaId];
                    updateDoc(doc(db, 'juegos', gameEntity.id), {
                      areas: nextAreas,
                      targetPieces: { ...(gameEntity.targetPieces || {}), [areaId]: 10 },
                      updatedAt: new Date().toISOString(),
                    }).then(() => {
                      toast.success(`🏭 Área "${areaName}" agregada a la ruta del Juego.`);
                    });

                    const alertText = `📢 [Modelo de Juego en Ruta de Fabricación] El área "${areaName}" ha sido incorporada para fabricar el modelo "${gameName}". Supervisado por ${supervisor.name}.`;

                    sendSystemChatMessage({
                      targetUserId: supervisor.id,
                      targetUserName: supervisor.name,
                      text: alertText,
                      senderId: user?.id || 'admin',
                      senderName: user?.name || 'Administración',
                      isGlobal: true,
                    });

                    toast.success(`📢 Supervisor (${supervisor.name}) notificado sobre el modelo "${gameName}".`);
                  }
                }
              }

              // 13. Actividad ↔ Auditoría de Calidad: el semáforo se agrega sin vincular
              // (ver botón de la paleta) y se resuelve solo AQUÍ, al conectarlo por cable
              // a la Actividad que va a auditar — toma el área/juego de esa actividad. Si
              // ya estaba vinculado (se conecta una segunda vez, ej. hacia la Actividad de
              // Recepción río abajo), no se vuelve a resolver — conserva el área original.
              if (actNode && auditNode) {
                const actEntity = getLinkedEntity(actNode);
                let resolvedMode = null;
                let resolvedGameId = actEntity?.gameId || null;
                let resolvedAreaId = actEntity?.areaId || null;
                let resolvedProjectId = actEntity?.projectId || null;

                // Si la actividad no trae gameId/areaId propios (nunca se conectó
                // directo a un nodo Juego/Área), se busca en todo su subgrafo — el
                // usuario puede unir la auditoría a cualquier actividad de la cadena
                // y por las líneas sabemos de qué Juego/Área/Proyecto proviene.
                if (!auditNode.refId && (!resolvedGameId || !resolvedAreaId)) {
                  const clusterIds = getConnectedClusterNodeIds(actNode.id);
                  for (const id of clusterIds) {
                    if (resolvedGameId && resolvedAreaId) break;
                    const n = findNode(id);
                    if (!n) continue;
                    if (!resolvedGameId && n.type === 'juego') {
                      resolvedGameId = n.refId || (n.draft ? null : n.id);
                    }
                    if (!resolvedAreaId && n.type === 'area') {
                      resolvedAreaId = n.refId;
                    }
                    if (!resolvedProjectId && n.type === 'proyecto') {
                      resolvedProjectId = n.refId || (n.draft ? null : n.id);
                    }
                    if (n.type === 'actividad' && n.id !== actNode.id) {
                      const otherEntity = getLinkedEntity(n);
                      if (!resolvedGameId && otherEntity?.gameId) resolvedGameId = otherEntity.gameId;
                      if (!resolvedAreaId && otherEntity?.areaId) resolvedAreaId = otherEntity.areaId;
                      if (!resolvedProjectId && otherEntity?.projectId) resolvedProjectId = otherEntity.projectId;
                    }
                  }
                }

                if (!auditNode.refId) {
                  if (resolvedGameId && resolvedAreaId) {
                    resolvedMode = 'game';
                    const resolvedRefId = `${resolvedGameId}::${resolvedAreaId}`;
                    const nextNodesWithLink = nodes.map((n) => (n.id === auditNode.id ? { ...n, refId: resolvedRefId } : n));
                    setNodes(nextNodesWithLink);
                    saveToFirestore(nextNodesWithLink, nextEdges);
                    const linkedAreaName = dynamicAreas.find((a) => a.id === resolvedAreaId)?.name || resolvedAreaId;
                    const linkedGame = juegos.find((j) => j.id === resolvedGameId);
                    toast.success(`🔍 Auditoría vinculada a "${linkedAreaName}" del Juego "${linkedGame?.name || resolvedGameId}".`);
                  } else if (resolvedProjectId) {
                    // Sin Juego/Área en toda la cadena: el Proyecto no usa Ruta de
                    // Fabricación por áreas, así que la auditoría se vincula directo al
                    // Proyecto (un solo veredicto, sin indexar por área).
                    resolvedMode = 'project';
                    const resolvedRefId = `proyecto::${resolvedProjectId}`;
                    const nextNodesWithLink = nodes.map((n) => (n.id === auditNode.id ? { ...n, refId: resolvedRefId } : n));
                    setNodes(nextNodesWithLink);
                    saveToFirestore(nextNodesWithLink, nextEdges);
                    const linkedProject = proyectos.find((p) => p.id === resolvedProjectId);
                    toast.success(`🔍 Auditoría vinculada al Proyecto "${linkedProject?.name || resolvedProjectId}" (sin Juego).`);
                  } else {
                    toast.warning('🔍 No se encontró un Juego/Área ni un Proyecto conectado (por cable, directo o en cadena) a esta actividad — la auditoría no se pudo vincular.');
                  }
                } else {
                  const parts = auditNode.refId.split('::');
                  if (parts[0] === 'proyecto') {
                    resolvedMode = 'project';
                    resolvedProjectId = parts[1];
                  } else {
                    resolvedMode = 'game';
                    [resolvedGameId, resolvedAreaId] = parts;
                  }
                }

                if (resolvedMode === 'game' && resolvedGameId && resolvedAreaId) {
                  const game = juegos.find((j) => j.id === resolvedGameId);
                  const calidadUser = users.find((u) => u.roleType === 'calidad');
                  if (game && !game.qualityVerdict?.[resolvedAreaId]?.assignedTo) {
                    if (!calidadUser) {
                      toast.warning('⚠️ No hay ningún usuario con rol Calidad registrado — no se pudo asignar esta auditoría automáticamente. Créalo en Admin → Usuarios del Sistema.');
                    } else {
                      assignQualityAudit(resolvedGameId, resolvedAreaId, calidadUser.id, calidadUser.name).then((res) => {
                        if (res?.ok) {
                          const areaName = dynamicAreas.find((a) => a.id === resolvedAreaId)?.name || resolvedAreaId;
                          sendSystemChatMessage({
                            targetUserId: calidadUser.id,
                            targetUserName: calidadUser.name,
                            text: `🔍 [Auditoría de Calidad] Se te asignó la auditoría de la entrega de ${areaName} en "${game.name}". Revisa el semáforo en el lienzo cuando esa área termine.`,
                            senderId: user?.id || 'sistema',
                            senderName: user?.name || 'Sistema Dicrejart',
                            isGlobal: false,
                          });
                          toast.success(`🔍 Auditoría de "${areaName}" asignada a ${calidadUser.name}.`);
                        }
                      });
                    }
                  }
                } else if (resolvedMode === 'project' && resolvedProjectId) {
                  const project = proyectos.find((p) => p.id === resolvedProjectId);
                  const calidadUser = users.find((u) => u.roleType === 'calidad');
                  if (project && !project.qualityAuditProject?.assignedTo) {
                    if (!calidadUser) {
                      toast.warning('⚠️ No hay ningún usuario con rol Calidad registrado — no se pudo asignar esta auditoría automáticamente. Créalo en Admin → Usuarios del Sistema.');
                    } else {
                      assignQualityAuditProject(resolvedProjectId, calidadUser.id, calidadUser.name).then((res) => {
                        if (res?.ok) {
                          sendSystemChatMessage({
                            targetUserId: calidadUser.id,
                            targetUserName: calidadUser.name,
                            text: `🔍 [Auditoría de Calidad] Se te asignó la auditoría del Proyecto "${project.name}" (sin Juego). Revisa el semáforo en el lienzo cuando esté listo.`,
                            senderId: user?.id || 'sistema',
                            senderName: user?.name || 'Sistema Dicrejart',
                            isGlobal: false,
                          });
                          toast.success(`🔍 Auditoría del Proyecto "${project.name}" asignada a ${calidadUser.name}.`);
                        }
                      });
                    }
                  }
                }
              }
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
    const visibleNodes = nodes.filter((n) => !hiddenNodeIds.has(n.id));
    if (!rect || visibleNodes.length === 0) {
      setZoom(1);
      setWorldOffset({ x: 80, y: 60 });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    visibleNodes.forEach((n) => {
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
  }, [nodes, expandedBlocks, hiddenNodeIds]);

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
  // GESTIÓN Y ENFOQUE MULTI-PROYECTO EN LIENZO
  // ============================================

  /**
   * Obtiene todos los nodos presentes en el lienzo que corresponden a un proyecto específico:
   * - Nodo principal del proyecto
   * - Nodos de modelos / juegos del proyecto o conectados al proyecto
   * - Nodos de actividades del proyecto o conectadas a sus juegos/proyecto
   * - Nodos de bloques del proyecto
   * - Nodos de recursos/ayudas visuales conectados a cualquiera de los anteriores
   */
  const getProjectClusterNodes = useCallback(
    (projectId) => {
      if (!projectId) return [];
      const projectNode = nodes.find(
        (n) => n.type === 'proyecto' && (n.refId === projectId || n.id === projectId)
      );

      const clusterNodeIds = new Set();
      if (projectNode) {
        clusterNodeIds.add(projectNode.id);
      }

      // 1. Juegos pertenecientes al proyecto (por campo directo o cable)
      nodes.forEach((n) => {
        if (n.type === 'juego') {
          const jEntity = getLinkedEntity(n);
          if (
            jEntity?.projectId === projectId ||
            n.draftFields?.projectId === projectId ||
            (projectNode && edges.some((e) => (e.from === n.id && e.to === projectNode.id) || (e.to === n.id && e.from === projectNode.id)))
          ) {
            clusterNodeIds.add(n.id);
          }
        }
      });

      // 2. Actividades pertenecientes al proyecto o conectadas a sus juegos/proyecto
      nodes.forEach((n) => {
        if (n.type === 'actividad') {
          const aEntity = getLinkedEntity(n);
          if (
            aEntity?.projectId === projectId ||
            (projectNode && edges.some((e) => (e.from === n.id && e.to === projectNode.id) || (e.to === n.id && e.from === projectNode.id))) ||
            edges.some((e) => {
              const otherId = e.from === n.id ? e.to : e.from;
              return clusterNodeIds.has(otherId);
            })
          ) {
            clusterNodeIds.add(n.id);
          }
        }
      });

      // 3. Bloques pertenecientes al proyecto
      nodes.forEach((n) => {
        if (n.type === 'bloque') {
          if (
            n.projectId === projectId ||
            (projectNode && edges.some((e) => (e.from === n.id && e.to === projectNode.id) || (e.to === n.id && e.from === projectNode.id)))
          ) {
            clusterNodeIds.add(n.id);
          }
        }
      });

      // 4. Recursos / Ayudas visuales conectadas a cualquiera de los nodos del cluster
      nodes.forEach((n) => {
        if (n.type === 'recurso') {
          if (
            edges.some((e) => {
              const otherId = e.from === n.id ? e.to : e.from;
              return clusterNodeIds.has(otherId);
            })
          ) {
            clusterNodeIds.add(n.id);
          }
        }
      });

      return nodes.filter((n) => clusterNodeIds.has(n.id));
    },
    [nodes, edges, getLinkedEntity]
  );

  // Conteo y estadística de nodos por proyecto para el filtro/selector en el lienzo actual
  const projectNodesStats = useMemo(() => {
    const stats = {};
    (proyectos || []).forEach((p) => {
      const cluster = getProjectClusterNodes(p.id);
      stats[p.id] = {
        count: cluster.length,
        hasProjectNode: cluster.some((n) => n.type === 'proyecto'),
        nodes: cluster,
      };
    });
    return stats;
  }, [proyectos, getProjectClusterNodes]);

  // Set de IDs de los nodos del proyecto actualmente enfocado para aislamiento visual
  const activeProjectClusterNodeIds = useMemo(() => {
    if (!focusedProjectId) return new Set();
    const cluster = getProjectClusterNodes(focusedProjectId);
    return new Set(cluster.map((n) => n.id));
  }, [focusedProjectId, getProjectClusterNodes]);

  /**
   * Redirige y centra la cámara (Smart Pan & Fit Zoom) en la zona donde se encuentra el conjunto de nodos del proyecto
   */
  const handleFocusProjectCluster = useCallback(
    (projectId) => {
      if (!projectId) {
        setFocusedProjectId('');
        return;
      }
      setFocusedProjectId(projectId);
      const targetProj = proyectos.find((p) => p.id === projectId);
      const cluster = getProjectClusterNodes(projectId);

      if (cluster.length === 0) {
        toast.info(`ℹ️ El proyecto "${targetProj?.name || 'Seleccionado'}" aún no tiene nodos en este lienzo.`);
        return;
      }

      const rect = canvasWrapRef.current?.getBoundingClientRect();
      if (!rect) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      cluster.forEach((n) => {
        const measured = nodeSizesRef.current[n.id];
        const w = measured?.w || NODE_WIDTH;
        const h = measured?.h || (n.type === 'bloque' && expandedBlocks.has(n.id) ? 320 : NODE_HEIGHT);
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + w);
        maxY = Math.max(maxY, n.y + h);
      });

      const clusterWidth = Math.max(140, maxX - minX);
      const clusterHeight = Math.max(140, maxY - minY);
      const padding = 130;

      const availableWidth = Math.max(100, rect.width - padding * 2);
      const availableHeight = Math.max(100, rect.height - padding * 2);

      const fitZoom = clampZoom(Math.min(availableWidth / clusterWidth, availableHeight / clusterHeight, 1.0));
      const centerX = minX + clusterWidth / 2;
      const centerY = minY + clusterHeight / 2;

      const targetOffset = {
        x: Math.round(rect.width / 2 - centerX * fitZoom),
        y: Math.round(rect.height / 2 - centerY * fitZoom),
      };

      // Activar animación suave de cámara
      setIsCameraAnimating(true);
      setZoom(fitZoom);
      setWorldOffset(targetOffset);

      // Seleccionar nodo principal del proyecto si existe
      const mainProjNode = cluster.find((n) => n.type === 'proyecto');
      if (mainProjNode) {
        setSelectedNodeId(mainProjNode.id);
      }

      toast.success(`📍 Enfocado en "${targetProj?.name || 'Proyecto'}" · (${cluster.length} ${cluster.length === 1 ? 'nodo' : 'nodos'} en esta zona).`);

      setTimeout(() => {
        setIsCameraAnimating(false);
      }, 460);
    },
    [proyectos, getProjectClusterNodes, expandedBlocks]
  );

  /**
   * Coloca el nodo de un proyecto directamente en el centro visible del lienzo
   */
  const handleSpawnProjectInCenter = useCallback(
    (projectId) => {
      if (!canEditDiagram || !projectId) return;
      const targetProj = proyectos.find((p) => p.id === projectId);
      if (!targetProj) return;

      const rect = canvasWrapRef.current?.getBoundingClientRect();
      let spawnX = 200;
      let spawnY = 200;
      if (rect) {
        const viewCenterX = rect.width / 2;
        const viewCenterY = rect.height / 2;
        const curZoom = zoomRef.current || 1;
        const curOffset = worldOffsetRef.current || { x: 0, y: 0 };
        spawnX = Math.round((viewCenterX - curOffset.x) / curZoom - NODE_WIDTH / 2);
        spawnY = Math.round((viewCenterY - curOffset.y) / curZoom - NODE_HEIGHT / 2);
      }

      spawnX = Math.max(20, Math.min(WORKSPACE_WIDTH - NODE_WIDTH - 20, snapToGrid ? Math.round(spawnX / GRID_SIZE) * GRID_SIZE : spawnX));
      spawnY = Math.max(20, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT - 20, snapToGrid ? Math.round(spawnY / GRID_SIZE) * GRID_SIZE : spawnY));

      const newNode = {
        id: nextNodeId(),
        type: 'proyecto',
        refId: projectId,
        draft: false,
        draftFields: {},
        x: spawnX,
        y: spawnY,
      };

      const nextNodes = [...nodes, newNode];
      setNodes(nextNodes);
      saveToFirestore(nextNodes, edges);
      setSelectedNodeId(newNode.id);
      setFocusedProjectId(projectId);
      toast.success(`🗂️ Nodo del Proyecto "${targetProj.name}" colocado en el centro del lienzo.`);
    },
    [canEditDiagram, proyectos, nodes, edges, snapToGrid, saveToFirestore]
  );

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

      const targetProj = proyectos.find((p) => p.id === focusedProjectId);
      const canvasName = targetProj?.name ? `lienzo-${targetProj.name}` : 'lienzo-general';
      const fileSafeName = canvasName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
  // MODAL UNIFICADO DE CREACIÓN / INSERCIÓN DE NODOS
  // ============================================
  const catalogFor = useCallback(
    (type) => {
      if (type === 'proyecto') return proyectos.map((p) => ({ id: p.id, label: `${p.name} ${p.client ? `(${p.client})` : ''}` }));
      if (type === 'juego') return juegos.map((j) => ({ id: j.id, label: `${j.name} ${j.projectName ? `· 🗂️ ${j.projectName}` : ''}` }));
      if (type === 'actividad') return actividades.map((a) => ({ id: a.id, label: `📌 ${a.title} (${dynamicAreas.find((c) => c.id === a.areaId)?.name || a.areaId})` }));
      if (type === 'colaborador') {
        return operarios.map((o) => {
          const areaName = dynamicAreas.find((a) => a.id === o.currentArea)?.name || o.currentArea;
          const loanTag = o.currentArea !== o.homeArea ? ' · prestado' : '';
          return { id: o.id, label: `👷 ${o.name} — ${areaName}${loanTag} (${o.puesto || 'Operario'})` };
        });
      }
      if (type === 'area') return dynamicAreas.map((a) => ({ id: a.id, label: `🏭 ${a.name}` }));
      // 'auditoria-calidad' no tiene catálogo: se agrega directo (sin picker) y se
      // vincula solo al conectarlo por cable a la Actividad que va a auditar — ver el
      // bloque "Actividad ↔ Auditoría de Calidad" en el handler de conexión de cables.
      return [];
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

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
    return created;
  };

  const EMPTY_NODE_MODAL = {
    isOpen: false,
    type: 'colaborador', // 'proyecto' | 'juego' | 'colaborador' | 'area' | 'actividad' | 'recurso'
    tab: 'existing', // 'existing' | 'new'
    query: '',

    // Proyecto
    newProjName: '',
    newProjClient: '',
    newProjDesc: '',
    newProjItems: '',
    newProjAreas: ['arquitectura', 'diseno', 'herreria', 'corte-laser'],
    newProjStartDate: getTodayLocalDateStr(),
    newProjEndDate: getTodayLocalDateStr(),
    newProjStatus: 'diseno',

    // Juego
    newGameName: '',
    newGameProjectId: '',
    newGameAreas: ['herreria', 'corte-laser'],
    newGameTargets: { herreria: 10, 'corte-laser': 10 },
    newGameUseRoute: false,

    // Actividad
    newActTitle: '',
    newActDesc: '',
    newActAreaId: 'herreria',
    newActOperarioId: '',
    newActPriority: 'media',
    newActDueDate: '',
    newActUrl: '',
    newActPendingFile: null,
    newActFileData: null,

    // Recurso / Ayuda Visual
    newRecursoTitle: 'Plano / Ayuda Visual',
    newRecursoType: 'imagen',
    newRecursoUrl: '',
    newRecursoFileData: null,
    pendingFile: null,
    newRecursoNotes: '',
  };

  const [nodeModal, setNodeModal] = useState(EMPTY_NODE_MODAL);

  const openNodeModal = (type) => {
    if (!canEditDiagram) return;
    const defaultTab = (type === 'colaborador' || type === 'area') ? 'existing' : 'new';
    setNodeModal({
      ...EMPTY_NODE_MODAL,
      isOpen: true,
      type,
      tab: defaultTab,
      newProjAreas: ['arquitectura', 'diseno', 'herreria', 'corte-laser'],
      newProjItems: '',
      newGameAreas: ['herreria', 'corte-laser'],
      newGameTargets: { herreria: 10, 'corte-laser': 10 },
      newActAreaId: dynamicAreas[0]?.id || 'herreria',
      newActOperarioId: '',
      newActUrl: '',
      newActPendingFile: null,
      newActFileData: null,
    });
  };

  const closeNodeModal = () => setNodeModal(EMPTY_NODE_MODAL);

  const handlePickExistingNode = (type, entityId) => {
    spawnNode(type, { draft: false, refId: entityId, draftFields: {} });
    closeNodeModal();
    const meta = NODE_TYPES[type];
    toast.success(`✅ Nodo de ${meta?.label || type} agregado al lienzo.`);
    // Nota: la asignación automática de Auditoría de Calidad NO ocurre aquí — pasa al
    // conectar el nodo por cable a una Actividad (ver bloque "13." en el handler de
    // conexión de cables), para que un semáforo agregado pero sin conectar no dispare
    // avisos de algo que todavía no forma parte de ningún flujo real.
  };

  const handleCreateNewProjectNode = async () => {
    if (!nodeModal.newProjName.trim() || !nodeModal.newProjClient.trim()) {
      toast.danger('Nombre del proyecto y cliente son obligatorios.');
      return;
    }
    const today = getTodayLocalDateStr();
    const newId = await addProject({
      name: nodeModal.newProjName.trim(),
      client: nodeModal.newProjClient.trim(),
      description: nodeModal.newProjDesc.trim() || 'Sin descripción',
      itemsToManufacture: nodeModal.newProjItems?.trim() || '',
      areas: nodeModal.newProjAreas || [],
      startDate: nodeModal.newProjStartDate || today,
      endDate: nodeModal.newProjEndDate || today,
      status: nodeModal.newProjStatus || 'diseno',
    });
    if (newId) {
      spawnNode('proyecto', { draft: false, refId: newId, draftFields: {} });
      closeNodeModal();
      toast.success(`🗂️ Proyecto "${nodeModal.newProjName.trim()}" creado y agregado al lienzo.`);
    }
  };

  const handleCreateNewGameNode = async () => {
    if (!nodeModal.newGameName.trim()) {
      toast.danger('El nombre del juego / modelo es obligatorio.');
      return;
    }
    let chosenAreas = nodeModal.newGameAreas.length > 0 ? nodeModal.newGameAreas : ['herreria'];
    if (chosenAreas.includes('herreria') && !chosenAreas.includes('corte-laser')) {
      chosenAreas.push('corte-laser');
    }
    // Con Ruta de Fabricación, el orden del arreglo ES el orden real — Corte Láser debe
    // quedar antes que Herrería. Solo se corrige si de verdad viola la regla (Herrería
    // antes que Corte Láser): se intercambian esas dos posiciones nada más, sin tocar el
    // orden del resto de las áreas ya elegidas.
    if (nodeModal.newGameUseRoute && chosenAreas.includes('herreria') && chosenAreas.includes('corte-laser')) {
      const herreriaIdx = chosenAreas.indexOf('herreria');
      const corteIdx = chosenAreas.indexOf('corte-laser');
      if (herreriaIdx < corteIdx) {
        chosenAreas = [...chosenAreas];
        [chosenAreas[herreriaIdx], chosenAreas[corteIdx]] = [chosenAreas[corteIdx], chosenAreas[herreriaIdx]];
      }
    }
    const targets = {};
    chosenAreas.forEach((ar) => {
      targets[ar] = Number(nodeModal.newGameTargets[ar]) || 10;
    });

    const matchingProj = proyectos.find((p) => p.id === nodeModal.newGameProjectId);
    const newId = await addGame({
      name: nodeModal.newGameName.trim(),
      projectName: matchingProj?.name || 'General',
      projectId: nodeModal.newGameProjectId || null,
      areas: chosenAreas,
      targetPieces: targets,
      useManufacturingRoute: nodeModal.newGameUseRoute,
    });
    if (newId) {
      spawnNode('juego', { draft: false, refId: newId, draftFields: {} });
      const useRoute = nodeModal.newGameUseRoute;
      closeNodeModal();
      toast.success(`🎮 Juego "${nodeModal.newGameName.trim()}" creado y agregado al lienzo.`);
      if (useRoute) navigate(`/editor-visual/ruta/${newId}?from=${lienzoActivoId}`);
    }
  };

  const handleCreateNewActivityNode = async () => {
    if (!nodeModal.newActTitle.trim()) {
      toast.danger('El título de la actividad es obligatorio.');
      return;
    }
    const title = nodeModal.newActTitle.trim();
    const areaId = nodeModal.newActAreaId || (dynamicAreas[0]?.id || 'herreria');
    const operarioId = nodeModal.newActOperarioId || null;
    const url = nodeModal.newActUrl.trim();
    const pendingFile = nodeModal.newActPendingFile;
    const links = url ? [url] : [];

    closeNodeModal();

    let uploadedFile = null;
    if (pendingFile) {
      toast.info(`⏳ Subiendo archivo adjunto "${pendingFile.name}" a la nube...`);
      try {
        uploadedFile = await uploadResourceFile(pendingFile, lienzoActivoId);
      } catch (err) {
        console.error('Error al subir archivo de actividad:', err);
      }
    }

    const attachments = uploadedFile ? [uploadedFile] : [];

    const newId = await addActividad({
      title,
      description: nodeModal.newActDesc.trim() || 'Sin descripción.',
      areaId,
      operarioId,
      priority: nodeModal.newActPriority || 'media',
      dueDate: nodeModal.newActDueDate || null,
      links,
      attachments,
    });

    if (newId) {
      const actNode = spawnNode('actividad', { draft: false, refId: newId, draftFields: {} });
      toast.success(`📌 Actividad "${title}" creada y agregada.`);

      // Si se adjuntó una imagen, crear también el nodo de imagen flotante conectado a la actividad
      if (pendingFile && (pendingFile.type?.startsWith('image/') || uploadedFile?.url || uploadedFile?.dataUrl)) {
        const imgNodeId = nextNodeId();
        const imgInitialData = uploadedFile || {
          name: pendingFile.name,
          size: pendingFile.size,
          type: pendingFile.type,
          dataUrl: URL.createObjectURL(pendingFile),
        };

        const imgX = (actNode?.x || 200) + NODE_WIDTH + 60;
        const imgY = actNode?.y || 200;

        const imgNode = {
          id: imgNodeId,
          type: 'recurso',
          x: imgX,
          y: imgY,
          draft: false,
          draftFields: {
            title: `Visual: ${title}`,
            url: url || uploadedFile?.url || '',
            fileData: imgInitialData,
            notes: '',
          },
        };

        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: actNode.id,
          to: imgNodeId,
          style: 'dashed',
          customColor: '#06b6d4',
        };

        setNodes((prev) => {
          const next = [...prev, imgNode];
          setEdges((prevE) => {
            const nextE = [...prevE, wireEdge];
            saveToFirestore(next, nextE);
            return nextE;
          });
          return next;
        });
      } else if (url) {
        // Si se especificó un enlace (Drive, Figma, Autodesk, web URL), generar nodo de enlace flotante
        const linkNodeId = nextNodeId();
        const linkX = (actNode?.x || 200) + NODE_WIDTH + 60;
        const linkY = actNode?.y || 200;

        let linkTitle = `Enlace: ${title}`;
        if (url.includes('drive.google.com')) linkTitle = `Drive: ${title}`;
        else if (url.includes('figma.com')) linkTitle = `Figma: ${title}`;
        else if (url.includes('autodesk.com')) linkTitle = `Autodesk 3D: ${title}`;

        const linkNode = {
          id: linkNodeId,
          type: 'recurso',
          x: linkX,
          y: linkY,
          draft: false,
          draftFields: {
            title: linkTitle,
            url: url,
            fileData: null,
            notes: '',
          },
        };

        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: actNode.id,
          to: linkNodeId,
          style: 'dashed',
          customColor: '#38bdf8',
        };

        setNodes((prev) => {
          const next = [...prev, linkNode];
          setEdges((prevE) => {
            const nextE = [...prevE, wireEdge];
            saveToFirestore(next, nextE);
            return nextE;
          });
          return next;
        });
      }
    }
  };

  const handleDeployAllActivityResources = (actNode, actEntity) => {
    if (!actNode || !actEntity) return;
    const actX = actNode.x || 200;
    const actY = actNode.y || 200;

    let nextNodesList = [...nodes];
    let nextEdgesList = [...edges];
    let createdCount = 0;

    // 1. Enlaces web, Drive, Figma, Autodesk
    const links = actEntity.links || [];
    links.forEach((linkUrl) => {
      const alreadyExists = nextNodesList.some((n) => {
        if (n.type !== 'recurso') return false;
        const nUrl = n.draftFields?.url;
        const matchesUrl = Boolean(nUrl && nUrl === linkUrl);
        const isConnected = nextEdgesList.some((e) => (e.from === actNode.id && e.to === n.id) || (e.to === actNode.id && e.from === n.id));
        return matchesUrl && isConnected;
      });

      if (!alreadyExists) {
        const linkId = nextNodeId();
        let linkTitle = `Enlace: ${actEntity.title}`;
        if (linkUrl.includes('drive.google.com')) linkTitle = `Drive: ${actEntity.title}`;
        else if (linkUrl.includes('figma.com')) linkTitle = `Figma: ${actEntity.title}`;
        else if (linkUrl.includes('autodesk.com') || linkUrl.includes('viewer.autodesk')) linkTitle = `Autodesk: ${actEntity.title}`;

        const linkNode = {
          id: linkId,
          type: 'recurso',
          x: actX + NODE_WIDTH + 60,
          y: actY + 70 + (createdCount * 90),
          draft: false,
          draftFields: {
            title: linkTitle,
            url: linkUrl,
            fileData: null,
            notes: '',
          },
        };

        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: actNode.id,
          to: linkId,
          fromPort: 'out',
          toPort: 'in',
          style: 'dashed',
          customColor: '#38bdf8',
        };

        nextNodesList.push(linkNode);
        nextEdgesList.push(wireEdge);
        createdCount++;
      }
    });

    // 2. Archivos e imágenes adjuntas
    const attachments = actEntity.attachments || (actEntity.fileData ? [actEntity.fileData] : []);
    attachments.forEach((att) => {
      const isImg = att.type?.startsWith('image/') || att.url?.match(/\.(jpeg|jpg|png|webp|gif)($|\?)/i) || att.dataUrl?.startsWith('data:image');
      if (!isImg) return;

      const alreadyExists = nextNodesList.some((n) => {
        if (n.type !== 'recurso') return false;
        const nUrl = n.draftFields?.url || n.draftFields?.fileData?.url || n.draftFields?.fileData?.dataUrl;
        const attUrl = att.url || att.dataUrl;
        const matchesUrl = Boolean(nUrl && attUrl && nUrl === attUrl);
        const matchesName = Boolean(n.draftFields?.fileData?.name && att.name && n.draftFields.fileData.name === att.name);
        const isConnected = nextEdgesList.some((e) => (e.from === actNode.id && e.to === n.id) || (e.to === actNode.id && e.from === n.id));
        return (matchesUrl || matchesName) && isConnected;
      });

      if (!alreadyExists) {
        const imgId = nextNodeId();
        const imgNode = {
          id: imgId,
          type: 'recurso',
          x: actX + NODE_WIDTH + 60,
          y: actY + (createdCount * 110),
          draft: false,
          draftFields: {
            title: `Visual: ${actEntity.title}`,
            url: att.url || att.dataUrl || '',
            fileData: att,
            notes: '',
          },
        };

        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: actNode.id,
          to: imgId,
          fromPort: 'out',
          toPort: 'in',
          style: 'dashed',
          customColor: '#06b6d4',
        };

        nextNodesList.push(imgNode);
        nextEdgesList.push(wireEdge);
        createdCount++;
      }
    });

    if (createdCount > 0) {
      setNodes(nextNodesList);
      setEdges(nextEdgesList);
      saveToFirestore(nextNodesList, nextEdgesList);
      toast.success(`📍 ${createdCount} recurso(s) colocados en el lienzo.`);
    } else {
      toast.info('Todos los recursos de esta actividad ya están visibles en el lienzo.');
    }
  };

  const handleCreateNewRecursoNode = async () => {
    const title = nodeModal.newRecursoTitle.trim() || 'Ayuda Visual / Archivo';
    const url = nodeModal.newRecursoUrl.trim() || '';
    const pendingFile = nodeModal.pendingFile;

    closeNodeModal();

    const tempId = nextNodeId();
    const localUrl = pendingFile ? URL.createObjectURL(pendingFile) : '';

    const initialFileData = pendingFile ? {
      name: pendingFile.name,
      size: pendingFile.size,
      type: pendingFile.type,
      dataUrl: localUrl,
      isUploading: true,
    } : nodeModal.newRecursoFileData || null;

    spawnNode('recurso', {
      id: tempId,
      draft: false,
      draftFields: {
        title,
        url,
        fileData: initialFileData,
        notes: nodeModal.newRecursoNotes.trim() || '',
      },
    });

    toast.success(`📎 Ayuda Visual "${title}" agregada al lienzo.`);

    if (pendingFile) {
      toast.info(`⏳ Guardando "${pendingFile.name}" en la nube...`);
      try {
        const uploaded = await uploadResourceFile(pendingFile, lienzoActivoId);
        if (uploaded) {
          updateDraftField(tempId, 'fileData', uploaded);
          toast.success(`☁️ "${pendingFile.name}" guardado permanentemente.`);
        }
      } catch (err) {
        console.error('Error subiendo archivo:', err);
      }
    }
  };

  /**
   * Valida si el usuario logueado tiene permiso para iniciar / terminar / reabrir una actividad:
   * 1. Solo el colaborador asignado a la actividad (por operarioId, uid, email o nombre).
   * 2. O el supervisor / encargado del área de la actividad.
   * 3. O administradores / dirección / calidad general.
   */
  const canUserControlActivity = useCallback(
    (act) => {
      if (!user || !act) return false;
      // 1. Roles administrativos y supervisión global
      if (
        user.role === 'admin' ||
        user.roleType === 'admin' ||
        user.roleType === 'director' ||
        user.roleType === 'calidad' ||
        user.roleType === 'gerencia'
      ) {
        return true;
      }

      // 2. Colaborador asignado directamente a la actividad
      const assignedOperario = operarios.find((o) => o.id === act.operarioId);
      const isDirectlyAssigned =
        (user.operarioId && user.operarioId === act.operarioId) ||
        (user.id && (user.id === act.operarioId || user.id === assignedOperario?.id)) ||
        (user.uid && (user.uid === act.operarioId || user.uid === assignedOperario?.id)) ||
        (assignedOperario && (
          (assignedOperario.email && user.email && assignedOperario.email.toLowerCase() === user.email.toLowerCase()) ||
          (assignedOperario.name && user.name && assignedOperario.name.trim().toLowerCase() === user.name.trim().toLowerCase())
        ));

      if (isDirectlyAssigned) return true;

      // 3. Supervisor o Encargado del Área de la actividad
      const supervisor = getSupervisorForArea(act.areaId);
      const isAreaSupervisor =
        (supervisor.id && (supervisor.id === user.id || supervisor.id === user.uid)) ||
        ((user.roleType === 'supervisor-area' || user.roleType === 'encargado-area') && (
          user.areaId === act.areaId ||
          user.currentArea === act.areaId ||
          (Array.isArray(user.assignedAreas) && user.assignedAreas.includes(act.areaId)) ||
          (supervisor.name && user.name && supervisor.name.trim().toLowerCase() === user.name.trim().toLowerCase())
        ));

      if (isAreaSupervisor) return true;

      return false;
    },
    [user, operarios, getSupervisorForArea]
  );

  /**
   * Solo "¿esta actividad es mía?" — a diferencia de canUserControlActivity (que también
   * da permiso a Admin/Calidad/Dirección y a cualquier supervisor del área), esto es
   * estrictamente "¿estoy yo asignado como responsable?", para resaltar en el lienzo lo
   * que le toca a CADA quien (Diseño, Arquitectura, Supervisores de área, etc.) al entrar
   * con su propio usuario — no una marca de permiso, una marca de pertenencia.
   */
  const isActivityAssignedToMe = useCallback(
    (act) => {
      if (!user || !act?.operarioId) return false;
      const assignedOperario = operarios.find((o) => o.id === act.operarioId);
      return Boolean(
        (user.operarioId && user.operarioId === act.operarioId) ||
        (user.id && (user.id === act.operarioId || user.id === assignedOperario?.id)) ||
        (user.uid && (user.uid === act.operarioId || user.uid === assignedOperario?.id)) ||
        (assignedOperario && (
          (assignedOperario.email && user.email && assignedOperario.email.toLowerCase() === user.email.toLowerCase()) ||
          (assignedOperario.name && user.name && assignedOperario.name.trim().toLowerCase() === user.name.trim().toLowerCase())
        ))
      );
    },
    [user, operarios]
  );

  /**
   * Inicia una actividad pasando su estatus a 'proceso' y fijando startedAt en Firestore
   */
  const handleStartActivity = useCallback(
    async (activityId, title) => {
      if (!db || !activityId) return;
      const act = actividades.find((a) => a.id === activityId);
      if (act && !canUserControlActivity(act)) {
        toast.warning('🔒 Solo el colaborador asignado o el supervisor de esta área pueden iniciar esta actividad.');
        return;
      }

      // Validación de secuencia estricta: ninguna actividad puede iniciar si su previa no ha culminado
      const blockStatus = getActivityBlockStatus(activityId);
      if (blockStatus.isBlocked) {
        toast.warning(`🔒 No se puede iniciar: ${blockStatus.reason}`);
        return;
      }

      try {
        await updateDoc(doc(db, 'actividades', activityId), {
          status: 'proceso',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        toast.success(`⚡ Actividad "${title || 'Actividad'}" iniciada.`);
      } catch (err) {
        console.error('Error al iniciar actividad:', err);
        toast.danger('Error al iniciar la actividad en el servidor.');
      }
    },
    [actividades, canUserControlActivity, getActivityBlockStatus, toast]
  );

  /**
   * Abre modal para completar la actividad con notas de entrega
   */
  const handleOpenCompleteModal = useCallback((activityId, title) => {
    const act = actividades.find((a) => a.id === activityId);
    if (act && !canUserControlActivity(act)) {
      toast.warning('🔒 Solo el colaborador asignado o el supervisor de esta área pueden marcar como terminada esta actividad.');
      return;
    }
    setCompleteModal({
      isOpen: true,
      activityId,
      title,
      notes: 'Actividad concluida satisfactoriamente.',
    });
  }, [actividades, canUserControlActivity, toast]);

  /**
   * Confirma la finalización de la actividad — pasa por advanceStatus (ActividadesContext)
   * en vez de escribir directo a Firestore aquí, para que la actividad se complete por el
   * único camino centralizado (mismo que usa ActividadesPage.jsx): así el registro
   * automático de producción y cualquier otra lógica de negocio ligada a completar una
   * actividad corre sin importar desde qué pantalla se haga.
   */
  const handleConfirmCompleteActivity = useCallback(async () => {
    if (!completeModal.activityId) return;
    try {
      await advanceStatus(completeModal.activityId, completeModal.notes.trim() || 'Actividad concluida satisfactoriamente.');
      toast.success(`✅ Actividad "${completeModal.title}" completada.`);
      setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' });
    } catch (err) {
      console.error('Error al completar actividad:', err);
      toast.danger('Error al marcar la actividad como completada.');
    }
  }, [completeModal, toast, advanceStatus]);

  /**
   * Resuelve Área/Juego/Proyecto de una actividad para saber en qué carpeta del NAS
   * debe quedar su evidencia — si la actividad no trae gameId/areaId propios, busca en
   * todo su subgrafo de cables (mismo patrón que la resolución del semáforo de
   * Auditoría de Calidad, ver bloque 13 de handleWindowMouseUp).
   */
  const resolveRouteContextForActivity = useCallback(
    (act) => {
      let areaId = act?.areaId || null;
      let gameId = act?.gameId || null;
      let projectId = act?.projectId || null;

      if (!gameId) {
        const actNode = nodes.find((n) => n.type === 'actividad' && n.refId === act?.id);
        if (actNode) {
          const clusterIds = getConnectedClusterNodeIds(actNode.id);
          for (const id of clusterIds) {
            if (gameId) break;
            const n = findNode(id);
            if (!n) continue;
            if (!gameId && n.type === 'juego') gameId = n.refId || (n.draft ? null : n.id);
            if (!areaId && n.type === 'area') areaId = n.refId;
            if (!projectId && n.type === 'proyecto') projectId = n.refId || (n.draft ? null : n.id);
          }
        }
      }

      const game = gameId ? juegos.find((j) => j.id === gameId) : null;
      const project = projectId
        ? proyectos.find((p) => p.id === projectId)
        : game?.projectId
        ? proyectos.find((p) => p.id === game.projectId)
        : null;
      const area = areaId ? dynamicAreas.find((a) => a.id === areaId) : null;

      return {
        areaId,
        areaName: area?.name || areaId,
        gameId,
        gameName: game?.name,
        projectId: project?.id || projectId,
        projectName: project?.name || act?.projectName,
      };
    },
    [nodes, juegos, proyectos, dynamicAreas, getConnectedClusterNodeIds, findNode]
  );

  /** Abre el modal de link de evidencia (NAS) de una actividad, precargado con su valor actual */
  const handleOpenEvidenceModal = (activityId, title) => {
    const act = actividades.find((a) => a.id === activityId);
    setEvidenceModal({ isOpen: true, activityId, title, linkInput: act?.evidenceLink || '' });
  };

  const closeEvidenceModal = () => setEvidenceModal({ isOpen: false, activityId: null, title: '', linkInput: '' });

  /** Sube el archivo de evidencia de la actividad abierta en el modal directo al NAS (con respaldo/migración automática) */
  const handleUploadActivityEvidence = async (file) => {
    if (!file || !evidenceModal.activityId) return;
    setEvidenceUploading(true);
    try {
      const act = actividades.find((a) => a.id === evidenceModal.activityId);
      const ctx = resolveRouteContextForActivity(act);
      const result = await uploadEvidenceFile(file, {
        category: 'fabricacion',
        areaId: ctx.areaId,
        areaName: ctx.areaName,
        gameId: ctx.gameId,
        gameName: ctx.gameName,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        targetType: 'actividad',
        targetRef: { activityId: evidenceModal.activityId },
      });
      setEvidenceModal((prev) => ({ ...prev, linkInput: result.url }));
      const res = await updateActividad(evidenceModal.activityId, { evidenceLink: result.url, evidenceNasPath: result.nasPath || null });
      if (res?.ok === false) {
        toast.danger(res.error || 'No se pudo guardar el enlace de evidencia.');
      } else {
        toast.success('📤 Evidencia guardada — se sincronizará con el NAS en unos minutos.');
      }
    } catch (err) {
      console.error('Error al subir evidencia de actividad:', err);
      toast.danger('No se pudo subir el archivo de evidencia.');
    } finally {
      setEvidenceUploading(false);
    }
  };

  /** Guarda el link de evidencia (carpeta/archivo en el NAS local) de la actividad abierta en el modal */
  const handleSaveEvidenceLink = async () => {
    if (!evidenceModal.activityId) return;
    const res = await updateActividad(evidenceModal.activityId, { evidenceLink: evidenceModal.linkInput.trim() });
    if (res?.ok !== false) {
      toast.success('🗄️ Enlace de evidencia guardado.');
      closeEvidenceModal();
    } else {
      toast.danger(res.error || 'No se pudo guardar el enlace de evidencia.');
    }
  };

  /** Marca el semáforo de Auditoría de Calidad de una entrega de área como "Cumple" */
  const handleMarkAuditCumple = async (entity) => {
    const res = entity.mode === 'project'
      ? await setQualityVerdictProject(entity.projectId, 'cumple', user?.name || 'Calidad')
      : await setQualityVerdict(entity.gameId, entity.areaId, 'cumple', user?.name || 'Calidad');
    if (res?.ok !== false) {
      toast.success('✅ Entrega marcada como conforme.');
    } else {
      toast.danger(res.error || 'No se pudo guardar el semáforo de calidad.');
    }
  };

  /** Abre/cierra el recuadro de motivo antes de confirmar "No Cumple" */
  const toggleAuditReasonBox = (nodeId, show) => {
    setAuditReasonDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], showReasonBox: show } }));
  };

  const setAuditReasonText = (nodeId, text) => {
    setAuditReasonDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], text } }));
  };

  const handleConfirmAuditNoCumple = async (nodeId, entity) => {
    const notes = (auditReasonDrafts[nodeId]?.text || '').trim();
    const res = entity.mode === 'project'
      ? await setQualityVerdictProject(entity.projectId, 'no_cumple', user?.name || 'Calidad', notes)
      : await setQualityVerdict(entity.gameId, entity.areaId, 'no_cumple', user?.name || 'Calidad', notes);
    if (res?.ok !== false) {
      toast.warning('❌ Entrega marcada como no conforme.');
      setAuditReasonDrafts((prev) => ({ ...prev, [nodeId]: { showReasonBox: false, text: '' } }));
    } else {
      toast.danger(res.error || 'No se pudo guardar el semáforo de calidad.');
    }
  };

  /** Reabre el semáforo a "pendiente" para corregirlo */
  const handleReopenAudit = async (entity) => {
    const res = entity.mode === 'project'
      ? await setQualityVerdictProject(entity.projectId, 'pendiente', user?.name || 'Calidad')
      : await setQualityVerdict(entity.gameId, entity.areaId, 'pendiente', user?.name || 'Calidad');
    if (!res?.ok) toast.danger(res.error || 'No se pudo reabrir el semáforo de calidad.');
  };

  const setAuditEvidenceText = (nodeId, text) => {
    setAuditEvidenceDrafts((prev) => ({ ...prev, [nodeId]: text }));
  };

  const handleSaveAuditEvidenceLink = async (nodeId, entity) => {
    const link = auditEvidenceDrafts[nodeId] ?? entity.evidenceLink ?? '';
    const res = entity.mode === 'project'
      ? await setQualityVerdictEvidenceLinkProject(entity.projectId, link)
      : await setQualityVerdictEvidenceLink(entity.gameId, entity.areaId, link);
    if (res?.ok) {
      toast.success('🗄️ Enlace de evidencia guardado.');
    } else {
      toast.danger(res.error || 'No se pudo guardar el enlace de evidencia.');
    }
  };

  /** Sube el archivo de evidencia de una Auditoría de Calidad directo al NAS (con respaldo/migración automática) */
  const handleUploadAuditEvidence = async (nodeId, entity, file) => {
    if (!file) return;
    setAuditEvidenceUploading((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const result = await uploadEvidenceFile(file, {
        category: 'calidad',
        areaId: entity.areaId,
        areaName: entity.areaId ? (dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId) : null,
        gameId: entity.gameId,
        gameName: entity.game?.name,
        projectId: entity.mode === 'project' ? entity.projectId : entity.game?.projectId,
        projectName: entity.mode === 'project' ? entity.project?.name : undefined,
        targetType: entity.mode === 'project' ? 'auditVerdictProject' : 'auditVerdict',
        targetRef: entity.mode === 'project' ? { projectId: entity.projectId } : { gameId: entity.gameId, areaId: entity.areaId },
      });
      setAuditEvidenceDrafts((prev) => ({ ...prev, [nodeId]: result.url }));
      const res = entity.mode === 'project'
        ? await setQualityVerdictEvidenceLinkProject(entity.projectId, result.url, result.nasPath)
        : await setQualityVerdictEvidenceLink(entity.gameId, entity.areaId, result.url, result.nasPath);
      if (res?.ok) {
        toast.success('📤 Evidencia guardada — se sincronizará con el NAS en unos minutos.');
      } else {
        toast.danger(res.error || 'No se pudo guardar el enlace de evidencia.');
      }
    } catch (err) {
      console.error('Error al subir evidencia de auditoría:', err);
      toast.danger('No se pudo subir el archivo de evidencia.');
    } finally {
      setAuditEvidenceUploading((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  /**
   * Reabre o cambia de estado una actividad
   */
  const handleResetActivityStatus = useCallback(
    async (activityId, targetStatus = 'pendiente') => {
      if (!db || !activityId) return;
      const act = actividades.find((a) => a.id === activityId);
      if (act && !canUserControlActivity(act)) {
        toast.warning('🔒 No tienes permisos para cambiar el estado de esta actividad.');
        return;
      }
      try {
        const updates = {
          status: targetStatus,
          updatedAt: new Date().toISOString(),
        };
        if (targetStatus === 'pendiente') {
          updates.startedAt = null;
          updates.completedAt = null;
          updates.completionNotes = '';
        } else if (targetStatus === 'proceso') {
          updates.completedAt = null;
        }
        await updateDoc(doc(db, 'actividades', activityId), updates);
        toast.info(`🔄 Estado de la actividad cambiado a "${targetStatus}".`);
      } catch (err) {
        console.error('Error al cambiar estado de actividad:', err);
      }
    },
    [actividades, canUserControlActivity, toast]
  );

  const handleCreateNewBlockNode = () => {
    spawnNode('bloque', {
      blockName: nodeModal.newBlockName.trim() || 'Nodo de Trabajo',
      areaId: nodeModal.newBlockAreaId || (dynamicAreas[0]?.id || 'herreria'),
      projectId: null,
      gameId: null,
      operarioId: null,
      activityIds: [],
    });
    closeNodeModal();
    toast.success(`📦 Bloque "${nodeModal.newBlockName.trim() || 'Nodo de Trabajo'}" creado en el lienzo.`);
  };

  /** Actualiza cualquier propiedad de un Bloque (nombre, proyecto, juego, área, colaborador) */
  const updateBlockField = (nodeId, field, value) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === nodeId ? { ...n, [field]: value } : n));
      saveToFirestore(next, edges);
      return next;
    });
  };

  /** Permite personalizar el color de cualquier nodo */
  const updateNodeColor = (nodeId, color) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === nodeId ? { ...n, customColor: color } : n));
      saveToFirestore(next, edges);
      return next;
    });
  };

  /** Permite personalizar el color del cable / conexión */
  const updateEdgeColor = (edgeId, color) => {
    setEdges((prev) => {
      const next = prev.map((e) => (e.id === edgeId ? { ...e, customColor: color } : e));
      saveToFirestore(nodes, next);
      return next;
    });
  };

  /** Permite cambiar el estilo de línea del cable (solido, dashed, grueso) */
  const updateEdgeStyle = (edgeId, style) => {
    setEdges((prev) => {
      const next = prev.map((e) => (e.id === edgeId ? { ...e, style } : e));
      saveToFirestore(nodes, next);
      return next;
    });
  };

  /**
   * Invierte a qué nodo "apunta" un cable (from↔to, junto con sus puertos) — define hacia
   * dónde colapsa: colapsar el nodo "from" oculta al "to", nunca al revés. Como el cable
   * se pudo haber dibujado en cualquier orden al crearlo, esto permite corregirlo después
   * sin tener que borrar y volver a conectar.
   */
  const reverseEdgeDirection = (edgeId) => {
    setEdges((prev) => {
      const next = prev.map((e) =>
        e.id === edgeId ? { ...e, from: e.to, to: e.from, fromPort: e.toPort, toPort: e.fromPort } : e
      );
      saveToFirestore(nodes, next);
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

    // 1. Resolver colaborador responsable conectado al bloque
    const colabEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'colaborador') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'colaborador')
    );
    const connectedColabNode = colabEdge
      ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
      : null;
    const assignedOperarioId = blockNode.operarioId || connectedColabNode?.refId || null;

    // 2. Resolver proyecto vinculado
    const projEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'proyecto') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'proyecto')
    );
    const connectedProjNode = projEdge
      ? findNode(findNode(projEdge.from)?.type === 'proyecto' ? projEdge.from : projEdge.to)
      : null;
    const assignedProjectId =
      blockNode.projectId ||
      connectedProjNode?.refId ||
      null;
    const assignedProject = proyectos.find((p) => p.id === assignedProjectId);
    const assignedProjectName = assignedProject?.name || (connectedProjNode ? nodeTitle(connectedProjNode) : null);

    // 3. Resolver juego vinculado
    const gameEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'juego') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'juego')
    );
    const connectedGameNode = gameEdge
      ? findNode(findNode(gameEdge.from)?.type === 'juego' ? gameEdge.from : gameEdge.to)
      : null;
    const assignedGameId = blockNode.gameId || connectedGameNode?.refId || null;

    // 4. Resolver área vinculada
    const areaEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'area') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'area')
    );
    const connectedAreaNode = areaEdge
      ? findNode(findNode(areaEdge.from)?.type === 'area' ? areaEdge.from : areaEdge.to)
      : null;
    const assignedAreaId = blockNode.areaId || connectedAreaNode?.refId || (dynamicAreas[0]?.id || 'herreria');

    const links = blockActivityForm.linksText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    setIsSavingBlockActivity(true);
    const newId = await addActividad({
      title: blockActivityForm.title.trim(),
      description: blockActivityForm.description || 'Sin descripción.',
      areaId: assignedAreaId,
      projectId: assignedProjectId,
      projectName: assignedProjectName,
      gameId: assignedGameId,
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
    const newId = await addProject({
      name: node.draftFields.name,
      client: node.draftFields.client,
      status: node.draftFields.status || 'diseno',
      itemsToManufacture: node.draftFields.itemsToManufacture || '',
      areas: node.draftFields.areas || ['arquitectura', 'diseno', 'herreria', 'corte-laser'],
    });
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
    if (!lienzoActivoId) return;
    window.open(
      `/editor-visual/ventana/${lienzoActivoId}`,
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
      {isHeaderCollapsed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', background: 'var(--card-bg)', borderRadius: '12px', marginBottom: '10px' }}>
          <button
            type="button"
            className={styles.snapToggleBtn}
            title="Mostrar encabezado completo"
            onClick={() => setIsHeaderCollapsed(false)}
          >
            ▾ Editor Visual de Asignaciones
          </button>
        </div>
      ) : (
      <PageHeader
        title="Editor Visual de Asignaciones"
        subtitle="Crea y relaciona Proyectos, Juegos, Actividades, Áreas y Colaboradores arrastrando conexiones."
        shape="arco-doble"
        accentColor="var(--color-secondary)"
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHeaderCollapsed(true)}
            title="Minimizar el encabezado para ganar espacio de lienzo"
          >
            ▲ Minimizar
          </Button>

          {!standalone && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsLienzoSwitcherOpen(true)}
              title="Cambiar de lienzo o crear uno nuevo para trabajo aislado"
            >
              🗂️ {lienzosList.find((l) => l.id === lienzoActivoId)?.name || (lienzoActivoId === 'general' ? 'Lienzo General' : lienzoActivoId)} ▾
            </Button>
          )}

          {canEditDiagram && nodes.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAutoArrange}
              title="Reorganizar nodos ordenadamente en cuadrícula"
            >
              🧹 Reorganizar
            </Button>
          )}

          {nodes.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportDiagram}
              isLoading={isExporting}
              title="Descargar diagrama en imagen PNG"
            >
              📥 Exportar PNG
            </Button>
          )}

          {!standalone && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenStandalone}
              title="Abrir editor en ventana completa aparte"
            >
              🗔 Ventana Aparte
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setHowtoOpen(true)}
            title="Guía rápida de uso"
          >
            ❓ ¿Cómo funciona?
          </Button>

          {standalone && (
            <Button variant="secondary" size="sm" onClick={() => window.close()}>
              ✕ Cerrar Ventana
            </Button>
          )}
        </div>
      </PageHeader>
      )}

      <LienzoSwitcherModal
        isOpen={isLienzoSwitcherOpen}
        onClose={() => setIsLienzoSwitcherOpen(false)}
        lienzos={lienzosList}
        lienzoActivoId={lienzoActivoId}
        onNavigate={(id) => {
          setIsLienzoSwitcherOpen(false);
          navigate(`/editor-visual/${id}`);
        }}
      />

      {/* ---------- BARRA DE CONTROL PRINCIPAL DEL LIENZO MASTER ---------- */}
      {!standalone && (
        <div className={styles.canvasControlBar}>
          {/* ---------- 🎯 FILTRO Y LOCALIZADOR DE PROYECTOS EN EL LIENZO ---------- */}
          <div className={styles.canvasControlGroup}>
            <span className={styles.canvasControlLabel} style={{ color: 'var(--color-secondary, #2563eb)', fontWeight: 800 }}>
              🎯 Localizar Proyecto:
            </span>
            <select
              value={focusedProjectId}
              onChange={(e) => handleFocusProjectCluster(e.target.value)}
              className={styles.projectSelect}
              title="Filtrar y redirigir la vista hacia la zona de nodos del proyecto seleccionado"
            >
              <option value="">-- Todos los Proyectos en Lienzo --</option>
              {(() => {
                const presentProjs = proyectos.filter((p) => (projectNodesStats[p.id]?.count || 0) > 0);
                const absentProjs = proyectos.filter((p) => (projectNodesStats[p.id]?.count || 0) === 0);

                return (
                  <>
                    {presentProjs.length > 0 && (
                      <optgroup label={`🟢 En este Lienzo (${presentProjs.length})`} style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                        {presentProjs.map((p) => {
                          const count = projectNodesStats[p.id]?.count || 0;
                          return (
                            <option key={`pres-${p.id}`} value={p.id}>
                              📍 {p.name} · ({count} {count === 1 ? 'nodo' : 'nodos'})
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {absentProjs.length > 0 && (
                      <optgroup label={`⚪ Otros del Sistema (${absentProjs.length})`} style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                        {absentProjs.map((p) => (
                          <option key={`abs-${p.id}`} value={p.id}>
                            ➕ {p.name} (Sin nodos en el lienzo)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </>
                );
              })()}
            </select>

            {focusedProjectId && (
              <>
                {(projectNodesStats[focusedProjectId]?.count || 0) > 0 ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleFocusProjectCluster(focusedProjectId)}
                      title="Recentrar y encuadrar los nodos de este proyecto en pantalla"
                    >
                      🎯 Enfocar Zona
                    </Button>
                    <button
                      type="button"
                      className={`${styles.snapToggleBtn} ${isIsolateProjectMode ? styles.active : ''}`}
                      onClick={() => setIsIsolateProjectMode((prev) => !prev)}
                      title={isIsolateProjectMode ? 'Mostrando solo este proyecto (Aislamiento activo)' : 'Aislar visualmente y atenuar otros proyectos'}
                      style={{ height: '32px' }}
                    >
                      {isIsolateProjectMode ? '👁️ Foco Activo' : '👁️ Aislar'}
                    </button>
                  </>
                ) : (
                  canEditDiagram && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSpawnProjectInCenter(focusedProjectId)}
                      title="Colocar el nodo de este proyecto en el centro del lienzo"
                    >
                      ➕ Colocar en Lienzo
                    </Button>
                  )
                )}
              </>
            )}
          </div>

          {canEditDiagram && (
            <div className={styles.canvasControlGroup}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleManualSaveCanvas}
                title="Guardar manualmente todos los cambios"
              >
                {saveStatus === 'saving' ? '⏳ Guardando...' : '💾 Guardar Lienzo'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleReconcileCanvasAssignments(true)}
                title="Sincronizar y aplicar conexiones en la base de datos"
              >
                🔄 Sincronizar Asignaciones
              </Button>

              {nodes.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setClearNodesConfirm(true)}
                  title="Quitar todos los nodos del lienzo para empezar en limpio"
                  style={{ color: 'var(--color-alert)' }}
                >
                  🧹 Vaciar
                </Button>
              )}

              <span
                className={styles.canvasLiveBadge}
                title="Tus cambios se guardan automáticamente en Firestore"
              >
                <span className={styles.liveDot} />
                {saveStatus === 'saving' ? 'Guardando...' : 'Guardado'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.workspace}>
          {/* ---------- Botón Flotante Circular: Abre/Cierra Panel de Herramientas ---------- */}
          <button
            type="button"
            className={`${styles.floatingTriggerBtn} ${isLeftRailOpen ? styles.floatingTriggerBtnActive : ''}`}
            onClick={() => setIsLeftRailOpen((prev) => !prev)}
            title={isLeftRailOpen ? 'Cerrar panel de herramientas (Espacio limpio)' : 'Abrir herramientas y nodos (➕)'}
          >
            {isLeftRailOpen ? '✕' : '➕'}
          </button>

          {/* ---------- Panel Flotante Translúcido (Glassmorphism) ---------- */}
          <AnimatePresence>
            {isLeftRailOpen && (
              <motion.aside
                className={styles.floatingLeftRail}
                initial={{ opacity: 0, scale: 0.88, x: -12, y: -12 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, x: -12, y: -12 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.floatingRailHeader}>
                  <h2 className={styles.railTitle}>Herramientas del Lienzo</h2>
                  <button
                    type="button"
                    className={styles.floatingCloseBtn}
                    onClick={() => setIsLeftRailOpen(false)}
                    title="Cerrar panel flotante"
                  >
                    ✕
                  </button>
                </div>

                {/* Herramientas y Mantenimiento del Lienzo */}
                {nodes.length > 0 && canEditDiagram && (
                  <div style={{ marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', marginBottom: '6px' }}>
                      🧹 Mantenimiento del Lienzo
                    </div>
                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => {
                        setClearNodesConfirm(true);
                        setIsLeftRailOpen(false);
                      }}
                      title="Quitar todos los nodos del lienzo para empezar en limpio"
                      style={{ fontSize: '11px', padding: '5px 10px', color: 'var(--color-alert)' }}
                    >
                      🧹 Vaciar Nodos del Lienzo
                    </button>
                  </div>
                )}

                {canEditDiagram ? (
                  <div className={styles.palette}>
                    <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', marginBottom: '8px' }}>
                      ➕ Agregar Nodos al Lienzo
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#2563eb' }}
                        onClick={() => {
                          openNodeModal('proyecto');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Proyecto"
                      >
                        <span style={{ fontSize: '18px' }}>🗂️</span>
                        <div>
                          <strong>Proyecto</strong>
                          <small>Cliente / Orden</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#0d9488' }}
                        onClick={() => {
                          openNodeModal('juego');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Juego o Modelo 3D"
                      >
                        <span style={{ fontSize: '18px' }}>🎮</span>
                        <div>
                          <strong>Juego / Modelo</strong>
                          <small>Estructura física</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#9333ea' }}
                        onClick={() => {
                          openNodeModal('colaborador');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Colaborador / Personal"
                      >
                        <span style={{ fontSize: '18px' }}>👷</span>
                        <div>
                          <strong>Colaborador</strong>
                          <small>Operario / Personal</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#6366f1' }}
                        onClick={() => {
                          openNodeModal('area');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar estación de Taller de Manufactura"
                      >
                        <span style={{ fontSize: '18px' }}>🏭</span>
                        <div>
                          <strong>Área de Taller</strong>
                          <small>Estación de planta</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#dc2626' }}
                        onClick={() => {
                          // Directo, sin picker: se agrega sin vincular a ningún Juego/Área
                          // todavía — se resuelve solo (área y juego) al conectarlo por
                          // cable a la Actividad que va a auditar.
                          if (!canEditDiagram) return;
                          spawnNode('auditoria-calidad', { draft: false, refId: null, draftFields: {} });
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar semáforo de Auditoría de Calidad — conéctalo a la Actividad que va a auditar"
                      >
                        <span style={{ fontSize: '18px' }}>🔍</span>
                        <div>
                          <strong>Auditoría Calidad</strong>
                          <small>Cumple / No cumple</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#d97706', gridColumn: 'span 2' }}
                        onClick={() => {
                          openNodeModal('actividad');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Actividad / Tarea"
                      >
                        <span style={{ fontSize: '18px' }}>📌</span>
                        <div>
                          <strong>Actividad</strong>
                          <small>Tarea individual, imágenes y enlaces</small>
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
                  <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', marginBottom: '6px' }}>
                    🎯 Localizar Proyecto en Lienzo
                  </div>
                  <select
                    value={focusedProjectId}
                    onChange={(e) => {
                      handleFocusProjectCluster(e.target.value);
                      setIsLeftRailOpen(false);
                    }}
                    className={styles.searchInput}
                    style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '10px' }}
                  >
                    <option value="">-- Selecciona Proyecto --</option>
                    {(() => {
                      const presentProjs = proyectos.filter((p) => (projectNodesStats[p.id]?.count || 0) > 0);
                      const absentProjs = proyectos.filter((p) => (projectNodesStats[p.id]?.count || 0) === 0);
                      return (
                        <>
                          {presentProjs.length > 0 && (
                            <optgroup label="🟢 En este Lienzo">
                              {presentProjs.map((p) => (
                                <option key={`rail-p-${p.id}`} value={p.id}>
                                  📍 {p.name} ({projectNodesStats[p.id]?.count} nodos)
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {absentProjs.length > 0 && (
                            <optgroup label="⚪ Otros Proyectos">
                              {absentProjs.map((p) => (
                                <option key={`rail-a-${p.id}`} value={p.id}>
                                  ➕ {p.name} (Sin nodos)
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                </div>

                <div>
                  <h2 className={styles.railTitle} style={{ marginBottom: '6px' }}>Buscar Nodo</h2>
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
                          onClick={() => {
                            handleFocusNode(n);
                            setIsLeftRailOpen(false);
                          }}
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
                  <h2 className={styles.railTitle} style={{ marginBottom: '6px' }}>Qué Significa Cada Línea</h2>
                  <ul className={styles.legend}>
                    <li><span className={styles.dot} style={{ background: 'var(--color-secondary)' }} /><span>Proyecto → Juego: <em>pertenece a</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-tiffany-blue)' }} /><span>Juego → Área: <em>requiere</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área ↔ Colaborador: <em>asignado a</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área → Actividad: <em>incluye</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-golden-yellow)' }} /><span>Actividad → Colaborador: <em>responsable</em></span></li>
                  </ul>
                </div>

                <p className={styles.hint}>
                  💡 Conecta arrastrando los puntos entre nodos. Los paneles flotantes te dan el 100% de espacio libre en tu pantalla.
                </p>
              </motion.aside>
            )}
          </AnimatePresence>

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
                    if (hiddenNodeIds.has(n.id)) return null;
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
              className={`${styles.world} ${isCameraAnimating ? styles.worldSmooth : ''}`}
              style={{
                transform: `translate(${worldOffset.x}px, ${worldOffset.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: WORKSPACE_WIDTH,
                height: WORKSPACE_HEIGHT,
              }}
            >
              {/* Marco delimitador visual del espacio de trabajo — oculto por defecto, ver botón "⬚ Marco" */}
              {showWorkspaceBoundary && (
              <div className={styles.workspaceBoundary}>
                <div className={styles.originMarker}>
                  <span className={styles.originIcon}>⌖</span>
                  <span>Origen</span>
                  <span className={styles.axisX}>X →</span>
                  <span className={styles.axisY}>↓ Y</span>
                </div>
                <div className={styles.workspaceDimLabelTop}>Espacio de Trabajo: {WORKSPACE_WIDTH.toLocaleString('es-MX')} × {WORKSPACE_HEIGHT.toLocaleString('es-MX')} mm</div>
              </div>
              )}
              <svg className={styles.wires} width={worldBounds.width} height={worldBounds.height}>
                {edges.map((edge) => {
                  const fromNode = findNode(edge.from);
                  const toNode = findNode(edge.to);
                  if (!fromNode || !toNode || hiddenNodeIds.has(edge.from) || hiddenNodeIds.has(edge.to)) return null;

                  const { path: pathData, p1, p2 } = getSmartWirePath(fromNode, toNode, edge, nodeSizesRef.current);

                  const juegoEntity = fromNode.type === 'juego' ? getLinkedEntity(fromNode) : null;
                  const areaEntity = toNode.type === 'area' ? getLinkedEntity(toNode) : null;
                  const isBlockedLink = Boolean(
                    juegoEntity && areaEntity && isAreaBlockedByRoute(juegoEntity, areaEntity.id)
                  );

                  // Detección de enlace de secuencia entre actividades en cascada
                  const isActToAct = fromNode.type === 'actividad' && toNode.type === 'actividad';
                  const fromActEntity = fromNode.type === 'actividad' ? getLinkedEntity(fromNode) : null;
                  const isPredecessorDone = fromActEntity?.status === 'completado' || fromActEntity?.status === 'hecho';
                  const isPredecessorInProgress = fromActEntity?.status === 'proceso';

                  const nodeColor = fromNode.customColor || NODE_TYPES[fromNode.type]?.colorVar || '#ea580c';
                  let wireColor = edge.customColor || (isBlockedLink ? '#ef4444' : nodeColor);
                  if (isActToAct && !edge.customColor) {
                    if (isPredecessorDone) {
                      wireColor = '#10b981'; // Verde neón: fase previa culminada, flujo abierto a la siguiente
                    } else if (isPredecessorInProgress) {
                      wireColor = '#2563eb'; // Azul proceso activo
                    } else {
                      wireColor = '#94a3b8'; // Gris neutro en espera
                    }
                  }
                  
                  // LAS LÍNEAS SON PUNTEADAS (DASHED) POR DEFECTO
                  const isDashed = edge.style !== 'solid';
                  const isSelected = selectedEdgeId === edge.id;

                  // Aislamiento visual por proyecto
                  const isWireInFocusedProject = !focusedProjectId || !isIsolateProjectMode ||
                    (activeProjectClusterNodeIds.has(edge.from) && activeProjectClusterNodeIds.has(edge.to));
                  const wireIsolationClass = isIsolateProjectMode && !isWireInFocusedProject ? styles.wireDimmed : '';

                  return (
                    <g key={edge.id} className={`${styles.wireGroup} ${isSelected ? styles.wireGroupSelected : ''} ${wireIsolationClass}`}>
                      {/* Área de clic ampliada e invisible — el trazo visible es delgado y
                          difícil de acertar; esta franja más ancha (sin pintar) es la que
                          realmente recibe el clic para seleccionar el cable */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="22"
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEdgeId(isSelected ? null : edge.id);
                          setSelectedNodeId(null);
                        }}
                      />
                      {/* Trazo de halo suave / Resplandor cuando está seleccionado o flujo activo */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isSelected ? '#ffffff' : (isActToAct && isPredecessorDone ? '#10b981' : wireColor)}
                        strokeWidth={isSelected ? '10' : (isActToAct && isPredecessorDone ? '8' : '7')}
                        strokeOpacity={isSelected ? '0.45' : (isActToAct && isPredecessorDone ? '0.35' : '0.2')}
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* Trazo de cable punteado interactivo */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={wireColor}
                        strokeWidth={edge.style === 'thick' ? '3.8' : (isSelected ? '3.5' : (isActToAct && isPredecessorDone ? '3.2' : '2.8'))}
                        strokeDasharray={isDashed ? (isBlockedLink ? '5 4' : '7 5') : 'none'}
                        className={`${styles.wirePath} ${isDashed ? styles.wireDashed : ''} ${isSelected ? styles.wireSelected : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEdgeId(isSelected ? null : edge.id);
                          setSelectedNodeId(null);
                        }}
                      >
                        <title>
                          {isBlockedLink
                            ? `🔒 Bloqueado: ${dynamicAreas.find((a) => a.id === getBlockingAreaForRoute(juegoEntity, areaEntity.id))?.name} todavía no completa su meta. Clic para cambiar color o desconectar.`
                            : isActToAct
                            ? `🔗 Secuencia de proceso: ${isPredecessorDone ? '✅ Fase previa culminada (flujo abierto)' : '⏳ Fase previa en espera / proceso'}`
                            : 'Clic en este cable para cambiar su color o desconectarlo'}
                        </title>
                      </path>
                      {/* Punto de origen y flecha de destino — muestran hacia dónde "apunta" el
                          cable (define qué se oculta al colapsar el nodo de origen; se puede
                          invertir con "⇄ Invertir" en la barra del cable seleccionado) */}
                      <circle cx={p1.x} cy={p1.y} r={isSelected ? '5.5' : '4'} fill={wireColor} stroke="#ffffff" strokeWidth="2" style={{ pointerEvents: 'none' }} />
                      {(() => {
                        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                        const arrowSize = isSelected ? 9 : 7;
                        const wingAngle = Math.PI / 6.5;
                        const ax1 = p2.x - arrowSize * Math.cos(angle - wingAngle);
                        const ay1 = p2.y - arrowSize * Math.sin(angle - wingAngle);
                        const ax2 = p2.x - arrowSize * Math.cos(angle + wingAngle);
                        const ay2 = p2.y - arrowSize * Math.sin(angle + wingAngle);
                        return (
                          <polygon
                            points={`${p2.x},${p2.y} ${ax1},${ay1} ${ax2},${ay2}`}
                            fill={wireColor}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                            style={{ pointerEvents: 'none' }}
                          />
                        );
                      })()}
                    </g>
                  );
                })}
                {previewWire && (
                  <path
                    className={styles.wirePreview}
                    d={previewBezier(
                      { x: previewWire.x1, y: previewWire.y1 },
                      { x: previewWire.x2, y: previewWire.y2 },
                      previewWire.dir1
                    )}
                  />
                )}
              </svg>

              {/* Caja de Selección Múltiple tipo Marquee / Rectángulo CAD */}
              {selectionBox && (
                <div
                  className={styles.selectionMarquee}
                  style={{
                    left: Math.min(selectionBox.startX, selectionBox.currentX),
                    top: Math.min(selectionBox.startY, selectionBox.currentY),
                    width: Math.abs(selectionBox.currentX - selectionBox.startX),
                    height: Math.abs(selectionBox.currentY - selectionBox.startY),
                  }}
                />
              )}

              {nodes.map((node) => {
                if (hiddenNodeIds.has(node.id)) return null;
                const meta = NODE_TYPES[node.type] || DEFAULT_NODE_META;
                const nodeThemeColor = node.customColor || meta.colorVar || '#ea580c';
                const entity = getLinkedEntity(node);
                const info = node.type === 'recurso' ? getResourcePreviewInfo(node) : null;
                const isNodeSelected = selectedNodeIds.has(node.id) || selectedNodeId === node.id;
                
                // Aislamiento visual y resaltado por proyecto
                const isNodeInFocusedProject = !focusedProjectId || !isIsolateProjectMode || activeProjectClusterNodeIds.has(node.id);
                const isMainProjectNode = focusedProjectId && node.type === 'proyecto' && (node.refId === focusedProjectId || node.id === focusedProjectId);
                const nodeIsolationClass = isIsolateProjectMode && !isNodeInFocusedProject ? styles.nodeDimmed : (isMainProjectNode ? styles.nodeFocusedProject : '');

                // Estado en Proceso para activación de la Luz LED RGB Trasera (Exclusivo para Nodos Principales)
                const isNodeInProcess = (() => {
                  if (node.type === 'actividad') {
                    return entity?.status === 'proceso';
                  }
                  if (node.type === 'proyecto' || node.type === 'juego') {
                    return entity?.status === 'progreso' || entity?.status === 'proceso';
                  }
                  if (node.type === 'bloque') {
                    const blockActivityIds = node.activityIds || [];
                    return actividades.some((a) => blockActivityIds.includes(a.id) && a.status === 'proceso');
                  }
                  return false;
                })();

                // Actividad asignada al usuario con sesión iniciada — marca de pertenencia,
                // no de estatus (independiente del brillo RGB de "en proceso" de arriba).
                const isNodeMine = node.type === 'actividad' && isActivityAssignedToMe(entity);

                // 1. DISTINCIÓN CLARA: ENLACE vs ARCHIVO DE IMAGEN
                const isLinkResource = node.type === 'recurso' && Boolean(
                  info?.isLink ||
                  node.draftFields?.resourceType === 'link' ||
                  (node.draftFields?.url && !node.draftFields?.fileData && !node.draftFields?.url?.match(/\.(jpeg|jpg|png|webp|gif|svg|avif)($|\?)/i))
                );

                const isImageResource = node.type === 'recurso' && !isLinkResource && Boolean(
                  info?.previewImgSrc ||
                  node.draftFields?.resourceType === 'imagen' ||
                  node.draftFields?.fileData?.dataUrl ||
                  node.draftFields?.fileData?.url
                );

                if (isImageResource) {
                  const imgSrc = info?.previewImgSrc || node.draftFields?.fileData?.dataUrl || node.draftFields?.fileData?.url || node.draftFields?.url;
                  const currentImgBg = node.customBg || node.draftFields?.bgColor || 'transparent';
                  const nextBgCycle = currentImgBg === 'transparent' ? 'dark' : currentImgBg === 'dark' ? 'light' : currentImgBg === 'light' ? 'blur' : 'transparent';

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeSizesRef.current[node.id] = { width: el.offsetWidth, height: el.offsetHeight };
                      }}
                      data-type="recurso"
                      className={`${styles.framelessImageNode} ${isNodeSelected ? styles.selected : ''} ${nodeIsolationClass}`}
                      style={{ left: node.x, top: node.y, width: 230 }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    >
                      <div
                        className={styles.framelessImageWrap}
                        style={{
                          background: currentImgBg === 'dark' ? '#0f172a' : currentImgBg === 'light' ? '#ffffff' : currentImgBg === 'blur' ? 'rgba(15, 23, 42, 0.8)' : 'transparent',
                          border: currentImgBg !== 'transparent' ? '1.5px solid rgba(255, 255, 255, 0.2)' : 'none',
                        }}
                      >
                        <img
                          src={imgSrc}
                          alt={nodeTitle(node)}
                          className={styles.framelessImg}
                          style={{
                            filter: currentImgBg === 'transparent' ? 'drop-shadow(0 10px 24px rgba(0, 0, 0, 0.6))' : 'none',
                          }}
                          onError={(e) => {
                            e.target.style.opacity = '0.5';
                          }}
                        />
                        <div className={styles.framelessOverlay}>
                          <div className={styles.framelessHeader}>
                            <span className={styles.framelessTitle}>🖼️ {nodeTitle(node)}</span>
                            {canEditDiagram && (
                              <button
                                type="button"
                                className={styles.framelessCloseBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloseNode(node.id);
                                }}
                                title="Quitar imagen del lienzo"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          <div className={styles.framelessActions}>
                            <button
                              type="button"
                              className={`${styles.framelessBtn} ${styles.framelessBtnPrimary}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewResourceModal({
                                  isOpen: true,
                                  title: nodeTitle(node),
                                  resourceType: 'imagen',
                                  url: imgSrc,
                                  fileData: node.draftFields?.fileData || null,
                                  notes: node.draftFields?.notes || '',
                                });
                              }}
                              title="Ampliar en pantalla completa"
                            >
                              🔍 Ampliar
                            </button>
                            <button
                              type="button"
                              className={styles.framelessBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, customBg: nextBgCycle } : n));
                                setNodes(nextNodes);
                                saveToFirestore(nextNodes, edges);
                                toast.info(`Fondo: ${nextBgCycle === 'transparent' ? 'Transparente (Solo figura)' : nextBgCycle === 'dark' ? 'Oscuro' : nextBgCycle === 'light' ? 'Blanco' : 'Translúcido'}`);
                              }}
                              title="Cambiar fondo: Transparente (solo figura) / Oscuro / Blanco"
                            >
                              🎨 Fondo
                            </button>
                            {info?.fileUrl && !info.fileUrl.startsWith('data:') && (
                              <button
                                type="button"
                                className={styles.framelessBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                }}
                                title="Descargar imagen"
                              >
                                📥
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 4 PUERTOS DE CONEXIÓN */}
                      {canEditDiagram && (
                        <>
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="in"
                            className={`${styles.port} ${styles.portIn}`}
                            title="Conectar (lado izquierdo)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="out"
                            className={`${styles.port} ${styles.portOut}`}
                            title="Conectar (lado derecho)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="top"
                            className={`${styles.port} ${styles.portTop}`}
                            title="Conectar (arriba)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'top')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="bottom"
                            className={`${styles.port} ${styles.portBottom}`}
                            title="Conectar (abajo)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'bottom')}
                          />
                        </>
                      )}
                    </div>
                  );
                }

                // 2. RECURSO DE ENLACE WEB / DRIVE / FIGMA (FLOTANTE MINIMALISTA SIN MARCO - EMBLEMA)
                if (isLinkResource) {
                  const provider = info?.linkProvider || { name: 'Enlace Web', icon: '🌐' };
                  const targetUrl = info?.effectiveUrl || node.draftFields?.url || '#';
                  const isDrive = Boolean(targetUrl.includes('drive.google.com') || targetUrl.includes('docs.google.com'));
                  const isFigma = Boolean(targetUrl.includes('figma.com'));
                  const isAutodesk = Boolean(targetUrl.includes('autodesk'));

                  const renderLinkBrandSymbol = (urlStr) => {
                    const u = (urlStr || '').toLowerCase();
                    if (u.includes('drive.google.com') || u.includes('docs.google.com')) {
                      return (
                        <svg viewBox="0 0 87.3 78" width="38" height="34" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }}>
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47"/>
                          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.15z" fill="#ea4335"/>
                          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                          <path d="m59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5l-13.75-23.8c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8z" fill="#ffba00"/>
                          <path d="m73.55 76.8H27.5L13.75 53h59.8z" fill="#2684fc"/>
                        </svg>
                      );
                    }
                    if (u.includes('figma.com')) {
                      return (
                        <svg viewBox="0 0 38 57" width="24" height="36" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }}>
                          <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1abcfe"/>
                          <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0acf83"/>
                          <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#ff7262"/>
                          <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#f24e1e"/>
                          <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#a259ff"/>
                        </svg>
                      );
                    }
                    if (u.includes('autodesk') || u.includes('viewer.autodesk')) {
                      return (
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px rgba(234,88,12,0.6))' }}>
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                          <line x1="12" y1="22.08" x2="12" y2="12"/>
                        </svg>
                      );
                    }
                    if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo.com')) {
                      return (
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="#ef4444" style={{ filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.6))' }}>
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                      );
                    }
                    if (u.includes('onedrive') || u.includes('1drv.ms') || u.includes('sharepoint')) {
                      return (
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px rgba(2,132,199,0.6))' }}>
                          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                        </svg>
                      );
                    }
                    // Enlace Web estándar con aura cian
                    return (
                      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.6))' }}>
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                    );
                  };

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeSizesRef.current[node.id] = { width: el.offsetWidth, height: el.offsetHeight };
                      }}
                      data-type="recurso"
                      className={`${styles.framelessLinkNode} ${isNodeSelected ? styles.selected : ''} ${nodeIsolationClass}`}
                      style={{ left: node.x, top: node.y }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    >
                      {/* EMBLEMA CENTRAL FLOTANTE */}
                      <div
                        className={styles.framelessLinkEmblem}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Si el clic viene justo después de arrastrar el nodo a otra
                          // posición, no abrir el enlace — solo se movió, no se quiso abrir.
                          if (justDraggedRef.current) {
                            justDraggedRef.current = false;
                            return;
                          }
                          if (targetUrl && targetUrl !== '#') {
                            window.open(targetUrl, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        title={`Arrastra para mover · Clic para abrir enlace: ${targetUrl}`}
                      >
                        {renderLinkBrandSymbol(targetUrl)}

                        {canEditDiagram && (
                          <button
                            type="button"
                            className={styles.framelessLinkEmblemClose}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseNode(node.id);
                            }}
                            title="Quitar enlace del lienzo"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* BADGE COMPACTO FLOTANTE DEBAJO DEL EMBLEMA */}
                      <div className={styles.framelessLinkBadge}>
                        <span className={styles.framelessLinkBadgeSub}>
                          {isDrive ? 'Google Drive' : isFigma ? 'Figma' : isAutodesk ? 'Autodesk 3D' : provider.name}
                        </span>
                        <span className={styles.framelessLinkBadgeTitle}>
                          {nodeTitle(node)}
                        </span>
                      </div>

                      {/* BOTÓN RÁPIDO AL PASAR EL MOUSE */}
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.framelessLinkOpenBtn}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>Abrir</span> <span>↗</span>
                      </a>

                      {/* 4 PUERTOS DE CONEXIÓN ALREDEDOR DEL EMBLEMA */}
                      {canEditDiagram && (
                        <>
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="in"
                            className={`${styles.port} ${styles.portIn}`}
                            style={{ top: '34px', left: '29px' }}
                            title="Conectar (lado izquierdo)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="out"
                            className={`${styles.port} ${styles.portOut}`}
                            style={{ top: '34px', right: '29px' }}
                            title="Conectar (lado derecho)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="top"
                            className={`${styles.port} ${styles.portTop}`}
                            style={{ top: '-7px', left: 'calc(50% - 7px)' }}
                            title="Conectar (arriba)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'top')}
                          />
                          <span
                            data-role="port"
                            data-node-id={node.id}
                            data-side="bottom"
                            className={`${styles.port} ${styles.portBottom}`}
                            style={{ top: '61px', left: 'calc(50% - 7px)' }}
                            title="Conectar (abajo)"
                            onMouseDown={(e) => handlePortMouseDown(e, node.id, 'bottom')}
                          />
                        </>
                      )}
                    </div>
                  );
                }

                if (node.type === 'auditoria-calidad') {
                  const isAuditExpanded = expandedAuditNodes.has(node.id);
                  const areaName = entity && entity.mode === 'game' ? (dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId) : null;
                  const auditTargetLabel = entity ? (entity.mode === 'project' ? (entity.project?.name || entity.projectId) : areaName) : null;
                  const canEditAudit = entity && (entity.mode === 'project' ? canUserEditProjectAudit(user) : canUserEditRoute(user, entity.game));
                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeSizesRef.current[node.id] = { width: el.offsetWidth, height: el.offsetHeight };
                      }}
                      data-type="auditoria-calidad"
                      className={`${styles.framelessAuditNode} ${isNodeSelected ? styles.selected : ''} ${nodeIsolationClass}`}
                      style={{ left: node.x, top: node.y }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    >
                      {/* ETIQUETA FLOTANTE ARRIBA */}
                      <div className={styles.framelessAuditBadge}>
                        <span className={styles.framelessAuditBadgeSub}>🔍 Auditoría</span>
                        <span className={styles.framelessAuditBadgeTitle}>
                          {entity ? auditTargetLabel : node.refId ? 'No encontrada' : '🔗 Sin conectar'}
                        </span>
                        {entity?.assignedToName && (
                          <span className={styles.framelessAuditBadgeAssignee}>👤 {entity.assignedToName}</span>
                        )}
                      </div>

                      {/* CUERPO: LA FORMA DEL SEMÁFORO EN SÍ */}
                      <div
                        className={styles.framelessAuditHousing}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (justDraggedRef.current) {
                            justDraggedRef.current = false;
                            return;
                          }
                          if (entity) toggleAuditExpanded(node.id);
                        }}
                        title={entity ? 'Clic para consultar / editar' : 'Conecta este semáforo por cable a la Actividad que va a auditar'}
                      >
                        <span className={styles.framelessAuditLight} style={{
                          background: entity?.status === 'no_cumple' ? '#ef4444' : 'rgba(239, 68, 68, 0.18)',
                          boxShadow: entity?.status === 'no_cumple' ? '0 0 9px 3px rgba(239, 68, 68, 0.85)' : 'none',
                        }} />
                        <span className={styles.framelessAuditLight} style={{
                          background: entity?.status === 'pendiente' ? '#eab308' : 'rgba(234, 179, 8, 0.18)',
                          boxShadow: entity?.status === 'pendiente' ? '0 0 9px 3px rgba(234, 179, 8, 0.85)' : 'none',
                        }} />
                        <span className={styles.framelessAuditLight} style={{
                          background: entity?.status === 'cumple' ? '#22c55e' : 'rgba(34, 197, 94, 0.18)',
                          boxShadow: entity?.status === 'cumple' ? '0 0 9px 3px rgba(34, 197, 94, 0.85)' : 'none',
                        }} />

                        {canEditDiagram && (
                          <button
                            type="button"
                            className={styles.framelessLinkEmblemClose}
                            onClick={(e) => { e.stopPropagation(); handleCloseNode(node.id); }}
                            title="Quitar del lienzo"
                          >
                            ✕
                          </button>
                        )}

                        {canEditDiagram && (
                          <>
                            <span data-role="port" data-node-id={node.id} data-side="in" className={`${styles.port} ${styles.portIn}`} style={{ top: '46px', left: '-7px' }} title="Conectar (izquierda)" onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')} />
                            <span data-role="port" data-node-id={node.id} data-side="out" className={`${styles.port} ${styles.portOut}`} style={{ top: '46px', right: '-7px' }} title="Conectar (derecha)" onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')} />
                            <span data-role="port" data-node-id={node.id} data-side="top" className={`${styles.port} ${styles.portTop}`} style={{ top: '-7px', left: 'calc(50% - 7px)' }} title="Conectar (arriba)" onMouseDown={(e) => handlePortMouseDown(e, node.id, 'top')} />
                            <span data-role="port" data-node-id={node.id} data-side="bottom" className={`${styles.port} ${styles.portBottom}`} style={{ bottom: '-7px', left: 'calc(50% - 7px)' }} title="Conectar (abajo)" onMouseDown={(e) => handlePortMouseDown(e, node.id, 'bottom')} />
                          </>
                        )}
                      </div>

                      {/* PANEL DESPLEGABLE — solo al consultar, no deforma el semáforo */}
                      {isAuditExpanded && entity && (
                        <div className={styles.framelessAuditPanel} onMouseDown={(e) => e.stopPropagation()}>
                          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>
                            {entity.mode === 'project' ? `📁 ${entity.project?.name} (Proyecto sin Juego)` : `🎮 ${entity.game?.name} · 🏭 ${areaName}`}
                          </div>
                          <strong style={{ fontSize: '13px' }}>
                            {entity.status === 'cumple' ? '🟢 Cumple' : entity.status === 'no_cumple' ? '🔴 No Cumple' : '🟡 Pendiente'}
                          </strong>

                          {entity.reviewedBy && (
                            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                              {entity.reviewedBy} · {new Date(entity.reviewedAt).toLocaleString('es-MX')}
                              {entity.notes && <div style={{ fontStyle: 'italic', marginTop: '2px' }}>"{entity.notes}"</div>}
                            </div>
                          )}

                          {/* Enlace de evidencia (NAS) — mismo patrón que Proyecto/Juego/Actividad */}
                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.15)' }}>
                            <label style={{ fontSize: '9.5px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                              🗄️ Evidencia (NAS)
                            </label>
                            {canEditAudit ? (
                              <>
                                <input
                                  type="file"
                                  disabled={Boolean(auditEvidenceUploading[node.id])}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleUploadAuditEvidence(node.id, entity, file);
                                    e.target.value = '';
                                  }}
                                  style={{ fontSize: '10.5px', marginTop: '3px', width: '100%' }}
                                />
                                {auditEvidenceUploading[node.id] && (
                                  <p style={{ fontSize: '10px', color: '#67e8f9', fontWeight: 700, margin: '3px 0 0' }}>⏳ Subiendo...</p>
                                )}
                                <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
                                  <input
                                    type="text"
                                    placeholder="O pega un link manual"
                                    value={auditEvidenceDrafts[node.id] ?? entity.evidenceLink ?? ''}
                                    onChange={(e) => setAuditEvidenceText(node.id, e.target.value)}
                                    style={{ flex: 1, fontSize: '11px', padding: '5px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', color: '#f1f5f9' }}
                                  />
                                  <button type="button" onClick={() => handleSaveAuditEvidenceLink(node.id, entity)} style={{ padding: '5px 8px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', cursor: 'pointer' }}>
                                    💾
                                  </button>
                                  {entity.evidenceLink && (
                                    <button type="button" onClick={() => window.open(entity.evidenceLink, '_blank', 'noopener,noreferrer')} style={{ padding: '5px 8px', fontSize: '11px', fontWeight: 700, background: 'rgba(8, 145, 178, 0.25)', color: '#67e8f9', border: '1px solid rgba(8, 145, 178, 0.4)', borderRadius: '6px', cursor: 'pointer' }}>
                                      Abrir
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : entity.evidenceLink ? (
                              <button type="button" onClick={() => window.open(entity.evidenceLink, '_blank', 'noopener,noreferrer')} style={{ display: 'block', marginTop: '3px', width: '100%', padding: '5px 8px', fontSize: '11px', fontWeight: 700, background: 'rgba(8, 145, 178, 0.25)', color: '#67e8f9', border: '1px solid rgba(8, 145, 178, 0.4)', borderRadius: '6px', cursor: 'pointer' }}>
                                🗄️ Abrir Evidencia
                              </button>
                            ) : (
                              <p style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Sin evidencia capturada.</p>
                            )}
                          </div>

                          {canEditAudit ? (
                            <div style={{ marginTop: '8px' }}>
                              {entity.status !== 'pendiente' ? (
                                <button type="button" onClick={() => handleReopenAudit(entity)} style={{ width: '100%', padding: '5px 8px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', cursor: 'pointer' }}>
                                  🔄 Reabrir para corregir
                                </button>
                              ) : auditReasonDrafts[node.id]?.showReasonBox ? (
                                <>
                                  <textarea
                                    rows={2}
                                    placeholder="Motivo por el que no cumple..."
                                    value={auditReasonDrafts[node.id]?.text || ''}
                                    onChange={(e) => setAuditReasonText(node.id, e.target.value)}
                                    style={{ width: '100%', fontSize: '11px', padding: '5px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', marginBottom: '6px', background: 'rgba(255,255,255,0.06)', color: '#f1f5f9' }}
                                  />
                                  <div style={{ display: 'flex', gap: '5px' }}>
                                    <button type="button" onClick={() => handleConfirmAuditNoCumple(node.id, entity)} style={{ flex: 1, padding: '5px 8px', fontSize: '11px', fontWeight: 700, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                                      Confirmar
                                    </button>
                                    <button type="button" onClick={() => toggleAuditReasonBox(node.id, false)} style={{ padding: '5px 8px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.1)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', cursor: 'pointer' }}>
                                      Cancelar
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div style={{ display: 'flex', gap: '5px' }}>
                                  <button type="button" onClick={() => handleMarkAuditCumple(entity)} style={{ flex: 1, padding: '6px 8px', fontSize: '11px', fontWeight: 700, background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                                    ✅ Cumple
                                  </button>
                                  <button type="button" onClick={() => toggleAuditReasonBox(node.id, true)} style={{ flex: 1, padding: '6px 8px', fontSize: '11px', fontWeight: 700, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                                    ❌ No Cumple
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', fontStyle: 'italic' }}>
                              🔒 {entity.mode === 'project' ? 'Solo Calidad o Dirección' : 'Solo Calidad o supervisor de esta área'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeSizesRef.current[node.id] = { width: el.offsetWidth, height: el.offsetHeight };
                    }}
                    data-type={node.type}
                    className={`${styles.node} ${isNodeSelected ? styles.selected : ''} ${isNodeInProcess ? styles.nodeInProcess : ''} ${nodeIsolationClass}`}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, '--node-color': nodeThemeColor }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  >
                    {isNodeMine && (
                      <div
                        title="Asignada a ti"
                        style={{
                          position: 'absolute',
                          top: '-10px',
                          left: '-10px',
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                          border: '2px solid #ffffff',
                          boxShadow: '0 2px 6px rgba(109, 40, 217, 0.5)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          zIndex: 20,
                          pointerEvents: 'none',
                        }}
                      >
                        👤
                      </div>
                    )}
                    <div className={styles.nodeHead}>
                      <span className={styles.nodeIcon}>{meta.icon}</span>
                      <span className={styles.nodeTitle}>{nodeTitle(node)}</span>
                      {(() => {
                        const isCollapsed = collapsedNodeIds.has(node.id);
                        const neighborCount = getDirectChildIds(node.id).size;
                        // El botón aparece en cualquier tipo de nodo, siempre que colapsar
                        // vaya a ocultar algo de verdad: o el nodo tiene hijos propios, o
                        // alguno de sus hermanos (mismo padre — ver getCollapseGroupIds) sí
                        // los tiene, porque el clic colapsa a todo el grupo junto. Si ya
                        // estaba colapsado, se deja expandir aunque el grafo haya cambiado.
                        const groupHasSomethingToHide = isCollapsed
                          || [...getCollapseGroupIds(node.id)].some((id) => getDirectChildIds(id).size > 0);
                        if (!groupHasSomethingToHide) return null;
                        return (
                          <button
                            type="button"
                            data-role="collapse"
                            className={styles.nodeCollapseBtn}
                            title={isCollapsed ? `Expandir ${neighborCount} nodo(s) conectado(s)` : 'Colapsar (junto con los demás nodos del mismo padre)'}
                            onClick={() => toggleNodeCollapsed(node.id)}
                          >
                            {isCollapsed ? `▸ ${neighborCount}` : '▾'}
                          </button>
                        );
                      })()}
                      <span className={styles.nodeBadge}>
                        {node.type === 'bloque' ? 'TRABAJO' : (node.draft ? 'NUEVO' : meta.badgeText)}
                      </span>
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
                      {/* DISEÑO DISTINTIVO POR TIPO DE NODO */}
                      {node.type === 'proyecto' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🗂️ PROYECTO EJECUTIVO</span>
                            {entity?.status && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.15)', color: nodeThemeColor, fontWeight: 800 }}>
                                {entity.status.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '12px', fontWeight: 700 }}>
                                  🏢 Cliente: {entity.client || 'General'}
                                </div>
                                {entity.itemsToManufacture && (
                                  <div style={{ fontSize: '11px', color: 'var(--color-dark)', background: 'rgba(37, 99, 235, 0.06)', padding: '3px 6px', borderRadius: '4px', marginTop: '4px', borderLeft: '3px solid #2563eb' }}>
                                    <strong>🛠️ A Fabricar:</strong> {entity.itemsToManufacture}
                                  </div>
                                )}
                                {entity.areas && entity.areas.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                                    {entity.areas.map((aId) => {
                                      const aObj = allBlockAreas.find((x) => x.id === aId);
                                      const isTech = aId === 'arquitectura' || aId === 'diseno' || aId === 'supervision';
                                      return (
                                        <span
                                          key={aId}
                                          style={{
                                            fontSize: '9.5px',
                                            fontWeight: 700,
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                            background: isTech ? 'rgba(14, 165, 233, 0.15)' : 'rgba(0,0,0,0.06)',
                                            color: isTech ? '#0284c7' : 'var(--color-gray-700)',
                                          }}
                                        >
                                          {aObj?.icon || (isTech ? '📐' : '🏭')} {aObj?.name || aId}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                                <div style={{ width: '100%', height: '6px', background: 'rgba(0,0,0,0.08)', borderRadius: '3px', marginTop: '6px', overflow: 'hidden' }}>
                                  <div style={{ width: `${entity.progress ?? 0}%`, height: '100%', background: nodeThemeColor }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  <span>Progreso Global</span>
                                  <strong>{entity.progress ?? 0}%</strong>
                                </div>
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Proyecto' : 'Proyecto del sistema'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'juego' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🎮 MODELO DE JUEGO</span>
                            {entity?.status && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(13, 148, 136, 0.15)', color: nodeThemeColor, fontWeight: 800 }}>
                                {entity.status.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                {/* Proyecto vinculado: detectado por cable o por projectId */}
                                {(() => {
                                  const connectedProjEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'proyecto') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'proyecto')
                                  );
                                  const connectedProjNode = connectedProjEdge
                                    ? findNode(findNode(connectedProjEdge.from)?.type === 'proyecto' ? connectedProjEdge.from : connectedProjEdge.to)
                                    : null;
                                  const projName = connectedProjNode
                                    ? nodeTitle(connectedProjNode)
                                    : (entity.projectName && entity.projectName !== 'General'
                                      ? entity.projectName
                                      : (entity.projectId ? proyectos.find((p) => p.id === entity.projectId)?.name : null));

                                  return (
                                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--color-secondary, #2563eb)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span>🗂️</span> <span>{projName ? `Proyecto: ${projName}` : 'Sin proyecto vinculado (conectar cable)'}</span>
                                    </div>
                                  );
                                })()}

                                {/* Áreas requeridas en ruta de fabricación — cada una es un botón que
                                    abre "Registrar Entrega" directo para esa área, sin salir del
                                    lienzo, si el usuario puede registrar producción ahí. */}
                                {entity.areas && entity.areas.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0' }}>
                                    {entity.areas.map((arId) => {
                                      const aName = dynamicAreas.find((a) => a.id === arId)?.name || arId;
                                      const canRegister = !isReadOnlySection(user, 'produccion', arId);
                                      const badgeStyle = {
                                        fontSize: '10px',
                                        background: 'rgba(13, 148, 136, 0.12)',
                                        color: nodeThemeColor,
                                        padding: '2px 5px',
                                        borderRadius: '4px',
                                        fontWeight: 700,
                                        border: 'none',
                                        cursor: canRegister ? 'pointer' : 'default',
                                      };
                                      if (!canRegister) {
                                        return (
                                          <span key={arId} style={badgeStyle}>🏭 {aName}</span>
                                        );
                                      }
                                      return (
                                        <button
                                          key={arId}
                                          type="button"
                                          style={badgeStyle}
                                          title={`📦 Registrar Entrega — ${aName}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDeliveryModal({ isOpen: true, gameId: entity.id, areaId: arId, areaLabel: aName });
                                          }}
                                        >
                                          🏭 {aName} 📦
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Barra de avance */}
                                <div style={{ width: '100%', height: '5px', background: 'rgba(0,0,0,0.08)', borderRadius: '3px', marginTop: '6px', overflow: 'hidden' }}>
                                  <div style={{ width: `${entity.progress ?? 0}%`, height: '100%', background: nodeThemeColor }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  <span>Avance de Fabricación</span>
                                  <strong>{entity.progress ?? 0}%</strong>
                                </div>

                                {/* Sub-listado de las actividades derivadas de este Juego — ligadas por
                                    dato (gameId), no por cable, para que se vea igual sin importar si el
                                    cable Juego→Actividad sigue conectado en este lienzo. */}
                                {(() => {
                                  const gameActivities = actividades.filter((a) => a.gameId === entity.id);
                                  if (gameActivities.length === 0) return null;
                                  const STATUS_META = {
                                    completado: { icon: '✅', color: '#10b981' },
                                    proceso: { icon: '⚡', color: '#2563eb' },
                                    pendiente: { icon: '⏳', color: '#6b7280' },
                                  };
                                  const visible = gameActivities.slice(0, 5);
                                  const extra = gameActivities.length - visible.length;
                                  return (
                                    <div style={{ marginTop: '5px', paddingTop: '4px', borderTop: '1px dashed rgba(0,0,0,0.08)' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-gray-500)', marginBottom: '2px' }}>
                                        📌 Actividades ({gameActivities.length})
                                      </div>
                                      {visible.map((act) => {
                                        const meta2 = STATUS_META[act.status] || STATUS_META.pendiente;
                                        return (
                                          <div
                                            key={act.id}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              fontSize: '10.5px',
                                              color: 'var(--color-gray-700)',
                                              padding: '1px 0',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}
                                            title={act.title}
                                          >
                                            <span style={{ color: meta2.color }}>{meta2.icon}</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{act.title}</span>
                                          </div>
                                        );
                                      })}
                                      {extra > 0 && (
                                        <div style={{ fontSize: '10px', color: 'var(--color-gray-400)' }}>… y {extra} más.</div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* Colaborador responsable si está conectado */}
                                {(() => {
                                  const connectedColabEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'colaborador')
                                  );
                                  const colabNode = connectedColabEdge
                                    ? findNode(findNode(connectedColabEdge.from)?.type === 'colaborador' ? connectedColabEdge.from : connectedColabEdge.to)
                                    : null;
                                  const directOperario = operarios.find((o) => o.id === entity.operarioId);
                                  const respName = directOperario?.name || (colabNode ? nodeTitle(colabNode) : null);

                                  return respName ? (
                                    <div style={{ fontSize: '11px', color: 'var(--color-gray-700)', marginTop: '4px', paddingTop: '3px', borderTop: '1px dashed rgba(0,0,0,0.08)' }}>
                                      👷 Responsable: <strong>{respName}</strong>
                                    </div>
                                  ) : null;
                                })()}
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Juego' : 'Juego del catálogo'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'actividad' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>📌 TAREA / ACTIVIDAD</span>
                            {entity?.priority && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: entity.priority === 'alta' ? 'rgba(220, 38, 38, 0.15)' : 'rgba(217, 119, 6, 0.15)', color: entity.priority === 'alta' ? '#dc2626' : nodeThemeColor, fontWeight: 800 }}>
                                {entity.priority.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '11.5px', fontWeight: 700 }}>
                                  🏭 Área: {allAvailableAreas.find((a) => a.id === entity.areaId)?.name || dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId}
                                </div>
                                {(() => {
                                  const colabEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'colaborador')
                                  );
                                  const connectedColabNode = colabEdge
                                    ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
                                    : null;
                                  const directColab = allCollaborators.find((c) => c.id === (entity?.operarioId || node?.operarioId || node?.draftFields?.operarioId));
                                  const respName = directColab?.name || (connectedColabNode ? nodeTitle(connectedColabNode) : null);

                                  return (
                                    <div style={{ fontSize: '11px', color: respName ? 'var(--color-primary, #ea580c)' : 'var(--color-gray-500)', marginTop: '2px', fontWeight: respName ? 700 : 500 }}>
                                      👷 Resp: <strong>{respName || 'Sin asignar (conectar cable)'}</strong>
                                    </div>
                                  );
                                })()}
                                {/* Estatus y Botones de Iniciar / Terminar en la tarjeta del nodo con soporte de Secuencia */}
                                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
                                  {(() => {
                                    const blockStatus = getActivityBlockStatus(node);
                                    const isSequenceBlocked = entity.status === 'pendiente' && blockStatus.isBlocked;

                                    return (
                                      <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                          <span style={{ fontSize: '10.5px', color: 'var(--color-gray-500)' }}>Estado:</span>
                                          <span
                                            style={{
                                              fontSize: '9.5px',
                                              fontWeight: 800,
                                              padding: '1.5px 6px',
                                              borderRadius: '4px',
                                              textTransform: 'uppercase',
                                              background:
                                                entity.status === 'completado'
                                                  ? 'rgba(16, 185, 129, 0.15)'
                                                  : entity.status === 'proceso'
                                                  ? 'rgba(37, 99, 235, 0.15)'
                                                  : isSequenceBlocked
                                                  ? 'rgba(239, 68, 68, 0.15)'
                                                  : 'rgba(156, 163, 175, 0.15)',
                                              color:
                                                entity.status === 'completado'
                                                  ? '#10b981'
                                                  : entity.status === 'proceso'
                                                  ? '#2563eb'
                                                  : isSequenceBlocked
                                                  ? '#ef4444'
                                                  : '#6b7280',
                                            }}
                                          >
                                            {entity.status === 'completado'
                                              ? '✅ Hecha'
                                              : entity.status === 'proceso'
                                              ? '⚡ En Proceso'
                                              : isSequenceBlocked
                                              ? '🔒 Bloqueada'
                                              : '⏳ Pendiente'}
                                          </span>
                                        </div>

                                        {/* Indicador de Sub-tareas / Checklist en el Nodo del Lienzo */}
                                          {Array.isArray(entity.checklist) && entity.checklist.length > 0 && (() => {
                                            const total = entity.checklist.length;
                                            const completed = entity.checklist.filter((c) => c.completed).length;
                                            const pct = Math.round((completed / total) * 100);
                                            const isAllDone = completed === total;
                                            return (
                                              <div
                                                style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'space-between',
                                                  background: isAllDone ? 'rgba(16, 185, 129, 0.1)' : 'rgba(6, 182, 212, 0.08)',
                                                  border: `1px solid ${isAllDone ? 'rgba(16, 185, 129, 0.3)' : 'rgba(6, 182, 212, 0.25)'}`,
                                                  borderRadius: '5px',
                                                  padding: '2.5px 6px',
                                                  marginBottom: '4px',
                                                  fontSize: '10px',
                                                }}
                                                title={`Checklist: ${completed} de ${total} sub-tareas completadas`}
                                              >
                                                <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>
                                                  ☑️ Sub-tareas:
                                                </span>
                                                <span style={{ fontWeight: 800, color: isAllDone ? '#10b981' : '#0284c7' }}>
                                                  {completed}/{total} ({pct}%)
                                                </span>
                                              </div>
                                            );
                                          })()}

                                        {isSequenceBlocked && (
                                          <div
                                            style={{
                                              fontSize: '9.5px',
                                              color: '#ef4444',
                                              background: 'rgba(239, 68, 68, 0.08)',
                                              border: '1px solid rgba(239, 68, 68, 0.25)',
                                              borderRadius: '4px',
                                              padding: '3px 6px',
                                              marginBottom: '4px',
                                              lineHeight: 1.25,
                                            }}
                                            title={blockStatus.reason}
                                          >
                                            🔒 Espera que termine: <strong>{blockStatus.blockers.map((b) => b.entity?.title || nodeTitle(b.node)).join(', ')}</strong>
                                          </div>
                                        )}

                                        {(() => {
                                          const hasControl = canUserControlActivity(entity);
                                          if (!hasControl) {
                                            return (
                                              <div style={{ fontSize: '10px', color: 'var(--color-gray-400)', marginTop: '4px', textAlign: 'center', fontStyle: 'italic' }}>
                                                🔒 Control de responsable / supervisor
                                              </div>
                                            );
                                          }

                                          return (
                                            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                              {entity.status === 'pendiente' && (
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isSequenceBlocked) {
                                                      toast.warning(`🔒 Actividad bloqueada: Primero debe culminar "${blockStatus.blockers.map((b) => b.entity?.title || nodeTitle(b.node)).join(', ')}"`);
                                                      return;
                                                    }
                                                    handleStartActivity(entity.id, entity.title);
                                                  }}
                                                  style={{
                                                    flex: 1,
                                                    padding: '4px 8px',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    background: isSequenceBlocked
                                                      ? 'rgba(100, 116, 139, 0.2)'
                                                      : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                                    color: isSequenceBlocked ? 'var(--color-gray-400)' : '#ffffff',
                                                    border: isSequenceBlocked ? '1px dashed var(--color-gray-400)' : 'none',
                                                    borderRadius: '5px',
                                                    cursor: isSequenceBlocked ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '4px',
                                                    boxShadow: isSequenceBlocked ? 'none' : '0 1px 3px rgba(37, 99, 235, 0.3)',
                                                    opacity: isSequenceBlocked ? 0.75 : 1,
                                                  }}
                                                  title={isSequenceBlocked ? blockStatus.reason : 'Iniciar esta actividad'}
                                                >
                                                  {isSequenceBlocked ? '🔒 Espera fase previa' : '▶️ Iniciar Actividad'}
                                                </button>
                                              )}

                                              {entity.status === 'proceso' && (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleOpenCompleteModal(entity.id, entity.title);
                                                    }}
                                                    style={{
                                                      flex: 2,
                                                      padding: '4px 8px',
                                                      fontSize: '11px',
                                                      fontWeight: 700,
                                                      background: 'linear-gradient(135deg, #10b981, #059669)',
                                                      color: '#ffffff',
                                                      border: 'none',
                                                      borderRadius: '5px',
                                                      cursor: 'pointer',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      gap: '4px',
                                                      boxShadow: '0 1px 3px rgba(16, 185, 129, 0.3)',
                                                    }}
                                                    title="Marcar como terminada y registrar fecha/hora de entrega"
                                                  >
                                                    ✅ Terminar
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleResetActivityStatus(entity.id, 'pendiente');
                                                    }}
                                                    style={{
                                                      flex: 1,
                                                      padding: '4px 6px',
                                                      fontSize: '10px',
                                                      fontWeight: 600,
                                                      background: 'rgba(0,0,0,0.06)',
                                                      color: 'var(--color-gray-700)',
                                                      border: '1px solid rgba(0,0,0,0.1)',
                                                      borderRadius: '5px',
                                                      cursor: 'pointer',
                                                    }}
                                                    title="Pausar y regresar a pendiente"
                                                  >
                                                    ⏸️ Pausar
                                                  </button>
                                                </>
                                              )}

                                              {entity.status === 'completado' && (
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleResetActivityStatus(entity.id, 'proceso');
                                                  }}
                                                  style={{
                                                    flex: 1,
                                                    padding: '3px 8px',
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                    background: 'rgba(0,0,0,0.05)',
                                                    color: 'var(--color-gray-600)',
                                                    border: '1px solid rgba(0,0,0,0.1)',
                                                    borderRadius: '5px',
                                                    cursor: 'pointer',
                                                  }}
                                                  title="Reabrir esta actividad para continuarla"
                                                >
                                                  🔄 Reabrir Actividad
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}
                                </div>

                                {/* Evidencia (link al NAS local) — botón propio, siempre visible en
                                    cualquier estatus, independiente de Iniciar/Pausar/Terminar. La
                                    evidencia real vive fuera de la app (NAS del taller); aquí solo se
                                    guarda/abre el enlace. */}
                                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dotted rgba(0,0,0,0.1)' }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenEvidenceModal(entity.id, entity.title);
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      background: entity.evidenceLink ? 'linear-gradient(135deg, #0891b2, #0e7490)' : 'rgba(8, 145, 178, 0.1)',
                                      color: entity.evidenceLink ? '#ffffff' : '#0891b2',
                                      border: entity.evidenceLink ? 'none' : '1.5px dashed rgba(8, 145, 178, 0.4)',
                                      borderRadius: '5px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '5px',
                                    }}
                                    title="Ver o capturar el enlace de evidencia (NAS) de esta actividad"
                                  >
                                    🗄️ {entity.evidenceLink ? 'Ver Evidencia (NAS)' : 'Agregar Evidencia (NAS)'}
                                  </button>
                                </div>

                                {/* Recursos adjuntos (enlaces / imágenes) y botón para colocarlos en el lienzo */}
                                {Boolean((entity.links && entity.links.length > 0) || (entity.attachments && entity.attachments.length > 0) || entity.fileData) && (
                                  <div style={{ marginTop: '6px', paddingTop: '4px', borderTop: '1px dotted rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '10px', color: 'var(--color-gray-500)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                      📎 {(entity.attachments?.length || (entity.fileData ? 1 : 0)) + (entity.links?.length || 0)} recurso(s)
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeployAllActivityResources(node, entity);
                                      }}
                                      style={{
                                        fontSize: '9.5px',
                                        fontWeight: 700,
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(37, 99, 235, 0.1)',
                                        color: '#2563eb',
                                        border: '1px solid rgba(37, 99, 235, 0.2)',
                                        cursor: 'pointer',
                                      }}
                                      title="Colocar / mostrar todos los enlaces e imágenes en el lienzo"
                                    >
                                      📍 Mostrar en Lienzo
                                    </button>
                                  </div>
                                )}
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Actividad' : 'Actividad del sistema'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'colaborador' && (
                        <div>
                          <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>👷 PERSONAL / COLABORADOR</span>
                          <div className={styles.nodeTag} style={{ marginTop: '3px' }}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '12px', fontWeight: 700 }}>
                                  🏭 Área: {dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  {entity.puesto || 'Operario de Producción'}
                                </div>
                                {(() => {
                                  const connectedCount = edges.filter(
                                    (e) => e.from === node.id || e.to === node.id
                                  ).length;
                                  return (
                                    <div style={{ fontSize: '10.5px', color: 'var(--color-primary)', marginTop: '4px', fontWeight: 600 }}>
                                      🔗 {connectedCount} {connectedCount === 1 ? 'asignación conectada' : 'asignaciones conectadas'}
                                    </div>
                                  );
                                })()}
                              </>
                            ) : (
                              'Colaborador del equipo'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'area' && (
                        <div>
                          <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🏭 ÁREA DE MANUFACTURA</span>
                          <div className={styles.nodeTag} style={{ marginTop: '3px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark)' }}>
                              {entity?.name || 'Taller de producción'}
                            </div>

                            {/* Supervisor a cargo */}
                            {(() => {
                              const supervisor = getSupervisorForArea(node.refId || entity?.id);
                              return (
                                <div style={{ fontSize: '11px', color: 'var(--color-primary, #ea580c)', marginTop: '4px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>👤 Supervisor:</span> <span>{supervisor.name}</span>
                                </div>
                              );
                            })()}

                            {/* Proyectos / Juegos vinculados por cable */}
                            {(() => {
                              const connectedEdges = edges.filter((e) => e.from === node.id || e.to === node.id);
                              const connectedProjects = connectedEdges
                                .map((e) => findNode(e.from === node.id ? e.to : e.from))
                                .filter((n) => n?.type === 'proyecto')
                                .map((n) => nodeTitle(n));

                              const connectedGames = connectedEdges
                                .map((e) => findNode(e.from === node.id ? e.to : e.from))
                                .filter((n) => n?.type === 'juego')
                                .map((n) => nodeTitle(n));

                              return (
                                <>
                                  {connectedProjects.length > 0 && (
                                    <div style={{ fontSize: '10.5px', color: 'var(--color-secondary, #2563eb)', marginTop: '3px', fontWeight: 600 }}>
                                      🗂️ Proy: {connectedProjects.join(', ')}
                                    </div>
                                  )}
                                  {connectedGames.length > 0 && (
                                    <div style={{ fontSize: '10.5px', color: '#0d9488', marginTop: '2px', fontWeight: 600 }}>
                                      🎮 Modelos: {connectedGames.join(', ')}
                                    </div>
                                  )}
                                </>
                              );
                            })()}

                            <div style={{ fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>👥 {operarios.filter((o) => o.currentArea === (node.refId || entity?.id)).length} operarios</span>
                              <span
                                style={{
                                  cursor: 'pointer',
                                  color: 'var(--color-primary, #ea580c)',
                                  fontWeight: 700,
                                  textDecoration: 'underline',
                                  textDecorationStyle: 'dotted',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const targetAreaId = node.refId || entity?.id;
                                  const targetAreaName = entity?.name || nodeTitle(node);
                                  setAreaTasksModal({ isOpen: true, areaId: targetAreaId, areaName: targetAreaName });
                                }}
                                title="Clic para ver las tareas asignadas a esta estación"
                              >
                                📌 {actividades.filter((a) => a.areaId === (node.refId || entity?.id)).length} tareas
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {node.type === 'recurso' && (() => {
                        const info = getResourcePreviewInfo(node);
                        const isUploading = node.draftFields?.fileData?.isUploading || node.draftFields?.isUploading;

                        return (
                          <div>
                            {/* MINIATURA / VISTA PREVIA DIRECTA SEGÚN CONTENIDO */}
                            {isUploading && (
                              <div className={styles.resourceThumbnailBox} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(6, 182, 212, 0.08)', gap: '6px' }}>
                                <div style={{ fontSize: '18px', animation: 'spin 1s linear infinite' }}>⏳</div>
                                <span style={{ fontSize: '10.5px', color: '#0891b2', fontWeight: 600 }}>Guardando en la nube...</span>
                              </div>
                            )}

                            {/* 1. VISTA PREVIA DE IMAGEN / RENDER (Directa o desde Google Drive) */}
                            {!isUploading && info.previewImgSrc && (
                              <div
                                className={styles.resourceThumbnailBox}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewResourceModal({
                                    isOpen: true,
                                    title: nodeTitle(node),
                                    resourceType: info.resType,
                                    url: info.rawUrl || info.previewImgSrc,
                                    fileData: node.draftFields?.fileData,
                                    notes: node.draftFields?.notes || '',
                                  });
                                }}
                                title="Clic para ampliar en pantalla completa"
                              >
                                <img
                                  src={info.previewImgSrc}
                                  alt={nodeTitle(node)}
                                  className={styles.resourceThumbnailImg}
                                  onError={(e) => {
                                    e.target.style.opacity = '0.5';
                                  }}
                                />
                                <div className={styles.resourcePreviewHover}>
                                  <span>🔍 Ampliar</span>
                                </div>
                              </div>
                            )}

                            {/* 2. MODELO 3D CAD: SOLIDWORKS, INVENTOR, STEP, DWG */}
                            {!isUploading && !info.previewImgSrc && info.isModel && (
                              <div
                                className={styles.resourceModelBadge}
                                style={{
                                  background: info.cadBrand === 'solidworks' ? 'rgba(225, 29, 72, 0.08)' : info.cadBrand === 'inventor' ? 'rgba(217, 119, 6, 0.08)' : 'rgba(13, 148, 136, 0.08)',
                                  borderColor: info.cadColor || '#0d9488',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (info.fileUrl && !info.fileUrl.startsWith('data:')) {
                                    window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                  } else {
                                    setPreviewResourceModal({
                                      isOpen: true,
                                      title: nodeTitle(node),
                                      resourceType: 'modelo',
                                      url: info.effectiveUrl,
                                      fileData: node.draftFields?.fileData,
                                      notes: node.draftFields?.notes || '',
                                    });
                                  }
                                }}
                                title="Clic para descargar / abrir ficha CAD"
                              >
                                <span style={{ fontSize: '22px' }}>{info.cadIcon || '🧊'}</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 800, color: info.cadColor || '#0d9488' }}>
                                    {info.cadLabel || 'Modelo 3D CAD'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {info.fileName || (info.fileSize ? `${Math.round(info.fileSize / 1024)} KB` : 'Descargar archivo CAD')}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 3. DOCUMENTO / PLANO PDF */}
                            {!isUploading && !info.previewImgSrc && info.isPdf && (
                              <div
                                className={styles.resourceDocBadge}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (info.effectiveUrl) {
                                    window.open(formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer');
                                  } else {
                                    setPreviewResourceModal({
                                      isOpen: true,
                                      title: nodeTitle(node),
                                      resourceType: 'documento',
                                      url: info.effectiveUrl,
                                      fileData: node.draftFields?.fileData,
                                      notes: node.draftFields?.notes || '',
                                    });
                                  }
                                }}
                                title="Clic para abrir plano PDF"
                              >
                                <span style={{ fontSize: '20px' }}>📄</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#dc2626' }}>
                                    {info.fileName || 'Plano PDF'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)' }}>
                                    {info.fileSize ? `${Math.round(info.fileSize / 1024)} KB · Clic para abrir` : 'Abrir documento'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 4. ENLACE WEB DIRECTO (Google Drive, Figma, OneDrive, Web) */}
                            {!isUploading && !info.previewImgSrc && !info.isModel && !info.isPdf && info.rawUrl && (
                              <div
                                className={styles.resourceLinkBadge}
                                style={{
                                  borderColor: info.linkProvider?.color ? `${info.linkProvider.color}40` : undefined,
                                  background: info.linkProvider?.color ? `${info.linkProvider.color}10` : undefined,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Redirección directa al hacer clic
                                  window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                                }}
                                title={`Clic para ir directamente a: ${info.rawUrl}`}
                              >
                                <span style={{ fontSize: '20px' }}>{info.linkProvider?.icon || '🔗'}</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 800, color: info.linkProvider?.color || '#2563eb' }}>
                                    {info.linkProvider?.name || 'Enlace Externo'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {info.rawUrl.replace(/^https?:\/\//i, '').split('/')[0]} · Clic para abrir ↗
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 5. VACÍO (Sin archivo ni URL) */}
                            {!isUploading && !info.previewImgSrc && !info.isModel && !info.isPdf && !info.rawUrl && (
                              <div
                                className={styles.resourceEmptyBox}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedNodeId(node.id);
                                }}
                                title="Haz clic para seleccionar y cargar un archivo o enlace en el panel derecho"
                              >
                                📂 <strong>Sin archivo adjunto</strong>
                                <div style={{ fontSize: '10px', marginTop: '2px' }}>Haz clic para configurar en panel</div>
                              </div>
                            )}

                            {/* INDICADOR DE ACTIVIDAD / PROYECTO ASIGNADO POR CABLE */}
                            {(() => {
                              const connectedEdge = edges.find(
                                (e) =>
                                  (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
                                  (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
                              );
                              const targetNode = connectedEdge
                                ? findNode(findNode(connectedEdge.from)?.type === 'actividad' || findNode(connectedEdge.from)?.type === 'proyecto' ? connectedEdge.from : connectedEdge.to)
                                : null;

                              if (targetNode) {
                                return (
                                  <div style={{ fontSize: '10.5px', color: 'var(--color-primary, #ea580c)', fontWeight: 700, margin: '3px 0', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    <span>{targetNode.type === 'proyecto' ? '🗂️ Ligado a Proy:' : '📌 Ligado a Tarea:'}</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nodeTitle(targetNode)}</span>
                                  </div>
                                );
                              }
                              return (
                                <div style={{ fontSize: '10px', color: 'var(--color-gray-400)', fontStyle: 'italic', margin: '2px 0' }}>
                                  🔌 Conecta un cable a una Actividad o Proyecto
                                </div>
                              );
                            })()}

                            {/* BOTONES DE ACCIÓN HIPER-INTELIGENTES SEGÚN EL TIPO DE RECURSO */}
                            <div className={styles.resourceActions}>
                              {/* Caso A: Es solo Imagen (Archivo o Render) */}
                              {info.previewImgSrc && !info.rawUrl && (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewResourceModal({
                                        isOpen: true,
                                        title: nodeTitle(node),
                                        resourceType: 'imagen',
                                        url: info.previewImgSrc,
                                        fileData: node.draftFields?.fileData || null,
                                        notes: node.draftFields?.notes || '',
                                      });
                                    }}
                                    title="Ampliar imagen en pantalla completa"
                                  >
                                    🔍 Ampliar
                                  </button>
                                  {info.fileUrl && !info.fileUrl.startsWith('data:') && (
                                    <button
                                      type="button"
                                      className={styles.resourceActionBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                      }}
                                      title="Descargar imagen en alta resolución"
                                    >
                                      📥 Descargar
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Caso B: Es Enlace Web (Drive, Figma, Cloud o Web) */}
                              {info.rawUrl && (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                                    }}
                                    title={`Abrir directamente: ${info.rawUrl}`}
                                  >
                                    🌐 Ir al Enlace ↗
                                  </button>
                                  {info.previewImgSrc && (
                                    <button
                                      type="button"
                                      className={styles.resourceActionBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewResourceModal({
                                          isOpen: true,
                                          title: nodeTitle(node),
                                          resourceType: 'imagen',
                                          url: info.rawUrl || info.previewImgSrc,
                                          fileData: node.draftFields?.fileData || null,
                                          notes: node.draftFields?.notes || '',
                                        });
                                      }}
                                      title="Ampliar vista previa"
                                    >
                                      🔍 Vista Previa
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Caso C: Es Modelo 3D CAD (SolidWorks, Inventor, STEP, DWG) */}
                              {info.isModel && !info.rawUrl && (
                                <>
                                  {info.fileUrl && (
                                    <button
                                      type="button"
                                      className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                      }}
                                      title="Descargar archivo CAD a tu computadora"
                                    >
                                      📥 Descargar CAD
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={styles.resourceActionBtn}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open('https://viewer.autodesk.com/', '_blank', 'noopener,noreferrer');
                                    }}
                                    title="Abrir en visor web oficial gratuito de Autodesk"
                                  >
                                    📐 Autodesk Viewer ↗
                                  </button>
                                </>
                              )}

                              {/* Caso D: Es Documento / Plano PDF */}
                              {info.isPdf && !info.rawUrl && (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (info.effectiveUrl) window.open(formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer');
                                    }}
                                    title="Abrir plano PDF en visor del navegador"
                                  >
                                    📄 Abrir PDF ↗
                                  </button>
                                  {info.fileUrl && (
                                    <button
                                      type="button"
                                      className={styles.resourceActionBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                      }}
                                      title="Descargar archivo PDF"
                                    >
                                      📥 Descargar
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Caso E: Sin contenido todavía */}
                              {!info.previewImgSrc && !info.rawUrl && !info.isModel && !info.isPdf && (
                                <button
                                  type="button"
                                  className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedNodeId(node.id);
                                  }}
                                  title="Cargar archivo o pegar enlace en el panel lateral"
                                >
                                  ⚙️ Configurar Archivo / URL
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* 4 PUERTOS DE CONEXIÓN (IZQUIERDA, DERECHA, ARRIBA, ABAJO) */}
                    {canEditDiagram && (
                      <>
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="in"
                          className={`${styles.port} ${styles.portIn}`}
                          title="Conectar (lado izquierdo)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="out"
                          className={`${styles.port} ${styles.portOut}`}
                          title="Conectar (lado derecho)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="top"
                          className={`${styles.port} ${styles.portTop}`}
                          title="Conectar (arriba)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'top')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="bottom"
                          className={`${styles.port} ${styles.portBottom}`}
                          title="Conectar (abajo)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'bottom')}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {/* ---------- Barra Flotante Interactiva de Cable Seleccionado ---------- */}
              {selectedEdgeId && (() => {
                const edge = edges.find((e) => e.id === selectedEdgeId);
                if (!edge) return null;
                const fromNode = findNode(edge.from);
                const toNode = findNode(edge.to);
                if (!fromNode || !toNode || hiddenNodeIds.has(edge.from) || hiddenNodeIds.has(edge.to)) return null;
                const { p1, p2 } = getSmartWirePath(fromNode, toNode, edge, nodeSizesRef.current);
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const defaultColor = fromNode.customColor || NODE_TYPES[fromNode.type]?.colorVar || '#ea580c';
                const currentColor = edge.customColor || defaultColor;

                return (
                  <div
                    className={styles.wireToolbar}
                    style={{ left: midX, top: midY }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: currentColor, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      〰️ Cable:
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          className={`${styles.wireColorDot} ${currentColor === c.value ? styles.wireColorDotActive : ''}`}
                          style={{ backgroundColor: c.value }}
                          title={c.name}
                          onClick={() => updateEdgeColor(edge.id, c.value)}
                        />
                      ))}
                      <label title="Elegir cualquier color personalizado" style={{ cursor: 'pointer', display: 'inline-flex', margin: 0 }}>
                        <input
                          type="color"
                          value={currentColor}
                          onChange={(e) => updateEdgeColor(edge.id, e.target.value)}
                          style={{ width: '24px', height: '24px', border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'none', padding: 0 }}
                        />
                      </label>
                    </div>

                    <div className={styles.wireToolbarDivider} />

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => updateEdgeStyle(edge.id, edge.style === 'solid' ? 'dashed' : 'solid')}
                      title="Alternar entre línea punteada y sólida"
                    >
                      {edge.style === 'solid' ? '━━ Sólida' : '┅┅ Punteada'}
                    </button>

                    <div className={styles.wireToolbarDivider} />

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => reverseEdgeDirection(edge.id)}
                      title="Invertir hacia dónde apunta el cable (define qué se oculta al colapsar el nodo de origen)"
                    >
                      ⇄ Invertir
                    </button>

                    <div className={styles.wireToolbarDivider} />

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      style={{ color: 'var(--color-alert, #ef4444)' }}
                      onClick={() => {
                        const nextEdges = edges.filter((ed) => ed.id !== edge.id);
                        setEdges(nextEdges);
                        saveToFirestore(nodes, nextEdges);
                        setSelectedEdgeId(null);
                        toast.info('🔌 Cable desconectado.');
                      }}
                      title="Eliminar este cable"
                    >
                      🗑️ Quitar
                    </button>

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => setSelectedEdgeId(null)}
                      title="Cerrar barra"
                      style={{ padding: '3px 6px', opacity: 0.6 }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })()}

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

            {/* ---------- Barra Flotante de Selección Múltiple y Arrastre en Grupo ---------- */}
            {selectedNodeIds.size > 1 && (
              <div className={styles.multiSelectionToolbar} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.multiSelectionInfo}>
                  <span className={styles.multiSelectionBadge}>📦 {selectedNodeIds.size}</span>
                  <span>Nodos en grupo — <strong>Arrastra cualquiera para mover todo el conjunto</strong></span>
                </div>
                <div className={styles.multiSelectionActions}>
                  {selectedNodeId && (
                    <button
                      type="button"
                      className={styles.multiSelectionBtn}
                      onClick={() => handleSelectConnectedCluster(selectedNodeId)}
                      title="Seleccionar toda la cadena conectada a este nodo"
                    >
                      🔗 Cadena
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.multiSelectionBtn}
                    onClick={handleSelectAllNodes}
                    title="Seleccionar todos los nodos del lienzo"
                  >
                    📑 Todos ({nodes.length})
                  </button>
                  <button
                    type="button"
                    className={styles.multiSelectionBtnClear}
                    onClick={handleClearSelection}
                    title="Deseleccionar todos"
                  >
                    ✕ Limpiar
                  </button>
                </div>
              </div>
            )}

            {/* ---------- Barra de Información Técnica CAD (Inferior Izquierda) ---------- */}
            <div className={styles.cadInfoBar} onMouseDown={(e) => e.stopPropagation()}>
              <div className={styles.cadCoords}>
                <span>📍</span> X: {cursorCoords.x} mm &nbsp;|&nbsp; Y: {cursorCoords.y} mm
              </div>
              <div className={styles.cadShortcuts}>
                🖱️ Rueda: Zoom · Clic Rueda / Espacio: Mover · Shift+Arrastrar: Seleccionar Grupo · Alt+Arrastrar: Mover Cadena
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
              <button
                type="button"
                className={`${styles.snapToggleBtn} ${showWorkspaceBoundary ? styles.active : ''}`}
                title={showWorkspaceBoundary ? 'Ocultar marco delimitador del área de trabajo' : 'Mostrar marco delimitador del área de trabajo'}
                onClick={() => setShowWorkspaceBoundary((prev) => !prev)}
              >
                ⬚ Marco
              </button>
            </div>
          </div>

          {/* ---------- Inspector Flotante Translúcido (Glassmorphism) ---------- */}
          <AnimatePresence>
            {selectedNode && (
              <motion.aside
                className={styles.inspector}
                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <NodeInspector
                  node={selectedNode}
                  onClose={() => setSelectedNodeId(null)}
                  entity={getLinkedEntity(selectedNode)}
                  edges={edges}
                  setEdges={setEdges}
                  saveToFirestore={saveToFirestore}
                  nodes={nodes}
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
                  updateProject={updateProject}
                  updateActividad={updateActividad}
                  setNodes={setNodes}
                  canEditDiagram={canEditDiagram}
                  updateBlockField={(field, value) => updateBlockField(selectedNode.id, field, value)}
                  updateBlockName={(value) => updateBlockName(selectedNode.id, value)}
                  onSaveBlockName={() => saveToFirestore(nodes, edges)}
                  openBlockActivityForm={() => openBlockActivityForm(selectedNode.id)}
                  handleReassignBlockActivities={(colabNode) => handleReassignBlockActivities(selectedNode, colabNode)}
                  updateNodeColor={updateNodeColor}
                  updateEdgeColor={updateEdgeColor}
                  updateEdgeStyle={updateEdgeStyle}
                  dynamicAreas={dynamicAreas}
                  allBlockAreas={allBlockAreas}
                  allAvailableAreas={allAvailableAreas}
                  allCollaborators={allCollaborators}
                  getCollaboratorsForArea={getCollaboratorsForArea}
                  getSupervisorForArea={getSupervisorForArea}
                  onViewAreaTasks={(areaId, areaName) => setAreaTasksModal({ isOpen: true, areaId, areaName })}
                  onStartActivity={handleStartActivity}
                  onOpenCompleteModal={handleOpenCompleteModal}
                  onResetActivityStatus={handleResetActivityStatus}
                  canUserControlActivity={canUserControlActivity}
                  getActivityBlockStatus={getActivityBlockStatus}
                  getActivityPredecessors={getActivityPredecessors}
                  lienzoActivoId={lienzoActivoId}
                  onFocusNode={handleFocusNode}
                  onSelectConnectedCluster={handleSelectConnectedCluster}
                  previewResourceModal={previewResourceModal}
                  setPreviewResourceModal={setPreviewResourceModal}
                  handleDeployAllActivityResources={handleDeployAllActivityResources}
                  onOpenRoute={(gameId) => navigate(`/editor-visual/ruta/${gameId}?from=${lienzoActivoId}`)}
                />
              </motion.aside>
            )}
          </AnimatePresence>
      </div>

      {/* ---------- MODAL: CONFIRMAR LIMPIAR NODOS DEL LIENZO ---------- */}
      <Modal
        isOpen={clearNodesConfirm}
        onClose={() => setClearNodesConfirm(false)}
        title="🧹 Limpiar Nodos del Lienzo Actual"
      >
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.5, color: 'var(--color-dark)' }}>
          ¿Deseas remover todos los nodos y conexiones del lienzo activo? Esta acción dejará el lienzo en blanco, pero tus proyectos, juegos y colaboradores seguirán registrados a salvo en el sistema.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="md" onClick={() => setClearNodesConfirm(false)}>
            Cancelar
          </Button>
          <Button variant="danger" size="md" onClick={handleClearCurrentCanvasNodes}>
            🧹 Sí, Limpiar Nodos
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL UNIFICADO: AGREGAR / CREAR NODO EN EL LIENZO ---------- */}
      <Modal
        isOpen={nodeModal.isOpen}
        onClose={closeNodeModal}
        title={
          nodeModal.type === 'proyecto'
            ? '🗂️ Agregar Nodo de Proyecto'
            : nodeModal.type === 'juego'
            ? '🎮 Agregar Nodo de Juego / Modelo'
            : nodeModal.type === 'colaborador'
            ? '👷 Agregar Nodo de Colaborador (Personal)'
            : nodeModal.type === 'area'
            ? '🏭 Agregar Nodo de Área de Manufactura'
            : nodeModal.type === 'actividad'
            ? '📌 Agregar Nodo de Actividad / Tarea'
            : nodeModal.type === 'auditoria-calidad'
            ? '🔍 Agregar Nodo de Auditoría de Calidad'
            : '📦 Crear Celda Modular de Trabajo'
        }
      >
        {/* TABS: SELECCIONAR EXISTENTE vs CREAR NUEVO (solo para Proyecto y Juego) */}
        {(nodeModal.type === 'proyecto' || nodeModal.type === 'juego') && (
          <div className={styles.nodeModalTabs}>
            <button
              type="button"
              className={`${styles.tabBtn} ${nodeModal.tab === 'existing' ? styles.tabBtnActive : ''}`}
              onClick={() => setNodeModal((prev) => ({ ...prev, tab: 'existing' }))}
            >
              🔗 Seleccionar Existente ({catalogFor(nodeModal.type).length})
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${nodeModal.tab === 'new' ? styles.tabBtnActive : ''}`}
              onClick={() => setNodeModal((prev) => ({ ...prev, tab: 'new' }))}
            >
              ➕ Crear Nuevo Registro
            </button>
          </div>
        )}

        {/* 1. SELECCIONAR EXISTENTE (Colaborador, Área, o Proyecto/Juego en tab existing) */}
        {nodeModal.type !== 'actividad' && (nodeModal.tab === 'existing' || nodeModal.type === 'colaborador' || nodeModal.type === 'area') && (
          <div>
            <input
              type="text"
              className={styles.pickerSearch}
              placeholder={
                nodeModal.type === 'colaborador'
                  ? 'Buscar colaborador por nombre, área o puesto...'
                  : nodeModal.type === 'area'
                  ? 'Buscar área de manufactura...'
                  : 'Buscar en el catálogo...'
              }
              value={nodeModal.query}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, query: e.target.value }))}
              autoFocus
            />

            <div className={styles.pickerList}>
              {catalogFor(nodeModal.type)
                .filter((item) => item.label.toLowerCase().includes(nodeModal.query.trim().toLowerCase()))
                .map((item) => {
                  const meta = NODE_TYPES[nodeModal.type] || NODE_TYPES.bloque;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.pickerItem}
                      onClick={() => handlePickExistingNode(nodeModal.type, item.id)}
                    >
                      <span style={{ fontSize: '18px' }}>{meta.icon}</span>
                      <strong style={{ fontSize: '13px' }}>{item.label}</strong>
                      <span className={styles.pickerBadge}>➕ Soltar en lienzo</span>
                    </button>
                  );
                })}

              {catalogFor(nodeModal.type).filter((item) => item.label.toLowerCase().includes(nodeModal.query.trim().toLowerCase())).length === 0 && (
                <div className={styles.pickerEmpty}>
                  {nodeModal.type === 'colaborador'
                    ? 'Sin coincidencias. Los colaboradores se gestionan en el módulo de Operarios.'
                    : 'Sin coincidencias en el catálogo.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. CREAR NUEVO PROYECTO */}
        {nodeModal.tab === 'new' && nodeModal.type === 'proyecto' && (
          <div className={styles.inlineCreateBox}>
            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineLabel}>Nombre del Proyecto *</label>
                <input
                  type="text"
                  placeholder="Ej. Parque Central Santa Fe..."
                  value={nodeModal.newProjName}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjName: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className={styles.inlineLabel}>Cliente / Empresa *</label>
                <input
                  type="text"
                  placeholder="Ej. Municipio, Inmobiliaria..."
                  value={nodeModal.newProjClient}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjClient: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className={styles.inlineSubLabel}>🛠️ ¿Qué se fabricará en este proyecto? (Productos / Modelos / Piezas)</label>
              <textarea
                rows="2"
                placeholder="Ej. 2 Módulos infantiles, 4 bancas metálicas, 1 columpio quíntuple..."
                value={nodeModal.newProjItems}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjItems: e.target.value }))}
              />
            </div>

            <div>
              <label className={styles.inlineSubLabel}>🏭 Áreas Involucradas en el Proyecto:</label>
              <div className={styles.areasGridPills} style={{ marginTop: '4px' }}>
                {(allBlockAreas || dynamicAreas).map((area) => {
                  const isSelected = (nodeModal.newProjAreas || []).includes(area.id);
                  return (
                    <button
                      key={area.id}
                      type="button"
                      className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                      onClick={() => {
                        const current = nodeModal.newProjAreas || [];
                        const next = isSelected
                          ? current.filter((id) => id !== area.id)
                          : [...current, area.id];
                        setNodeModal((prev) => ({ ...prev, newProjAreas: next }));
                      }}
                    >
                      {isSelected ? '✓ ' : '+ '} {area.icon || '🏭'} {area.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineSubLabel}>Fecha de Inicio</label>
                <input
                  type="date"
                  value={nodeModal.newProjStartDate}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjStartDate: e.target.value }))}
                />
              </div>
              <div>
                <label className={styles.inlineSubLabel}>Fecha de Entrega</label>
                <input
                  type="date"
                  value={nodeModal.newProjEndDate}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjEndDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className={styles.inlineSubLabel}>Descripción (opcional)</label>
              <textarea
                rows="2"
                placeholder="Observaciones o notas generales..."
                value={nodeModal.newProjDesc}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjDesc: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewProjectNode}>🗂️ Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 3. CREAR NUEVO JUEGO / MODELO */}
        {nodeModal.tab === 'new' && nodeModal.type === 'juego' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Nombre del Modelo / Juego *</label>
            <input
              type="text"
              placeholder="Ej. Resbaladilla Acero Inox 3m..."
              value={nodeModal.newGameName}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newGameName: e.target.value }))}
              autoFocus
            />

            <label className={styles.inlineSubLabel}>Proyecto Perteneciente (o conecta por cable después)</label>
            <select
              value={nodeModal.newGameProjectId}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newGameProjectId: e.target.value }))}
            >
              <option value="">Sin proyecto específico (General)</option>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
              ))}
            </select>

            <label className={styles.inlineSubLabel}>Áreas de Manufactura Requeridas:</label>
            <div className={styles.areasGridPills}>
              {dynamicAreas.map((a) => {
                const isSelected = nodeModal.newGameAreas?.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                    onClick={() => {
                      let next = isSelected
                        ? nodeModal.newGameAreas.filter((id) => id !== a.id)
                        : [...nodeModal.newGameAreas, a.id];
                      if (isSelected && a.id === 'corte-laser' && next.includes('herreria')) {
                        next = next.filter((id) => id !== 'herreria');
                      }
                      if (!isSelected && a.id === 'herreria' && !next.includes('corte-laser')) {
                        next.push('corte-laser');
                      }
                      setNodeModal((prev) => ({ ...prev, newGameAreas: next }));
                    }}
                  >
                    {isSelected ? '✓ ' : '＋ '} {a.name}
                  </button>
                );
              })}
            </div>

            <label className={styles.inlineLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={nodeModal.newGameUseRoute}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newGameUseRoute: e.target.checked }))}
              />
              🛤️ Usar Ruta de Fabricación (áreas en orden, con Puntos de Calidad opcionales)
            </label>
            {nodeModal.newGameUseRoute && (
              <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', margin: '4px 0 0 0' }}>
                Al crear el juego se abrirá la Ruta de Fabricación para ordenar sus áreas.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewGameNode}>🎮 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 4. CREAR NUEVA ACTIVIDAD */}
        {nodeModal.type === 'actividad' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Título de la Tarea / Actividad *</label>
            <input
              type="text"
              placeholder="Ej. Soldar marco principal tubular..."
              value={nodeModal.newActTitle}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newActTitle: e.target.value }))}
              autoFocus
            />

            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineSubLabel}>🏭 Área Responsable / Departamento *</label>
                <select
                  value={nodeModal.newActAreaId}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newActAreaId: e.target.value, newActOperarioId: '' }))}
                >
                  {allAvailableAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.icon || '🏭'} {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.inlineSubLabel}>🎖️ Responsable del Área (Supervisa)</label>
                {(() => {
                  const sup = getSupervisorForArea(nodeModal.newActAreaId);
                  return (
                    <div
                      style={{
                        padding: '7px 11px',
                        borderRadius: '6px',
                        background: 'rgba(37, 99, 235, 0.08)',
                        border: '1.5px solid rgba(37, 99, 235, 0.3)',
                        color: 'var(--color-dark)',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        minHeight: '38px',
                        boxSizing: 'border-box',
                      }}
                      title="Supervisor oficial a cargo de esta área (Carga automática)"
                    >
                      <span style={{ fontSize: '15px' }}>🎖️</span>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span>{sup.name}</span>
                        {sup.role && (
                          <span style={{ fontSize: '10.5px', color: 'var(--color-gray-500)', fontWeight: 500, marginLeft: '5px' }}>
                            ({sup.role})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div>
              <label className={styles.inlineSubLabel}>
                👷 Personal Asignado (Operario a cargo de realizar la tarea)
              </label>
              <select
                value={nodeModal.newActOperarioId || ''}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newActOperarioId: e.target.value }))}
              >
                <option value="">-- Sin asignar a alguien específico (Asignar después) --</option>
                {(() => {
                  const filtered = getCollaboratorsForArea(nodeModal.newActAreaId);
                  const listToRender = filtered.length > 0 ? filtered : allCollaborators;
                  return listToRender.map((op) => (
                    <option key={op.id} value={op.id}>
                      👷 {op.name} {op.puesto ? `(${op.puesto})` : ''}
                    </option>
                  ));
                })()}
              </select>
            </div>

            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineSubLabel}>Prioridad</label>
                <select
                  value={nodeModal.newActPriority}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newActPriority: e.target.value }))}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.inlineSubLabel}>Fecha Límite (opcional)</label>
                <input
                  type="date"
                  value={nodeModal.newActDueDate || ''}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newActDueDate: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className={styles.inlineSubLabel}>🔗 Enlace Web o Nube (Drive, Figma, Autodesk)</label>
              <input
                type="text"
                placeholder="https://drive.google.com/... o https://figma.com/..."
                value={nodeModal.newActUrl || ''}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newActUrl: e.target.value }))}
              />
            </div>

            <div>
              <label className={styles.inlineSubLabel}>🖼️ Imagen / Archivo de Ayuda Visual (opcional)</label>
              <input
                type="file"
                accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setNodeModal((prev) => ({
                      ...prev,
                      newActPendingFile: file,
                      newActFileData: {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        dataUrl: URL.createObjectURL(file),
                      },
                    }));
                  }
                }}
              />
              {nodeModal.newActPendingFile && (
                <div style={{ marginTop: '4px', fontSize: '11.5px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>✓ {nodeModal.newActPendingFile.name} ({Math.round(nodeModal.newActPendingFile.size / 1024)} KB)</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewActivityNode}>📌 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 5. CREAR RECURSO / AYUDA VISUAL */}
        {nodeModal.type === 'recurso' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Título / Nombre de la Ayuda Visual *</label>
            <input
              type="text"
              placeholder="Ej. Plano de Ensamblaje Rev 2, Render Fachada, Modelo 3D..."
              value={nodeModal.newRecursoTitle}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoTitle: e.target.value }))}
              autoFocus
            />

            <div>
              <label className={styles.inlineSubLabel}>📁 Cargar Archivo (Imagen, PDF, SolidWorks, Inventor, STEP, DWG):</label>
              <input
                type="file"
                accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setNodeModal((prev) => ({
                      ...prev,
                      pendingFile: file,
                      newRecursoFileData: {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        dataUrl: URL.createObjectURL(file),
                      },
                    }));
                  }
                }}
              />
              {nodeModal.newRecursoFileData && (
                <div style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
                  ✓ Archivo seleccionado: {nodeModal.newRecursoFileData.name} ({Math.round(nodeModal.newRecursoFileData.size / 1024)} KB)
                </div>
              )}
            </div>

            <label className={styles.inlineSubLabel}>
              🔗 O Pegar URL / Enlace (Google Drive, Figma, OneDrive, Web):
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/... o https://figma.com/..."
              value={nodeModal.newRecursoUrl}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoUrl: e.target.value }))}
            />

            <div>
              <label className={styles.inlineSubLabel}>Instrucciones / Notas Técnicas (opcional)</label>
              <textarea
                rows="2"
                placeholder="Cotas críticas, tolerancias, especificaciones de armado..."
                value={nodeModal.newRecursoNotes}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoNotes: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewRecursoNode}>📎 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- MODAL: VISTA PREVIA Y LIGHTBOX DE AYUDA VISUAL / ARCHIVO ---------- */}
      <Modal
        isOpen={previewResourceModal.isOpen}
        onClose={() => setPreviewResourceModal((prev) => ({ ...prev, isOpen: false }))}
        title={`📎 ${previewResourceModal.title || 'Ayuda Visual / Archivo'}`}
      >
        {(() => {
          const info = getResourcePreviewInfo(previewResourceModal);
          const effectiveImg = previewResourceModal.url || info.previewImgSrc || info.fileUrl;
          const showImage = Boolean(
            effectiveImg && (
              previewResourceModal.resourceType === 'imagen' ||
              info.previewImgSrc ||
              effectiveImg.startsWith('data:image') ||
              effectiveImg.match(/\.(jpeg|jpg|png|webp|gif|svg|avif)($|\?)/i) ||
              effectiveImg.includes('firebasestorage.googleapis.com')
            )
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
              {/* VISTA PREVIA DE IMAGEN */}
              {showImage && (
                <div style={{ width: '100%', maxHeight: '65vh', overflow: 'auto', background: 'rgba(0,0,0,0.05)', borderRadius: '12px', padding: '8px', display: 'flex', justifyContent: 'center' }}>
                  <img
                    src={effectiveImg}
                    alt={previewResourceModal.title || 'Vista previa'}
                    style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
                  />
                </div>
              )}

              {/* VISTA PREVIA DE DOCUMENTO / PDF */}
              {info.isPdf && !showImage && (
                <div style={{ width: '100%', padding: '24px', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '48px', display: 'block', marginBottom: '8px' }}>📄</span>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', color: 'var(--color-dark)' }}>
                    {info.fileName || previewResourceModal.title || 'Documento PDF'}
                  </h4>
                  {info.fileSize ? (
                    <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--color-gray-500)' }}>
                      Tamaño: {Math.round(info.fileSize / 1024)} KB
                    </p>
                  ) : null}
                  {info.effectiveUrl && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => window.open(formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer')}
                    >
                      📄 Abrir Documento en Pestaña Nueva
                    </Button>
                  )}
                </div>
              )}

              {/* ENLACE WEB / SERVICIOS CLOUD */}
              {info.isLink && !info.previewImgSrc && (
                <div style={{ width: '100%', padding: '20px', background: info.linkProvider?.color ? `${info.linkProvider.color}0c` : 'rgba(37, 99, 235, 0.06)', border: `1.5px solid ${info.linkProvider?.color || '#2563eb'}40`, borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '38px', display: 'block', marginBottom: '8px' }}>{info.linkProvider?.icon || '🌐'}</span>
                  <strong style={{ fontSize: '15px', color: info.linkProvider?.color || '#2563eb', display: 'block', marginBottom: '6px' }}>
                    {info.linkProvider?.name || 'Enlace Externo'}
                  </strong>
                  <p style={{ fontSize: '13px', color: 'var(--color-gray-600)', wordBreak: 'break-all', margin: '0 0 14px 0' }}>
                    {info.rawUrl || 'Sin enlace configurado'}
                  </p>
                  {info.rawUrl && (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer')}
                    >
                      🌐 Abrir Enlace en Pestaña Nueva ↗
                    </Button>
                  )}
                </div>
              )}

              {/* MODELO 3D CAD: SOLIDWORKS, INVENTOR, STEP, DWG */}
              {info.isModel && !info.previewImgSrc && (
                <div style={{ width: '100%', padding: '20px', background: info.cadBrand === 'solidworks' ? 'rgba(225, 29, 72, 0.06)' : info.cadBrand === 'inventor' ? 'rgba(217, 119, 6, 0.06)' : 'rgba(13, 148, 136, 0.06)', border: `1.5px solid ${info.cadColor || '#0d9488'}40`, borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '38px', display: 'block', marginBottom: '8px' }}>{info.cadIcon || '🧊'}</span>
                  <strong style={{ fontSize: '15px', color: info.cadColor || '#0d9488', display: 'block', marginBottom: '4px' }}>
                    {info.cadLabel || 'Modelo 3D CAD'}
                  </strong>
                  <p style={{ fontSize: '12.5px', color: 'var(--color-gray-600)', margin: '0 0 12px 0', wordBreak: 'break-all' }}>
                    {info.fileName || 'Archivo CAD técnico para ensamble o manufactura'}
                    {info.fileSize ? ` (${Math.round(info.fileSize / 1024)} KB)` : ''}
                  </p>
                  {info.effectiveUrl && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => window.open(info.fileUrl || formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer')}
                      >
                        📥 Descargar Archivo {info.cadBrand ? info.cadBrand.toUpperCase() : 'CAD'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => window.open('https://viewer.autodesk.com/', '_blank', 'noopener,noreferrer')}
                        title="Visor gratuito oficial en navegador para modelos SolidWorks, Inventor, STEP y DWG"
                      >
                        📐 Abrir en Autodesk Viewer Web ↗
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* NOTAS TÉCNICAS */}
              {previewResourceModal.notes && (
                <div style={{ width: '100%', padding: '12px 14px', background: 'rgba(234, 88, 12, 0.08)', borderLeft: '4px solid #ea580c', borderRadius: '6px' }}>
                  <strong style={{ fontSize: '12px', color: '#ea580c', display: 'block', marginBottom: '2px' }}>📝 Notas e Instrucciones:</strong>
                  <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-dark)', whiteSpace: 'pre-wrap' }}>
                    {previewResourceModal.notes}
                  </p>
                </div>
              )}

              {/* ACCIONES DEL MODAL */}
              <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: '1px solid var(--color-gray-200)' }}>
                {(info.fileUrl || info.rawUrl) && (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => {
                      if (info.fileUrl && !info.fileUrl.startsWith('data:')) {
                        window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                      } else if (info.rawUrl) {
                        window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    {info.fileName ? '📥 Abrir / Descargar' : '🔗 Abrir Enlace'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setPreviewResourceModal((prev) => ({ ...prev, isOpen: false }))}
                >
                  ✕ Cerrar
                </Button>
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

      {/* ---------- MODAL: CONSULTAR TAREAS DE UN ÁREA EN EL LIENZO ---------- */}
      <Modal
        isOpen={areaTasksModal.isOpen}
        onClose={() => setAreaTasksModal({ isOpen: false, areaId: null, areaName: '' })}
        title={`📌 Tareas en Área: ${areaTasksModal.areaName || 'Estación'}`}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(() => {
            const areaTasks = actividades.filter((a) => a.areaId === areaTasksModal.areaId);
            if (areaTasks.length === 0) {
              return (
                <EmptyState
                  icon="📌"
                  title="Sin tareas registradas"
                  description="No hay actividades ni tareas asignadas a esta estación de manufactura actualmente."
                />
              );
            }
            return areaTasks.map((task) => {
              const resp = operarios.find((o) => o.id === task.operarioId)?.name;
              return (
                <div
                  key={task.id}
                  style={{
                    padding: '10px 14px',
                    background: 'var(--color-gray-50)',
                    border: '1px solid var(--color-gray-200)',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark)' }}>{task.title}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--color-gray-500)', marginTop: '3px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>Estatus: <strong>{task.status}</strong></span>
                      <span>· Prioridad: <strong>{task.priority}</strong></span>
                      {resp && <span style={{ color: 'var(--color-primary)' }}>· 👷 <strong>{resp}</strong></span>}
                      {task.projectName && <span>· 🗂️ {task.projectName}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {canUserControlActivity(task) ? (
                      <>
                        {task.status === 'pendiente' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleStartActivity(task.id, task.title)}
                            title="Iniciar actividad"
                          >
                            ▶️ Iniciar
                          </Button>
                        )}
                        {task.status === 'proceso' && (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => handleOpenCompleteModal(task.id, task.title)}
                            title="Terminar actividad"
                          >
                            ✅ Terminar
                          </Button>
                        )}
                        {task.status === 'completado' && (
                          <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>
                            ✓ Completada
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
                        🔒 {task.status}
                      </span>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <Button variant="secondary" size="md" onClick={() => setAreaTasksModal({ isOpen: false, areaId: null, areaName: '' })}>
            Cerrar
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: FINALIZAR / COMPLETAR ACTIVIDAD ---------- */}
      <Modal
        isOpen={completeModal.isOpen}
        onClose={() => setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' })}
        title={`✅ Finalizar Actividad: ${completeModal.title || 'Actividad'}`}
      >
        <div className={styles.field} style={{ marginBottom: '12px' }}>
          <label>Notas de Conclusión / Comentarios de Entrega</label>
          <textarea
            rows="3"
            placeholder="Describe qué se realizó o verificó..."
            value={completeModal.notes}
            onChange={(e) => setCompleteModal((prev) => ({ ...prev, notes: e.target.value }))}
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-gray-300)', fontSize: '13px' }}
            autoFocus
          />
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--color-gray-500)', margin: '0 0 16px 0' }}>
          🕒 Se registrará la fecha y hora exacta de terminación para la métrica y trazabilidad en toda la app.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' })}
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            size="md"
            onClick={handleConfirmCompleteActivity}
          >
            ✅ Confirmar y Terminar
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: ENLACE DE EVIDENCIA (NAS) DE ACTIVIDAD ---------- */}
      <Modal
        isOpen={evidenceModal.isOpen}
        onClose={closeEvidenceModal}
        title={`🗄️ Evidencia: ${evidenceModal.title || 'Actividad'}`}
      >
        <p style={{ fontSize: '12.5px', color: 'var(--color-gray-500)', marginBottom: '12px' }}>
          La evidencia se sube directo al NAS del taller, organizada sola por Área y
          Juego — no hace falta subirla a mano ni copiar el link.
        </p>
        <div className={styles.field} style={{ marginBottom: '10px' }}>
          <label>📤 Subir archivo (automático al NAS)</label>
          <input
            type="file"
            disabled={evidenceUploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadActivityEvidence(file);
              e.target.value = '';
            }}
          />
          {evidenceUploading && (
            <p style={{ fontSize: '11.5px', color: '#0284c7', fontWeight: 600, marginTop: '4px' }}>⏳ Subiendo...</p>
          )}
        </div>
        <div className={styles.field} style={{ marginBottom: '14px' }}>
          <label>O pega un link manual (respaldo)</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={evidenceModal.linkInput}
              placeholder="Enlace a la carpeta/archivo en el NAS"
              onChange={(e) => setEvidenceModal((prev) => ({ ...prev, linkInput: e.target.value }))}
              style={{ flex: 1 }}
              autoFocus
            />
            {evidenceModal.linkInput && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => window.open(evidenceModal.linkInput, '_blank', 'noopener,noreferrer')}
              >
                Abrir
              </Button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="md" onClick={closeEvidenceModal}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" onClick={handleSaveEvidenceLink}>
            💾 Guardar Enlace
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: REGISTRAR ENTREGA (desde el nodo Juego del lienzo libre) ---------- */}
      {(() => {
        const deliveryGame = deliveryModal.gameId ? juegos.find((j) => j.id === deliveryModal.gameId) : null;
        if (!deliveryModal.isOpen || !deliveryGame) return null;
        return (
          <RegisterDeliveryModal
            isOpen={deliveryModal.isOpen}
            onClose={() => setDeliveryModal({ isOpen: false, gameId: null, areaId: null, areaLabel: '' })}
            game={deliveryGame}
            areaId={deliveryModal.areaId}
            areaLabel={deliveryModal.areaLabel}
            toast={toast}
          />
        );
      })()}
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
  setEdges,
  saveToFirestore,
  nodes,
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
  updateProject,
  updateActividad,
  setNodes,
  canEditDiagram,
  updateBlockField,
  updateBlockName,
  onSaveBlockName,
  openBlockActivityForm,
  handleReassignBlockActivities,
  updateNodeColor,
  updateEdgeColor,
  updateEdgeStyle,
  dynamicAreas,
  allBlockAreas,
  allAvailableAreas = [],
  allCollaborators = [],
  getCollaboratorsForArea = () => [],
  getSupervisorForArea,
  onViewAreaTasks,
  onStartActivity,
  onOpenCompleteModal,
  onResetActivityStatus,
  canUserControlActivity,
  getActivityBlockStatus,
  getActivityPredecessors,
  lienzoActivoId = 'general',
  onClose,
  onFocusNode,
  onSelectConnectedCluster,
  previewResourceModal,
  setPreviewResourceModal,
  handleDeployAllActivityResources,
  onOpenRoute,
}) => {
  const meta = NODE_TYPES[node.type] || DEFAULT_NODE_META;
  const toast = useToast();
  const { user } = useAuth();
  // Proyecto del lienzo actual — para saber en qué carpeta del NAS debe quedar un
  // archivo subido desde este panel (mismo criterio que EditorVisualPage principal).
  const currentProject = proyectos.find((p) => p.id === lienzoActivoId) || null;

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

  // 🗂️ Estados para editar Proyecto Existente
  const [editProjName, setEditProjName] = useState('');
  const [editProjClient, setEditProjClient] = useState('');
  const [editProjStatus, setEditProjStatus] = useState('diseno');
  const [editProjStartDate, setEditProjStartDate] = useState('');
  const [editProjEndDate, setEditProjEndDate] = useState('');
  const [editProjDesc, setEditProjDesc] = useState('');
  const [editProjItems, setEditProjItems] = useState('');
  const [editProjAreas, setEditProjAreas] = useState([]);
  const [editProjNasUrl, setEditProjNasUrl] = useState('');
  const [isSavingProj, setIsSavingProj] = useState(false);

  // 🎮 Estados para editar Juego Existente
  const [editGameName, setEditGameName] = useState('');
  const [editGameProjectId, setEditGameProjectId] = useState('');
  const [editGameAreas, setEditGameAreas] = useState([]);
  const [editGameTargets, setEditGameTargets] = useState({});
  const [editGameNasUrl, setEditGameNasUrl] = useState('');
  const [isSavingGame, setIsSavingGame] = useState(false);

  // 📌 Estados para editar Actividad Existente
  const [editActTitle, setEditActTitle] = useState('');
  const [editActDesc, setEditActDesc] = useState('');
  const [editActAreaId, setEditActAreaId] = useState('herreria');
  const [editActOperarioId, setEditActOperarioId] = useState('');
  const [editActQuantity, setEditActQuantity] = useState(1);
  const [editActPriority, setEditActPriority] = useState('media');
  const [editActDueDate, setEditActDueDate] = useState('');
  const [editActEvidenceLink, setEditActEvidenceLink] = useState('');
  const [isUploadingInspectorEvidence, setIsUploadingInspectorEvidence] = useState(false);
  const [editActLinks, setEditActLinks] = useState([]);
  const [newLinkInput, setNewLinkInput] = useState('');
  const [checklist, setChecklist] = useState([]);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [isSavingAct, setIsSavingAct] = useState(false);
  const [isUploadingActFile, setIsUploadingActFile] = useState(false);

  // Estados para abrir acordeón de edición en Bloques
  const [isEditingLinkedProj, setIsEditingLinkedProj] = useState(false);
  const [isEditingLinkedGame, setIsEditingLinkedGame] = useState(false);

  useEffect(() => {
    if (entity && node.type === 'proyecto') {
      setEditProjName(entity.name || '');
      setEditProjClient(entity.client || '');
      setEditProjStatus(entity.status || 'diseno');
      setEditProjStartDate(entity.startDate || '');
      setEditProjEndDate(entity.endDate || '');
      setEditProjDesc(entity.description || '');
      setEditProjItems(entity.itemsToManufacture || '');
      setEditProjAreas(entity.areas || ['arquitectura', 'diseno', 'herreria', 'corte-laser']);
      setEditProjNasUrl(entity.nasFolderUrl || '');
    }
    if (entity && node.type === 'juego') {
      setEditGameName(entity.name || '');
      setEditGameProjectId(entity.projectId || '');
      setEditGameAreas(entity.areas || ['herreria', 'corte-laser']);
      setEditGameTargets(entity.targetPieces || {});
      setEditGameNasUrl(entity.nasFolderUrl || '');
    }
    if (entity && node.type === 'actividad') {
      setEditActTitle(entity.title || '');
      setEditActDesc(entity.description || '');
      setEditActAreaId(entity.areaId || 'herreria');
      setEditActOperarioId(entity.operarioId || '');
      setEditActQuantity(entity.quantity || 1);
      setEditActPriority(entity.priority || 'media');
      setEditActDueDate(entity.dueDate || '');
      setEditActEvidenceLink(entity.evidenceLink || '');
      setEditActLinks(entity.links || []);
      setChecklist(Array.isArray(entity.checklist) ? entity.checklist : []);
    }
  }, [entity, node.type]);

  const handleToggleChecklist = async (index) => {
    if (!canEditDiagram || !entity?.id) return;
    const updated = checklist.map((item, i) => {
      if (i === index) {
        const nextCompleted = !item.completed;
        return {
          ...item,
          completed: nextCompleted,
          completedAt: nextCompleted ? new Date().toISOString() : null,
          completedBy: nextCompleted ? (user?.name || user?.displayName || 'Usuario') : null,
        };
      }
      return item;
    });
    setChecklist(updated);
    try {
      await updateDoc(doc(db, 'actividades', entity.id), {
        checklist: updated,
        updatedAt: new Date().toISOString(),
      });
      if (updateActividad) {
        updateActividad(entity.id, { checklist: updated });
      }
    } catch (e) {
      toast.danger('No se pudo actualizar el requisito.');
    }
  };

  const handleAddChecklist = async () => {
    if (!canEditDiagram || !entity?.id || !newChecklistText.trim()) return;
    const newItem = {
      id: `chk_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      text: newChecklistText.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    const updated = [...checklist, newItem];
    setChecklist(updated);
    setNewChecklistText('');
    try {
      await updateDoc(doc(db, 'actividades', entity.id), {
        checklist: updated,
        updatedAt: new Date().toISOString(),
      });
      if (updateActividad) {
        updateActividad(entity.id, { checklist: updated });
      }
      toast.success('☑️ Requisito añadido al checklist.');
    } catch (e) {
      toast.danger('No se pudo guardar el nuevo requisito.');
    }
  };

  const handleDeleteChecklist = async (index) => {
    if (!canEditDiagram || !entity?.id) return;
    const updated = checklist.filter((_, i) => i !== index);
    setChecklist(updated);
    try {
      await updateDoc(doc(db, 'actividades', entity.id), {
        checklist: updated,
        updatedAt: new Date().toISOString(),
      });
      if (updateActividad) {
        updateActividad(entity.id, { checklist: updated });
      }
      toast.info('🗑️ Requisito eliminado.');
    } catch (e) {
      toast.danger('Error al eliminar requisito.');
    }
  };

  const handleToggleEditProjArea = (areaId) => {
    setEditProjAreas((prev) => {
      const next = prev.includes(areaId) ? prev.filter((a) => a !== areaId) : [...prev, areaId];
      return next;
    });
  };

  // Proyecto vinculado a la actividad seleccionada
  const linkedProject = useMemo(() => {
    if (node.type !== 'actividad') return null;
    if (entity?.projectId) return proyectos.find((p) => p.id === entity.projectId);
    
    // Cable directo a nodo Proyecto
    const projEdge = (edges || []).find(
      (e) => (e.from === node.id && findNode(e.to)?.type === 'proyecto') || (e.to === node.id && findNode(e.from)?.type === 'proyecto')
    );
    if (projEdge) {
      const pNode = findNode(findNode(projEdge.from)?.type === 'proyecto' ? projEdge.from : projEdge.to);
      if (pNode?.refId) return proyectos.find((p) => p.id === pNode.refId);
    }

    // Cable a nodo Juego con proyecto
    const gameEdge = (edges || []).find(
      (e) => (e.from === node.id && findNode(e.to)?.type === 'juego') || (e.to === node.id && findNode(e.from)?.type === 'juego')
    );
    if (gameEdge) {
      const gNode = findNode(findNode(gameEdge.from)?.type === 'juego' ? gameEdge.from : gameEdge.to);
      const gEntity = gNode ? juegos.find((j) => j.id === gNode.refId) : null;
      if (gEntity?.projectId) return proyectos.find((p) => p.id === gEntity.projectId);
    }

    return null;
  }, [node, entity, edges, findNode, proyectos, juegos]);

  const handleUpdateExistingProject = async () => {
    if (!editProjName.trim() || !editProjClient.trim()) {
      toast.danger('Nombre y cliente son obligatorios.');
      return;
    }
    setIsSavingProj(true);
    try {
      const res = await updateProject(entity.id, {
        name: editProjName.trim(),
        client: editProjClient.trim(),
        status: editProjStatus,
        startDate: editProjStartDate || null,
        endDate: editProjEndDate || null,
        description: editProjDesc.trim() || 'Sin descripción',
        itemsToManufacture: editProjItems.trim() || '',
        areas: editProjAreas || [],
        nasFolderUrl: editProjNasUrl.trim() || '',
      });
      if (res?.ok !== false) {
        toast.success(`✅ Proyecto "${editProjName.trim()}" actualizado.`);
      } else {
        toast.danger(`Error: ${res.error}`);
      }
    } catch (e) {
      toast.danger('No se pudo actualizar el proyecto.');
    } finally {
      setIsSavingProj(false);
    }
  };

  const handleUpdateExistingActivity = async () => {
    if (!editActTitle.trim()) {
      toast.danger('El título de la actividad es obligatorio.');
      return;
    }
    setIsSavingAct(true);
    try {
      if (updateActividad) {
        const res = await updateActividad(entity.id, {
          title: editActTitle.trim(),
          description: editActDesc.trim() || 'Sin descripción',
          areaId: editActAreaId,
          operarioId: editActOperarioId || null,
          quantity: Number(editActQuantity) > 0 ? Number(editActQuantity) : 1,
          priority: editActPriority,
          dueDate: editActDueDate || null,
          evidenceLink: editActEvidenceLink.trim(),
          links: editActLinks,
          checklist: checklist,
          updatedAt: new Date().toISOString(),
        });
        if (res?.ok !== false) {
          toast.success(`✅ Actividad "${editActTitle.trim()}" actualizada.`);
        } else {
          toast.danger(`Error: ${res.error}`);
        }
      }
    } catch (err) {
      console.error('Error al actualizar actividad:', err);
      toast.danger('No se pudo actualizar la actividad.');
    } finally {
      setIsSavingAct(false);
    }
  };

  /** Sube el archivo de evidencia (NAS) de la actividad seleccionada directo desde el Inspector */
  const handleUploadInspectorEvidence = async (file) => {
    if (!file) return;
    setIsUploadingInspectorEvidence(true);
    try {
      const areaId = entity.areaId || null;
      const gameId = entity.gameId || null;
      const projectId = entity.projectId || currentProject?.id || null;
      const result = await uploadEvidenceFile(file, {
        category: 'fabricacion',
        areaId,
        areaName: areaId ? (dynamicAreas.find((a) => a.id === areaId)?.name || areaId) : null,
        gameId,
        gameName: gameId ? juegos.find((j) => j.id === gameId)?.name : null,
        projectId,
        projectName: projectId ? (proyectos.find((p) => p.id === projectId)?.name || currentProject?.name) : null,
        targetType: 'actividad',
        targetRef: { activityId: entity.id },
      });
      setEditActEvidenceLink(result.url);
      const res = await updateActividad(entity.id, { evidenceLink: result.url, evidenceNasPath: result.nasPath || null });
      if (res?.ok === false) {
        toast.danger(res.error || 'No se pudo guardar el enlace de evidencia.');
      } else {
        toast.success('📤 Evidencia guardada — se sincronizará con el NAS en unos minutos.');
      }
    } catch (err) {
      console.error('Error al subir evidencia de actividad:', err);
      toast.danger('No se pudo subir el archivo de evidencia.');
    } finally {
      setIsUploadingInspectorEvidence(false);
    }
  };

  const handleUploadActivityAttachment = async (file) => {
    if (!file) return;
    setIsUploadingActFile(true);
    toast.info(`⏳ Subiendo "${file.name}" a la nube...`);
    try {
      const uploaded = await uploadResourceFile(file, lienzoActivoId);
      if (uploaded) {
        const currentAttachments = entity.attachments || [];
        const nextAttachments = [...currentAttachments, uploaded];
        await updateDoc(doc(db, 'actividades', entity.id), {
          attachments: nextAttachments,
          updatedAt: new Date().toISOString(),
        });
        if (updateActividad) updateActividad(entity.id, { attachments: nextAttachments });
        toast.success(`✅ Archivo "${file.name}" adjuntado a la actividad.`);

        // Si es una imagen, crear y conectar automáticamente el nodo de imagen flotante sin marco en el lienzo
        if (file.type?.startsWith('image/') || uploaded.url?.match(/\.(jpeg|jpg|png|webp|gif)($|\?)/i) || uploaded.dataUrl?.startsWith('data:image')) {
          handleSpawnFloatingImage(uploaded);
          toast.success('🖼️ Imagen flotante sin marco agregada al lienzo y conectada.');
        }
      }
    } catch (err) {
      console.error('Error al subir archivo:', err);
      toast.danger('No se pudo subir el archivo.');
    } finally {
      setIsUploadingActFile(false);
    }
  };

  const handleRemoveActivityAttachment = async (indexToRemove) => {
    const currentAttachments = entity.attachments || [];
    const attToRemove = currentAttachments[indexToRemove];
    if (attToRemove?.storagePath && storage) {
      deleteObject(ref(storage, attToRemove.storagePath)).catch(() => {});
    }
    if (attToRemove?.nasPath) {
      deleteNasFile(attToRemove.nasPath);
    }
    const nextAttachments = currentAttachments.filter((_, i) => i !== indexToRemove);
    await updateDoc(doc(db, 'actividades', entity.id), {
      attachments: nextAttachments,
      updatedAt: new Date().toISOString(),
    });
    if (updateActividad) updateActividad(entity.id, { attachments: nextAttachments });
    toast.info('Archivo adjunto eliminado de la actividad.');

    // 🔥 ELIMINAR AUTOMÁTICAMENTE EL NODO FLOTANTE DE LA IMAGEN EN EL LIENZO
    if (attToRemove && setNodes) {
      const targetUrl = attToRemove.url || attToRemove.dataUrl;
      const targetName = attToRemove.name;

      const nodesToDelete = (nodes || []).filter((n) => {
        if (n.type !== 'recurso') return false;
        const fData = n.draftFields?.fileData;
        const nUrl = n.draftFields?.url || fData?.url || fData?.dataUrl;
        const nName = fData?.name;
        const matchesUrl = Boolean(targetUrl && nUrl && (nUrl === targetUrl || nUrl.includes(targetName)));
        const matchesName = Boolean(targetName && nName && nName === targetName);
        const isConnected = (edges || []).some((e) => (e.from === node.id && e.to === n.id) || (e.to === node.id && e.from === n.id));
        return (matchesUrl || matchesName) && isConnected;
      });

      if (nodesToDelete.length > 0) {
        const deleteIds = new Set(nodesToDelete.map((n) => n.id));
        const nextNodes = nodes.filter((n) => !deleteIds.has(n.id));
        const nextEdges = (edges || []).filter((e) => !deleteIds.has(e.from) && !deleteIds.has(e.to));
        setNodes(nextNodes);
        if (setEdges) setEdges(nextEdges);
        if (saveToFirestore) saveToFirestore(nextNodes, nextEdges);
        toast.info('🗑️ Nodo flotante de la imagen retirado del lienzo.');
      }
    }
  };

  const handleAddLinkToActivity = async () => {
    if (!newLinkInput.trim()) return;
    const formatted = formatExternalUrl(newLinkInput.trim());
    const nextLinks = [...(editActLinks || []), formatted];
    setEditActLinks(nextLinks);
    setNewLinkInput('');
    await updateDoc(doc(db, 'actividades', entity.id), {
      links: nextLinks,
      updatedAt: new Date().toISOString(),
    });
    if (updateActividad) updateActividad(entity.id, { links: nextLinks });
    toast.success('🔗 Enlace agregado a la actividad.');

    // 🔥 GENERAR Y CONECTAR AUTOMÁTICAMENTE EL NODO DE ENLACE FLOTANTE EN EL LIENZO
    handleSpawnFloatingLink(formatted);
  };

  const handleRemoveLinkFromActivity = async (indexToRemove) => {
    const linkToRemove = (editActLinks || [])[indexToRemove];
    const nextLinks = editActLinks.filter((_, i) => i !== indexToRemove);
    setEditActLinks(nextLinks);
    await updateDoc(doc(db, 'actividades', entity.id), {
      links: nextLinks,
      updatedAt: new Date().toISOString(),
    });
    if (updateActividad) updateActividad(entity.id, { links: nextLinks });
    toast.info('Enlace removido.');

    // 🔥 ELIMINAR AUTOMÁTICAMENTE EL NODO FLOTANTE DEL ENLACE EN EL LIENZO
    if (linkToRemove && setNodes) {
      const nodesToDelete = (nodes || []).filter((n) => {
        if (n.type !== 'recurso') return false;
        const nUrl = n.draftFields?.url;
        const matchesUrl = Boolean(nUrl && nUrl === linkToRemove);
        const isConnected = (edges || []).some((e) => (e.from === node.id && e.to === n.id) || (e.to === node.id && e.from === n.id));
        return matchesUrl && isConnected;
      });

      if (nodesToDelete.length > 0) {
        const deleteIds = new Set(nodesToDelete.map((n) => n.id));
        const nextNodes = nodes.filter((n) => !deleteIds.has(n.id));
        const nextEdges = (edges || []).filter((e) => !deleteIds.has(e.from) && !deleteIds.has(e.to));
        setNodes(nextNodes);
        if (setEdges) setEdges(nextEdges);
        if (saveToFirestore) saveToFirestore(nextNodes, nextEdges);
        toast.info('🗑️ Nodo flotante del enlace retirado del lienzo.');
      }
    }
  };

  const handleSpawnFloatingLink = (linkUrl) => {
    const actX = node.x || 200;
    const actY = node.y || 200;

    // 1. Verificar si el nodo del enlace ya existe en el lienzo
    const existingNode = (nodes || []).find((n) => {
      if (n.type !== 'recurso') return false;
      const nUrl = n.draftFields?.url;
      return Boolean(nUrl && nUrl === linkUrl);
    });

    if (existingNode) {
      // Si ya está en el lienzo pero le falta el cable de conexión a esta actividad, reconectarlo
      const isConnected = (edges || []).some(
        (e) => (e.from === node.id && e.to === existingNode.id) || (e.to === node.id && e.from === existingNode.id)
      );
      if (!isConnected && setEdges) {
        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: node.id,
          to: existingNode.id,
          fromPort: 'out',
          toPort: 'in',
          style: 'dashed',
          customColor: '#38bdf8',
        };
        setEdges((prevE) => {
          const nextE = [...prevE, wireEdge];
          if (saveToFirestore) saveToFirestore(nodes, nextE);
          return nextE;
        });
      }
      if (onFocusNode) onFocusNode(existingNode);
      toast.info('📍 Enlace enfocado en el lienzo.');
      return;
    }

    // 2. Si no existe en el lienzo, crearlo y conectarlo con cable
    const connectedRecursosCount = (edges || []).filter(
      (e) => (e.from === node.id && findNode(e.to)?.type === 'recurso') || (e.to === node.id && findNode(e.from)?.type === 'recurso')
    ).length;

    const linkId = nextNodeId();
    let linkTitle = `Enlace: ${entity.title}`;
    if (linkUrl.includes('drive.google.com')) linkTitle = `Drive: ${entity.title}`;
    else if (linkUrl.includes('figma.com')) linkTitle = `Figma: ${entity.title}`;
    else if (linkUrl.includes('autodesk.com') || linkUrl.includes('viewer.autodesk')) linkTitle = `Autodesk 3D: ${entity.title}`;

    const linkNode = {
      id: linkId,
      type: 'recurso',
      x: actX + NODE_WIDTH + 60,
      y: actY + 70 + (connectedRecursosCount * 80),
      draft: false,
      draftFields: {
        title: linkTitle,
        url: linkUrl,
        resourceType: 'link',
        fileData: null,
        notes: '',
      },
    };

    const wireEdge = {
      id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      from: node.id,
      to: linkId,
      fromPort: 'out',
      toPort: 'in',
      style: 'dashed',
      customColor: '#38bdf8',
    };

    if (setNodes) {
      setNodes((prev) => {
        const next = [...prev, linkNode];
        if (setEdges) {
          setEdges((prevE) => {
            const nextE = [...prevE, wireEdge];
            if (saveToFirestore) saveToFirestore(next, nextE);
            return nextE;
          });
        }
        return next;
      });
    }

    toast.success('🔗 Enlace colocado en el lienzo y conectado a la Actividad.');
  };

  const handleSpawnFloatingImage = (att) => {
    const actX = node.x || 200;
    const actY = node.y || 200;

    // 1. Verificar si el nodo de la imagen ya existe en el lienzo
    const existingNode = (nodes || []).find((n) => {
      if (n.type !== 'recurso') return false;
      const fData = n.draftFields?.fileData;
      const nUrl = n.draftFields?.url || fData?.url || fData?.dataUrl;
      const attUrl = att.url || att.dataUrl;
      const matchesUrl = Boolean(nUrl && attUrl && nUrl === attUrl);
      const matchesName = Boolean(fData?.name && att.name && fData.name === att.name);
      return matchesUrl || matchesName;
    });

    if (existingNode) {
      // Si ya está en el lienzo pero le falta el cable de conexión a esta actividad, reconectarlo
      const isConnected = (edges || []).some(
        (e) => (e.from === node.id && e.to === existingNode.id) || (e.to === node.id && e.from === existingNode.id)
      );
      if (!isConnected && setEdges) {
        const wireEdge = {
          id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          from: node.id,
          to: existingNode.id,
          fromPort: 'out',
          toPort: 'in',
          style: 'dashed',
          customColor: '#06b6d4',
        };
        setEdges((prevE) => {
          const nextE = [...prevE, wireEdge];
          if (saveToFirestore) saveToFirestore(nodes, nextE);
          return nextE;
        });
      }
      if (onFocusNode) onFocusNode(existingNode);
      toast.info('📍 Imagen enfocada en el lienzo.');
      return;
    }

    // 2. Si no existe en el lienzo, crearlo y conectarlo con cable
    const connectedRecursosCount = (edges || []).filter(
      (e) => (e.from === node.id && findNode(e.to)?.type === 'recurso') || (e.to === node.id && findNode(e.from)?.type === 'recurso')
    ).length;

    const imgId = nextNodeId();
    const imgNode = {
      id: imgId,
      type: 'recurso',
      x: actX + NODE_WIDTH + 60,
      y: actY + (connectedRecursosCount * 110),
      draft: false,
      draftFields: {
        title: `Visual: ${entity.title}`,
        url: att.url || att.dataUrl || '',
        resourceType: 'imagen',
        fileData: att,
        notes: '',
      },
    };

    const wireEdge = {
      id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      from: node.id,
      to: imgId,
      fromPort: 'out',
      toPort: 'in',
      style: 'dashed',
      customColor: '#06b6d4',
    };

    if (setNodes) {
      setNodes((prev) => {
        const next = [...prev, imgNode];
        if (setEdges) {
          setEdges((prevE) => {
            const nextE = [...prevE, wireEdge];
            if (saveToFirestore) saveToFirestore(next, nextE);
            return nextE;
          });
        }
        return next;
      });
    }

    toast.success('🖼️ Imagen colocada en el lienzo y conectada a la Actividad.');
  };

  const handleToggleEditGameArea = (areaId) => {
    const isSelected = editGameAreas.includes(areaId);
    let nextAreas = isSelected ? editGameAreas.filter((id) => id !== areaId) : [...editGameAreas, areaId];
    const nextTargets = { ...editGameTargets };

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

    setEditGameAreas(nextAreas);
    setEditGameTargets(nextTargets);
  };

  const handleUpdateExistingGame = async () => {
    if (!editGameName.trim()) {
      toast.danger('El nombre del juego es obligatorio.');
      return;
    }
    setIsSavingGame(true);
    try {
      const matchingProj = proyectos.find((p) => p.id === editGameProjectId);
      await updateDoc(doc(db, 'juegos', entity.id), {
        name: editGameName.trim(),
        projectId: editGameProjectId || null,
        projectName: matchingProj?.name || entity.projectName || 'General',
        // Con Ruta de Fabricación activa, el orden de `areas` es el orden real de
        // fabricación y solo se edita (con validación) desde RutaFabricacionView — se
        // reenvía tal cual está en Firestore, nunca lo que haya quedado en el estado
        // local de este formulario, sin importar si los pills de arriba están ocultos.
        areas: entity.useManufacturingRoute ? entity.areas : editGameAreas,
        targetPieces: editGameTargets,
        nasFolderUrl: editGameNasUrl.trim() || '',
        updatedAt: new Date().toISOString(),
      });
      toast.success(`✅ Juego "${editGameName.trim()}" actualizado.`);
    } catch (e) {
      console.error('Error actualizando juego:', e);
      toast.danger('No se pudo actualizar el juego.');
    } finally {
      setIsSavingGame(false);
    }
  };

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
      <div className={styles.inspectorHeader}>
        <div>
          <p className={styles.inspectorEyebrow}>{meta.label}</p>
          <h2 className={styles.inspectorTitle} style={{ margin: 0 }}>{nodeTitle(node)}</h2>
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.floatingCloseBtn}
            onClick={onClose}
            title="Cerrar inspector y deseleccionar"
          >
            ✕
          </button>
        )}
      </div>

      {onSelectConnectedCluster && (
        <div style={{ marginTop: '8px', marginBottom: '14px' }}>
          <button
            type="button"
            className={styles.multiSelectionBtn}
            style={{ width: '100%', justifyContent: 'center', padding: '7px 12px', fontSize: '11.5px', borderRadius: '8px' }}
            onClick={() => onSelectConnectedCluster(node.id)}
            title="Selecciona este nodo y todos los nodos conectados en cadena para moverlos juntos en el lienzo"
          >
            🔗 Mover / Seleccionar Cadena Conectada
          </button>
        </div>
      )}

      {node.draft && node.type === 'proyecto' && (
        <>
          <div className={styles.field}>
            <label>Nombre del Proyecto *</label>
            <input type="text" value={node.draftFields.name || ''} disabled={!canEditDiagram} onChange={(e) => updateDraftField('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Cliente *</label>
            <input type="text" value={node.draftFields.client || ''} disabled={!canEditDiagram} onChange={(e) => updateDraftField('client', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Estado del Proyecto</label>
            <select value={node.draftFields.status || 'diseno'} disabled={!canEditDiagram} onChange={(e) => updateDraftField('status', e.target.value)}>
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>🛠️ ¿Qué se fabricará en este proyecto?</label>
            <textarea
              rows="2"
              value={node.draftFields.itemsToManufacture || ''}
              disabled={!canEditDiagram}
              onChange={(e) => updateDraftField('itemsToManufacture', e.target.value)}
              placeholder="Ej: 2 Módulos infantiles, 4 bancas metálicas..."
            />
          </div>
          <div className={styles.field}>
            <label>🏭 Áreas Involucradas en el Proyecto</label>
            <div className={styles.areasGridPills} style={{ marginTop: '4px' }}>
              {(allBlockAreas || dynamicAreas).map((a) => {
                const currentAreas = node.draftFields.areas || ['arquitectura', 'diseno', 'herreria', 'corte-laser'];
                const isSelected = currentAreas.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                    onClick={() => {
                      if (!canEditDiagram) return;
                      const next = isSelected ? currentAreas.filter((id) => id !== a.id) : [...currentAreas, a.id];
                      updateDraftField('areas', next);
                    }}
                  >
                    {isSelected ? '✓ ' : '+ '} {a.icon || '🏭'} {a.name}
                  </button>
                );
              })}
            </div>
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveProyecto} style={{ marginTop: '10px' }}>💾 Guardar en el Sistema</Button>}
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
          <div className={styles.field}>
            <label>Nombre del Proyecto *</label>
            <input
              type="text"
              value={editProjName}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjName(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Cliente *</label>
            <input
              type="text"
              value={editProjClient}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjClient(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Estado del Proyecto</label>
            <select
              value={editProjStatus}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjStatus(e.target.value)}
            >
              <option value="diseno">📐 En Diseño / Arquitectura</option>
              <option value="progreso">⚙️ En Progreso</option>
              <option value="pausado">⏸️ Pausado</option>
              <option value="completado">✅ Completado</option>
            </select>
          </div>
          <div className={styles.field}>
            <label>🛠️ ¿Qué se fabricará en este proyecto? (Productos / Modelos / Piezas)</label>
            <textarea
              rows="3"
              value={editProjItems}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjItems(e.target.value)}
              placeholder="Detalla los juegos, modelos o piezas a fabricar..."
            />
          </div>
          <div className={styles.field}>
            <label>🏭 Áreas Involucradas en el Proyecto</label>
            <div className={styles.areasGridPills} style={{ marginTop: '4px' }}>
              {(allBlockAreas || dynamicAreas).map((a) => {
                const isSelected = editProjAreas.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                    onClick={() => canEditDiagram && handleToggleEditProjArea(a.id)}
                    style={{ cursor: canEditDiagram ? 'pointer' : 'default' }}
                  >
                    {isSelected ? '✓ ' : '+ '} {a.icon || '🏭'} {a.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.createGrid2}>
            <div className={styles.field}>
              <label>Fecha Inicio</label>
              <input
                type="date"
                value={editProjStartDate}
                disabled={!canEditDiagram}
                onChange={(e) => setEditProjStartDate(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label>Fecha Entrega</label>
              <input
                type="date"
                value={editProjEndDate}
                disabled={!canEditDiagram}
                onChange={(e) => setEditProjEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label>Descripción</label>
            <textarea
              rows="2"
              value={editProjDesc}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjDesc(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Progreso General</label>
            <input type="text" value={`${entity.progress ?? 0}%`} disabled />
          </div>
          <div className={styles.field}>
            <label>🗄️ Carpeta NAS (evidencia del proyecto)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={editProjNasUrl}
                disabled={!canEditDiagram}
                placeholder="Enlace a la carpeta NAS (cuando esté listo)"
                onChange={(e) => setEditProjNasUrl(e.target.value)}
                style={{ flex: 1 }}
              />
              {entity.nasFolderUrl && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(entity.nasFolderUrl, '_blank', 'noopener,noreferrer')}
                >
                  Abrir
                </Button>
              )}
            </div>
          </div>
          {canEditDiagram && (
            <Button
              variant="primary"
              size="md"
              onClick={handleUpdateExistingProject}
              isLoading={isSavingProj}
              style={{ width: '100%', marginTop: '8px' }}
            >
              💾 Guardar Cambios del Proyecto
            </Button>
          )}
        </>
      )}

      {!node.draft && entity && node.type === 'juego' && (
        <>
          <div className={styles.field}>
            <label>Nombre del Juego / Modelo *</label>
            <input
              type="text"
              value={editGameName}
              disabled={!canEditDiagram}
              onChange={(e) => setEditGameName(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Proyecto Perteneciente</label>
            <select
              value={editGameProjectId}
              disabled={!canEditDiagram}
              onChange={(e) => setEditGameProjectId(e.target.value)}
            >
              <option value="">Sin proyecto específico (General)</option>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>Áreas Requeridas para este Juego</label>
            {entity.useManufacturingRoute ? (
              <div className={styles.calloutBox} style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', marginTop: '4px' }}>
                🛤️ Este juego usa Ruta de Fabricación — el orden de sus áreas se protege y se edita solo desde
                "Ver Ruta de Fabricación" abajo, no aquí.
              </div>
            ) : (
              <div className={styles.areasGridPills} style={{ marginTop: '4px' }}>
                {dynamicAreas.map((a) => {
                  const isSelected = editGameAreas.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                      onClick={() => canEditDiagram && handleToggleEditGameArea(a.id)}
                      style={{ cursor: canEditDiagram ? 'pointer' : 'default' }}
                    >
                      {isSelected ? '✓ ' : '+ '} {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label>Metas de Piezas por Área</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginTop: '4px' }}>
              {editGameAreas.map((areaId) => {
                const areaName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
                return (
                  <div key={areaId} style={{ background: 'var(--color-gray-50)', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-gray-200)' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>{areaName}</span>
                    <input
                      type="number"
                      min="1"
                      value={editGameTargets[areaId] || 10}
                      disabled={!canEditDiagram}
                      onChange={(e) => setEditGameTargets((prev) => ({ ...prev, [areaId]: Number(e.target.value) || 1 }))}
                      style={{ width: '100%', padding: '4px', fontSize: '12px' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <label>🗄️ Carpeta NAS (evidencia del modelo)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={editGameNasUrl}
                disabled={!canEditDiagram}
                placeholder="Enlace a la carpeta NAS (cuando esté listo)"
                onChange={(e) => setEditGameNasUrl(e.target.value)}
                style={{ flex: 1 }}
              />
              {entity.nasFolderUrl && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(entity.nasFolderUrl, '_blank', 'noopener,noreferrer')}
                >
                  Abrir
                </Button>
              )}
            </div>
          </div>

          {canEditDiagram && (
            <Button
              variant="primary"
              size="md"
              onClick={handleUpdateExistingGame}
              isLoading={isSavingGame}
              style={{ width: '100%', margin: '8px 0 16px 0' }}
            >
              💾 Guardar Cambios del Juego
            </Button>
          )}

          {entity.useManufacturingRoute && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => onOpenRoute(entity.id)}
              style={{ width: '100%', margin: '0 0 16px 0' }}
              title="Ver y editar la Ruta de Fabricación ordenada de este juego"
            >
              🛤️ Ver Ruta de Fabricación
            </Button>
          )}

          {(entity.areas || [])
            .filter((areaId) => isAreaBlockedByRoute(entity, areaId))
            .map((areaId) => {
              const requiredAreaId = getBlockingAreaForRoute(entity, areaId);
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

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Avance de Manufactura</p>
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
          {/* SECCIÓN 1: 📋 ESPECIFICACIÓN DE LA ACTIVIDAD */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>📋 Especificación de la Tarea</span>
              </h3>
            </div>

            <div className={styles.field} style={{ marginBottom: '8px' }}>
              <label>Título de la Tarea *</label>
              <input
                type="text"
                value={editActTitle}
                disabled={!canEditDiagram}
                onChange={(e) => setEditActTitle(e.target.value)}
                placeholder="Ej. Corte de perfiles..."
              />
            </div>

            <div className={styles.field} style={{ marginBottom: '8px' }}>
              <label>Descripción / Especificación Técnica</label>
              <textarea
                rows="2"
                value={editActDesc}
                disabled={!canEditDiagram}
                onChange={(e) => setEditActDesc(e.target.value)}
                placeholder="Detalla planos, medidas o especificaciones..."
              />
            </div>

            <div className={styles.createGrid2} style={{ marginBottom: 0 }}>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label>Prioridad</label>
                <select
                  value={editActPriority}
                  disabled={!canEditDiagram}
                  onChange={(e) => setEditActPriority(e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label>Fecha Límite</label>
                <input
                  type="date"
                  value={editActDueDate}
                  disabled={!canEditDiagram}
                  onChange={(e) => setEditActDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* SECCIÓN 2: 🏭 ASIGNACIÓN Y RESPONSABLES */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>🏭 Asignación y Personal</span>
              </h3>
            </div>

            {/* Banner de áreas sugeridas del proyecto */}
            {linkedProject && linkedProject.areas && linkedProject.areas.length > 0 && (
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '4px' }}>
                  Áreas del Proyecto "{linkedProject.name}":
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {linkedProject.areas.map((aId) => {
                    const areaObj = (allAvailableAreas && allAvailableAreas.length > 0 ? allAvailableAreas : allBlockAreas || []).find((a) => a.id === aId);
                    const isMatching = editActAreaId === aId;
                    return (
                      <button
                        key={aId}
                        type="button"
                        onClick={() => {
                          if (!canEditDiagram) return;
                          setEditActAreaId(aId);
                          setEditActOperarioId('');
                        }}
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '8px',
                          fontWeight: 700,
                          border: isMatching ? '1.5px solid #2563eb' : '1px solid var(--color-gray-300)',
                          background: isMatching ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                          color: isMatching ? '#2563eb' : 'var(--color-gray-600)',
                          cursor: canEditDiagram ? 'pointer' : 'default',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {areaObj?.icon || '🏭'} {areaObj?.name || aId} {isMatching ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.field} style={{ marginBottom: '8px' }}>
              <label>Área Responsable *</label>
              <select
                value={editActAreaId}
                disabled={!canEditDiagram}
                onChange={(e) => {
                  const nextArea = e.target.value;
                  setEditActAreaId(nextArea);
                  setEditActOperarioId('');
                }}
              >
                {linkedProject && linkedProject.areas && linkedProject.areas.length > 0 && (
                  <optgroup label={`Áreas del Proyecto (${linkedProject.name})`}>
                    {linkedProject.areas.map((aId) => {
                      const a = (allAvailableAreas && allAvailableAreas.length > 0 ? allAvailableAreas : allBlockAreas || []).find((x) => x.id === aId);
                      if (!a) return null;
                      return (
                        <option key={`proj-${a.id}`} value={a.id}>
                          ⭐ {a.icon || '🏭'} {a.name} (Del Proyecto)
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                <optgroup label="Todas las Áreas Disponibles">
                  {(allAvailableAreas && allAvailableAreas.length > 0 ? allAvailableAreas : allBlockAreas || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.icon || '🏭'} {a.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className={styles.field} style={{ marginBottom: '8px' }}>
              <label>🎖️ Responsable del Área</label>
              {(() => {
                const sup = getSupervisorForArea ? getSupervisorForArea(editActAreaId) : { name: 'Supervisor de Área' };
                return (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(37, 99, 235, 0.08)',
                      border: '1.5px solid rgba(37, 99, 235, 0.25)',
                      color: 'var(--color-dark)',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    title="Supervisor oficial de esta área"
                  >
                    <span style={{ fontSize: '15px' }}>🎖️</span>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      <span>{sup.name}</span>
                      {sup.role && <span style={{ fontSize: '11px', color: 'var(--color-gray-500)', fontWeight: 500, marginLeft: '6px' }}>({sup.role})</span>}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className={styles.field} style={{ marginBottom: '8px' }}>
              <label>👷 Personal Asignado (Operario a Cargo)</label>
              <select
                value={editActOperarioId || ''}
                disabled={!canEditDiagram}
                onChange={(e) => setEditActOperarioId(e.target.value)}
              >
                <option value="">-- Sin asignar a alguien específico (Asignar después) --</option>
                {(() => {
                  const filtered = getCollaboratorsForArea ? getCollaboratorsForArea(editActAreaId) : [];
                  const listToRender = filtered.length > 0 ? filtered : (allCollaborators && allCollaborators.length > 0 ? allCollaborators : operarios);
                  return listToRender.map((op) => (
                    <option key={op.id} value={op.id}>
                      👷 {op.name} {op.puesto ? `(${op.puesto})` : ''}
                    </option>
                  ));
                })()}
              </select>
            </div>

            {entity?.gameId && (
              <div className={styles.field} style={{ marginBottom: '8px' }}>
                <label>🎮 Piezas que representa esta actividad para el Juego</label>
                <input
                  type="number"
                  min="1"
                  value={editActQuantity}
                  disabled={!canEditDiagram}
                  onChange={(e) => setEditActQuantity(e.target.value)}
                />
                <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', margin: '4px 0 0' }}>
                  Al completar esta actividad, se suma automáticamente esta cantidad al avance de fabricación del área.
                </p>
              </div>
            )}

            {canEditDiagram && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleUpdateExistingActivity}
                isLoading={isSavingAct}
                style={{ width: '100%', marginTop: '4px' }}
              >
                💾 Guardar Cambios en la Tarea
              </Button>
            )}
          </div>

          {/* SECCIÓN 3: ✅ SUB-LISTA DE TAREAS / CHECKLIST */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>☑️ Sub-tareas / Checklist</span>
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: checklist.length > 0 && checklist.filter((c) => c.completed).length === checklist.length ? '#10b981' : '#06b6d4',
                  background: checklist.length > 0 && checklist.filter((c) => c.completed).length === checklist.length ? 'rgba(16, 185, 129, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
              >
                {checklist.filter((c) => c.completed).length} / {checklist.length} ({checklist.length > 0 ? Math.round((checklist.filter((c) => c.completed).length / checklist.length) * 100) : 0}%)
              </span>
            </div>

            {checklist.length > 0 && (
              <div className={styles.checklistProgressWrap}>
                <div
                  className={styles.checklistProgressBar}
                  style={{
                    width: `${(checklist.filter((c) => c.completed).length / checklist.length) * 100}%`,
                  }}
                />
              </div>
            )}

            {checklist.length > 0 ? (
              <div className={styles.checklistList}>
                {checklist.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className={`${styles.checklistItem} ${item.completed ? styles.checklistItemDone : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(item.completed)}
                      disabled={!canEditDiagram}
                      onChange={() => handleToggleChecklist(idx)}
                      className={styles.checklistCheckbox}
                      title={item.completed ? 'Marcar como pendiente' : 'Marcar como completada'}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className={`${styles.checklistItemText} ${item.completed ? styles.checklistItemTextDone : ''}`}>
                        {item.text}
                      </span>
                      {item.completed && item.completedAt && (
                        <div style={{ fontSize: '10px', color: '#10b981', marginTop: '2px', fontWeight: 500 }}>
                          ✓ Hecho {new Date(item.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {item.completedBy ? ` por ${item.completedBy}` : ''}
                        </div>
                      )}
                    </div>
                    {canEditDiagram && (
                      <button
                        type="button"
                        className={styles.checklistDeleteBtn}
                        onClick={() => handleDeleteChecklist(idx)}
                        title="Eliminar esta sub-tarea"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--color-gray-400)', fontStyle: 'italic', padding: '4px 0' }}>
                Sin sub-tareas. Agrega los pasos o requisitos para realizar esta actividad.
              </div>
            )}

            {canEditDiagram && (
              <div className={styles.checklistInputRow}>
                <input
                  type="text"
                  className={styles.checklistInput}
                  placeholder="➕ Escribe un paso o sub-tarea..."
                  value={newChecklistText}
                  onChange={(e) => setNewChecklistText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddChecklist();
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.checklistAddBtn}
                  onClick={handleAddChecklist}
                  title="Agregar sub-tarea"
                >
                  + Agregar
                </button>
              </div>
            )}
          </div>

          {/* SECCIÓN 3.5: 🗄️ EVIDENCIA (NAS) — la evidencia real vive en el NAS local del
              taller; aquí solo se captura/edita el enlace que redirige a ella. Mismo campo
              que el botón "🗄️ Evidencia" de la tarjeta del nodo (EditorVisualPage.jsx). */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>🗄️ Evidencia (NAS)</span>
              </h3>
            </div>
            <div className={styles.field}>
              <label>📤 Subir archivo (automático al NAS)</label>
              <input
                type="file"
                disabled={!canEditDiagram || isUploadingInspectorEvidence}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadInspectorEvidence(file);
                  e.target.value = '';
                }}
              />
              {isUploadingInspectorEvidence && (
                <p style={{ fontSize: '11.5px', color: '#0284c7', fontWeight: 600, marginTop: '4px' }}>⏳ Subiendo...</p>
              )}
            </div>
            <div className={styles.field}>
              <label>O pega un link manual (respaldo)</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={editActEvidenceLink}
                  disabled={!canEditDiagram}
                  placeholder="Enlace a la carpeta/archivo en el NAS"
                  onChange={(e) => setEditActEvidenceLink(e.target.value)}
                  style={{ flex: 1 }}
                />
                {entity.evidenceLink && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => window.open(entity.evidenceLink, '_blank', 'noopener,noreferrer')}
                  >
                    Abrir
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* SECCIÓN 4: 🖼️ AYUDA VISUAL / PLANOS / ADJUNTOS */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>🖼️ Ayuda Visual / Planos / Adjuntos</span>
              </h3>

              {Boolean((entity.attachments && entity.attachments.length > 0) || (editActLinks && editActLinks.length > 0) || entity.fileData) && (
                <button
                  type="button"
                  onClick={() => handleDeployAllActivityResources(node, { ...entity, links: editActLinks })}
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(37, 99, 235, 0.12)',
                    color: '#2563eb',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    cursor: 'pointer',
                  }}
                  title="Colocar / mostrar todos los recursos en el lienzo"
                >
                  📍 Desplegar Todo
                </button>
              )}
            </div>

            {/* Subir archivo adjunto a la actividad */}
            {canEditDiagram && (
              <div>
                <input
                  type="file"
                  accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadActivityAttachment(file);
                  }}
                  style={{ fontSize: '11px', width: '100%' }}
                />
                {isUploadingActFile && (
                  <div style={{ fontSize: '11.5px', color: '#0284c7', marginTop: '4px', fontWeight: 600 }}>
                    ⏳ Subiendo archivo a la nube...
                  </div>
                )}
              </div>
            )}

            {/* Lista de adjuntos de la actividad */}
            {((entity.attachments && entity.attachments.length > 0) || entity.fileData) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                {[...(entity.attachments || []), ...(entity.fileData ? [entity.fileData] : [])].map((att, idx) => {
                  const isImg = att.type?.startsWith('image/') || att.url?.match(/\.(jpeg|jpg|png|webp|gif)($|\?)/i) || att.dataUrl?.startsWith('data:image');
                  const isAlreadyOnCanvas = (nodes || []).some((n) => {
                    if (n.type !== 'recurso') return false;
                    const fData = n.draftFields?.fileData;
                    const nUrl = n.draftFields?.url || fData?.url || fData?.dataUrl;
                    const attUrl = att.url || att.dataUrl;
                    const matchesUrl = Boolean(nUrl && attUrl && nUrl === attUrl);
                    const matchesName = Boolean(fData?.name && att.name && fData.name === att.name);
                    const isConnected = (edges || []).some((e) => (e.from === node.id && e.to === n.id) || (e.to === node.id && e.from === n.id));
                    return (matchesUrl || matchesName) && isConnected;
                  });

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 8px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
                        <span style={{ fontSize: '14px' }}>{isImg ? '🖼️' : '📄'}</span>
                        <span style={{ fontSize: '11.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {att.name || 'Archivo adjunto'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isImg && (
                          <button
                            type="button"
                            className={styles.wireToolbarBtn}
                            onClick={() => handleSpawnFloatingImage(att)}
                            title={isAlreadyOnCanvas ? "Ver en el lienzo (enfocar)" : "Colocar como imagen flotante en el lienzo"}
                            style={{
                              fontSize: '10.5px',
                              padding: '2px 6px',
                              background: isAlreadyOnCanvas ? 'rgba(6, 182, 212, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: isAlreadyOnCanvas ? '#06b6d4' : '#10b981',
                              border: '1px solid currentColor',
                            }}
                          >
                            {isAlreadyOnCanvas ? '👁️ En lienzo' : '📍 Colocar'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.wireToolbarBtn}
                          onClick={() => {
                            setPreviewResourceModal({
                              isOpen: true,
                              title: `${entity.title} - ${att.name || 'Adjunto'}`,
                              resourceType: isImg ? 'imagen' : 'documento',
                              url: att.url || att.dataUrl,
                              fileData: att,
                              notes: entity.description || '',
                            });
                          }}
                          title="Ver archivo"
                          style={{ fontSize: '10.5px', padding: '2px 6px' }}
                        >
                          🔍
                        </button>
                        {canEditDiagram && (
                          <button
                            type="button"
                            onClick={() => handleRemoveActivityAttachment(idx)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                            title="Eliminar adjunto"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Enlaces de la actividad */}
            <div style={{ marginTop: '6px' }}>
              <label style={{ fontSize: '10.5px', color: 'var(--color-gray-500)', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                🔗 Enlaces Web / Nube (Drive, Figma, Autodesk, etc.):
              </label>
              {editActLinks && editActLinks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                  {editActLinks.map((lnk, lIdx) => {
                    const isAlreadyOnCanvas = (nodes || []).some((n) => {
                      if (n.type !== 'recurso') return false;
                      const nUrl = n.draftFields?.url;
                      const matchesUrl = Boolean(nUrl && nUrl === lnk);
                      const isConnected = (edges || []).some((e) => (e.from === node.id && e.to === n.id) || (e.to === node.id && e.from === n.id));
                      return matchesUrl && isConnected;
                    });

                    return (
                      <div key={lIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', background: 'rgba(37, 99, 235, 0.06)', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.2)', fontSize: '11px', gap: '6px' }}>
                        <a href={formatExternalUrl(lnk)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textDecoration: 'none' }}>
                          🔗 {lnk.replace(/^https?:\/\//i, '').split('/')[0]}
                        </a>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            className={styles.wireToolbarBtn}
                            onClick={() => handleSpawnFloatingLink(lnk)}
                            title={isAlreadyOnCanvas ? "Ver en el lienzo (enfocar)" : "Colocar como emblema flotante en el lienzo"}
                            style={{
                              fontSize: '10.5px',
                              padding: '2px 6px',
                              background: isAlreadyOnCanvas ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: isAlreadyOnCanvas ? '#38bdf8' : '#10b981',
                              border: '1px solid currentColor',
                            }}
                          >
                            {isAlreadyOnCanvas ? '👁️ En lienzo' : '📍 Colocar'}
                          </button>
                          {canEditDiagram && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLinkFromActivity(lIdx)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
                              title="Eliminar enlace de la actividad"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {canEditDiagram && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    placeholder="https://drive.google.com/..."
                    value={newLinkInput}
                    onChange={(e) => setNewLinkInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddLinkToActivity();
                    }}
                    style={{ fontSize: '11px', flex: 1, padding: '4px 6px' }}
                  />
                  <Button variant="secondary" size="sm" onClick={handleAddLinkToActivity} style={{ fontSize: '11px', padding: '2px 8px' }}>
                    + Link
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* SECCIÓN 5: ⚡ ESTADO Y CONTROL DE PRODUCCIÓN */}
          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionHeader}>
              <h3 className={styles.inspectorSectionTitle}>
                <span>⚡ Estado y Flujo de Trabajo</span>
              </h3>
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  textTransform: 'uppercase',
                  background:
                    entity.status === 'completado'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : entity.status === 'proceso'
                      ? 'rgba(37, 99, 235, 0.15)'
                      : 'rgba(156, 163, 175, 0.15)',
                  color:
                    entity.status === 'completado'
                      ? '#10b981'
                      : entity.status === 'proceso'
                      ? '#2563eb'
                      : '#6b7280',
                }}
              >
                {entity.status === 'completado' ? '✅ Completada' : entity.status === 'proceso' ? '⚡ En Proceso' : '⏳ Pendiente'}
              </span>
            </div>

            {entity.startedAt && (
              <div style={{ fontSize: '11px', color: 'var(--color-gray-600)' }}>
                🕒 Inicio: <strong>{new Date(entity.startedAt).toLocaleString()}</strong>
              </div>
            )}
            {entity.completedAt && (
              <div style={{ fontSize: '11px', color: '#10b981' }}>
                ✅ Fin: <strong>{new Date(entity.completedAt).toLocaleString()}</strong>
              </div>
            )}
            {entity.completionNotes && (
              <div style={{ fontSize: '11px', color: 'var(--color-gray-600)', fontStyle: 'italic', borderTop: '1px dashed var(--color-gray-200)', paddingTop: '4px' }}>
                &ldquo;{entity.completionNotes}&rdquo;
              </div>
            )}

            {/* Secuencia y Dependencias de Flujo de la Actividad */}
            {(() => {
              const blockStatus = getActivityBlockStatus ? getActivityBlockStatus(node) : { isBlocked: false, blockers: [], predecessors: [] };
              const predecessors = blockStatus.predecessors || [];

              return (
                <div style={{ marginTop: '4px' }}>
                  <label style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--color-dark)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>🔗 Secuencia de Flujo (Predecesores)</span>
                    {blockStatus.isBlocked && (
                      <span style={{ fontSize: '9.5px', color: '#ef4444', fontWeight: 800, background: 'rgba(239, 68, 68, 0.1)', padding: '1px 5px', borderRadius: '4px' }}>
                        🔒 BLOQUEADA
                      </span>
                    )}
                  </label>

                  {predecessors.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {predecessors.map((pred, idx) => {
                        const isDone = pred.entity?.status === 'completado' || pred.entity?.status === 'hecho';
                        const isInProgress = pred.entity?.status === 'proceso';
                        return (
                          <div
                            key={pred.entity?.id || pred.node?.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: isDone ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.06)',
                              border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.2)'}`,
                              fontSize: '11px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', maxWidth: '70%' }}>
                              <span>{isDone ? '✅' : isInProgress ? '⚡' : '⏳'}</span>
                              <span style={{ fontWeight: 600, color: 'var(--color-dark)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {pred.entity?.title || nodeTitle(pred.node) || 'Actividad previa'}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                background: isDone ? 'rgba(16, 185, 129, 0.15)' : isInProgress ? 'rgba(37, 99, 235, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                                color: isDone ? '#10b981' : isInProgress ? '#2563eb' : '#6b7280',
                              }}
                            >
                              {isDone ? 'Terminada' : isInProgress ? 'En Proceso' : 'Pendiente'}
                            </span>
                          </div>
                        );
                      })}

                      {blockStatus.isBlocked && (
                        <div style={{ fontSize: '10.5px', color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '6px', padding: '5px 8px', lineHeight: 1.3 }}>
                          ⚠️ <strong>Secuencia en espera:</strong> Debes terminar la(s) fase(s) anterior(es) antes de iniciar esta tarea.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: '10.5px', color: 'var(--color-gray-500)', fontStyle: 'italic', padding: '2px 0' }}>
                      🟢 Fase inicial (sin actividades previas requeridas).
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const hasControl = canUserControlActivity ? canUserControlActivity(entity) : true;
              if (!hasControl) {
                return (
                  <div style={{ padding: '8px', background: 'rgba(0,0,0,0.04)', borderRadius: '6px', marginTop: '6px', fontSize: '11.5px', color: 'var(--color-gray-600)', textAlign: 'center' }}>
                    🔒 Solo el colaborador asignado o el supervisor de esta área pueden iniciar o terminar esta actividad.
                  </div>
                );
              }

              const blockStatus = getActivityBlockStatus ? getActivityBlockStatus(node) : { isBlocked: false };
              const isSequenceBlocked = blockStatus.isBlocked;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  {entity.status === 'pendiente' && (
                    <Button
                      variant={isSequenceBlocked ? "secondary" : "primary"}
                      size="md"
                      disabled={isSequenceBlocked}
                      onClick={() => {
                        if (isSequenceBlocked) {
                          toast.warning(`🔒 Actividad bloqueada: ${blockStatus.reason}`);
                          return;
                        }
                        onStartActivity && onStartActivity(entity.id, entity.title);
                      }}
                      style={{
                        width: '100%',
                        opacity: isSequenceBlocked ? 0.7 : 1,
                        cursor: isSequenceBlocked ? 'not-allowed' : 'pointer',
                      }}
                      title={isSequenceBlocked ? blockStatus.reason : 'Iniciar esta actividad'}
                    >
                      {isSequenceBlocked ? '🔒 Espera actividad previa' : '▶️ Iniciar Actividad'}
                    </Button>
                  )}
                  {entity.status === 'proceso' && (
                    <>
                      <Button
                        variant="success"
                        size="md"
                        onClick={() => onOpenCompleteModal && onOpenCompleteModal(entity.id, entity.title)}
                        style={{ width: '100%' }}
                      >
                        ✅ Marcar como Terminada
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onResetActivityStatus && onResetActivityStatus(entity.id, 'pendiente')}
                        style={{ width: '100%' }}
                      >
                        ⏸️ Regresar a Pendiente
                      </Button>
                    </>
                  )}
                  {entity.status === 'completado' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onResetActivityStatus && onResetActivityStatus(entity.id, 'proceso')}
                      style={{ width: '100%' }}
                    >
                      🔄 Reabrir Actividad
                    </Button>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'area' && (
        <>
          <div className={styles.field}><label>Nombre del Área</label><input type="text" value={entity.name} disabled /></div>
          {(() => {
            const supervisor = (getSupervisorForArea && getSupervisorForArea(node.refId || entity.id)) || {
              name: 'Supervisor de Área',
              role: 'Supervisor',
            };
            return (
              <div className={styles.field}>
                <label>👤 Supervisor Oficial a Cargo</label>
                <input type="text" value={`${supervisor.name} (${supervisor.role})`} disabled />
              </div>
            );
          })()}
          <div className={styles.field}>
            <label>👥 Operarios en esta Estación</label>
            <input
              type="text"
              value={`${operarios.filter((o) => o.currentArea === (node.refId || entity.id)).length} operarios registrados`}
              disabled
            />
          </div>
          <div className={styles.field}>
            <label>📌 Tareas Asignadas a esta Área</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={`${actividades.filter((a) => a.areaId === (node.refId || entity.id)).length} tareas registradas`}
                disabled
                style={{ flex: 1 }}
              />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => onViewAreaTasks && onViewAreaTasks(node.refId || entity.id, entity.name)}
                title="Ver lista completa de tareas de esta área"
              >
                📋 Ver
              </Button>
            </div>
          </div>
        </>
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

      {node.type === 'recurso' && (() => {
        const info = getResourcePreviewInfo(node);
        const isUploading = node.draftFields?.fileData?.isUploading || node.draftFields?.isUploading;

        return (
          <>
            {/* Título de la Ayuda Visual */}
            <div className={styles.field}>
              <label>Título / Nombre</label>
              <input
                type="text"
                value={node.draftFields?.title || node.title || ''}
                disabled={!canEditDiagram}
                placeholder="Ej. Plano de Corte Rev 3..."
                onChange={(e) => updateDraftField('title', e.target.value)}
              />
            </div>

            {/* URL o Enlace Externo */}
            <div className={styles.field}>
              <label>🔗 URL Externa o en la Nube (Drive, Figma, Autodesk, Web)</label>
              <input
                type="text"
                value={node.draftFields?.url || ''}
                disabled={!canEditDiagram}
                placeholder="https://drive.google.com/... o https://figma.com/..."
                onChange={(e) => updateDraftField('url', e.target.value)}
              />
            </div>

            {/* Subir Archivo Local / Nube */}
            {canEditDiagram && (
              <div className={styles.field}>
                <label>📁 Cargar / Cambiar Archivo (Imagen, PDF, SolidWorks, Inventor, STEP, CAD)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const localBlobUrl = URL.createObjectURL(file);

                      // Preview inmediato local
                      updateDraftField('fileData', {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        dataUrl: localBlobUrl,
                        isUploading: true,
                      });

                      toast.info(`⏳ Guardando "${file.name}" en la nube...`);

                      try {
                        const uploaded = await uploadResourceFile(file, lienzoActivoId);
                        if (uploaded) {
                          updateDraftField('fileData', uploaded);
                          toast.success(`✅ Archivo "${file.name}" guardado permanentemente.`);
                        }
                      } catch (err) {
                        console.error('Error al subir archivo a Storage:', err);
                        toast.danger('No se pudo subir a Storage, pero el archivo se mantendrá en tu sesión local.');
                      }
                    }
                  }}
                />

                {isUploading && (
                  <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#0284c7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>⏳</span> Subiendo al NAS...
                  </div>
                )}

                {info.fileName && !isUploading && (
                  <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#10b981', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                    <span>✓ {info.fileName} {info.fileSize ? `(${Math.round(info.fileSize / 1024)} KB)` : ''}</span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                      onClick={() => {
                        const storagePath = node.draftFields?.fileData?.storagePath;
                        const nasPath = node.draftFields?.fileData?.nasPath;
                        if (storagePath && storage) {
                          deleteObject(ref(storage, storagePath)).catch((e) => console.warn('No se pudo borrar archivo de Storage:', e));
                        }
                        if (nasPath) deleteNasFile(nasPath);
                        updateDraftField('fileData', null);
                      }}
                      title="Quitar archivo adjunto"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notas Técnicas / Instrucciones */}
            <div className={styles.field}>
              <label>📝 Notas e Instrucciones Técnicas</label>
              <textarea
                rows="3"
                value={node.draftFields?.notes || ''}
                disabled={!canEditDiagram}
                placeholder="Especificaciones, cotas críticas, instrucciones de ensamble..."
                onChange={(e) => updateDraftField('notes', e.target.value)}
              />
            </div>

            {/* Estado de Asignación / Conexión por cable */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', display: 'block', marginBottom: '4px' }}>
                🔌 Conexión en el Diagrama
              </label>
              {(() => {
                const connectedEdge = edges.find(
                  (e) =>
                    (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
                    (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
                );
                const targetNode = connectedEdge
                  ? findNode(findNode(connectedEdge.from)?.type === 'actividad' || findNode(connectedEdge.from)?.type === 'proyecto' ? connectedEdge.from : connectedEdge.to)
                  : null;

                if (targetNode) {
                  return (
                    <div style={{ padding: '8px 10px', background: 'rgba(37, 99, 235, 0.08)', borderRadius: '6px', border: '1px solid rgba(37, 99, 235, 0.25)', fontSize: '12px', color: 'var(--color-dark)' }}>
                      <strong>{targetNode.type === 'proyecto' ? '🗂️ Asignado al Proyecto:' : '📌 Asignado a la Actividad:'}</strong>
                      <div style={{ marginTop: '2px', fontWeight: 600, color: 'var(--color-primary)' }}>{nodeTitle(targetNode)}</div>
                    </div>
                  );
                }
                return (
                  <div style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', border: '1px dashed var(--color-gray-300)', fontSize: '11.5px', color: 'var(--color-gray-500)' }}>
                    💡 Arrastra un cable desde este nodo hasta una <strong>Actividad</strong> o <strong>Proyecto</strong> para vincularlo directamente.
                  </div>
                );
              })()}
            </div>

            {/* Botón para Abrir Vista Previa */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setPreviewResourceModal({
                  isOpen: true,
                  title: nodeTitle(node),
                  resourceType: info.resType,
                  url: info.rawUrl || info.fileUrl || '',
                  fileData: node.draftFields?.fileData || null,
                  notes: node.draftFields?.notes || '',
                });
              }}
              style={{ width: '100%', marginTop: '12px' }}
            >
              🔍 Ver en Pantalla Completa / Descargar
            </Button>
          </>
        );
      })()}

      {!node.draft && !entity && node.type !== 'recurso' && (
        <p style={{ fontSize: '12.5px', color: 'var(--color-alert)' }}>Este registro ya no existe.</p>
      )}

      {/* 🎨 PERSONALIZAR COLOR DEL NODO */}
      {canEditDiagram && (
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <label style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', display: 'block', marginBottom: '8px' }}>
            🎨 Color Personalizado del Nodo
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {PRESET_COLORS.map((c) => {
              const isSelected = (node.customColor || meta.colorVar || '#ea580c') === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => updateNodeColor(node.id, c.value)}
                  title={c.name}
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: c.value,
                    border: isSelected ? '2.5px solid #ffffff' : '1.5px solid rgba(0,0,0,0.15)',
                    boxShadow: isSelected ? `0 0 0 2px ${c.value}, 0 2px 8px rgba(0,0,0,0.3)` : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.15s ease',
                  }}
                />
              );
            })}
            <label title="Elegir color personalizado" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', margin: 0 }}>
              <input
                type="color"
                value={node.customColor || meta.colorVar || '#ea580c'}
                onChange={(e) => updateNodeColor(node.id, e.target.value)}
                style={{ width: '28px', height: '28px', padding: '0', border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
              />
            </label>
          </div>
        </div>
      )}

      {/* ⚡ CABLES Y CONEXIONES CON CAMBIO DE COLOR */}
      <div className={styles.calloutBox} style={{ marginTop: '16px', background: 'rgba(234, 88, 12, 0.06)', border: '1px solid rgba(234, 88, 12, 0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong style={{ color: 'var(--color-primary)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            ⚡ Conexiones ({incoming.length + outgoing.length})
          </strong>
        </div>

        {incoming.length === 0 && outgoing.length === 0 && (
          <span className={styles.emptyConns}>Sin cables conectados todavía. Arrastra desde los puntos laterales, superior o inferior.</span>
        )}

        {outgoing.map((e) => {
          const other = findNode(e.to);
          if (!other) return null;
          const otherMeta = NODE_TYPES[other.type] || DEFAULT_NODE_META;
          const wireColor = e.customColor || node.customColor || meta.colorVar || '#ea580c';

          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '6px' }}>
              <span style={{ fontSize: '11.5px' }}>
                <span className={styles.connArrow} style={{ color: wireColor }}>→</span> Conecta a <strong>{otherMeta.icon} {nodeTitle(other)}</strong>
              </span>
              {canEditDiagram && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={wireColor}
                    onChange={(evt) => updateEdgeColor(e.id, evt.target.value)}
                    title="Cambiar color de este cable"
                    style={{ width: '22px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                  />
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                    onClick={() => {
                      const nextEdges = edges.filter((ed) => ed.id !== e.id);
                      setEdges(nextEdges);
                      saveToFirestore(nodes, nextEdges);
                      toast.info('Cable desconectado.');
                    }}
                    title="Desconectar este cable"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {incoming.map((e) => {
          const other = findNode(e.from);
          if (!other) return null;
          const otherMeta = NODE_TYPES[other.type] || DEFAULT_NODE_META;
          const wireColor = e.customColor || other.customColor || otherMeta.colorVar || '#ea580c';

          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '6px' }}>
              <span style={{ fontSize: '11.5px' }}>
                <span className={styles.connArrow} style={{ color: wireColor }}>←</span> Recibe de <strong>{otherMeta.icon} {nodeTitle(other)}</strong>
              </span>
              {canEditDiagram && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={wireColor}
                    onChange={(evt) => updateEdgeColor(e.id, evt.target.value)}
                    title="Cambiar color de este cable"
                    style={{ width: '22px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                  />
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                    onClick={() => {
                      const nextEdges = edges.filter((ed) => ed.id !== e.id);
                      setEdges(nextEdges);
                      saveToFirestore(nodes, nextEdges);
                      toast.info('Cable desconectado.');
                    }}
                    title="Desconectar este cable"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

EditorVisualPage.propTypes = {
  standalone: PropTypes.bool,
};

export default EditorVisualPage;
