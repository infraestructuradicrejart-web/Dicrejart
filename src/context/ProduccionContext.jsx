/**
 * @file ProduccionContext.jsx
 * @description Contexto global para la gestión de proyectos, líneas de juegos,
 * y registros de avance de producción (piezas por área) en Dicrejart.
 * Conectado en tiempo real con Cloud Firestore.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { uploadEvidencePhotos as uploadEvidencePhotosShared, deleteEvidencePhotos, withTimeout } from '../utils/evidenceStorage';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { AuthContext } from './AuthContext';
import { logAudit } from '../utils/auditLog';

/**
 * Comprime y sube a Firebase Storage la evidencia fotográfica de un registro de
 * producción, bajo `historial_produccion/{logId}/`. Retorna la metadata mínima
 * (url + path) que se guarda en el documento de Firestore, no el archivo en sí.
 */
const uploadEvidencePhotos = (logId, files) => uploadEvidencePhotosShared('historial_produccion', logId, files);

/**
 * Comprime y sube a Firebase Storage la evidencia fotográfica que Producto Terminado
 * adjunta al recibir la entrega de un área, bajo `recepcion_pt/{gameId}_{areaId}/`.
 */
const uploadReceptionEvidencePhotos = (gameId, areaId, files) =>
  uploadEvidencePhotosShared('recepcion_pt', `${gameId}_${areaId}`, files);

/**
 * Indica si todas las órdenes de trabajo a proveedores externos de un juego
 * (piezas de fibra de vidrio, letreros iluminados, etc.) ya fueron recibidas.
 */
const allExternalOrdersReceived = (game) =>
  (game.externalOrders || []).every((o) => o.status === 'recibido');

/**
 * Indica si un juego ya recibió físicamente al menos una pieza de proveedor externo.
 */
const hasReceivedExternalPieces = (game) => {
  const orders = game.externalOrders || [];
  return orders.length > 0 && orders.every((o) => o.status === 'recibido');
};

/**
 * Indica si el trabajo de iluminación LED de Mantenimiento ya se completó.
 */
const isLedWorkComplete = (game) => {
  if (!game.ledWork?.required) return true;
  const steps = game.ledWork.steps || {};
  return Boolean(steps.instalacionLed && steps.tableroElectrico && steps.revisionFuncionamiento);
};

/**
 * Mapa de dependencias de secuencia entre áreas: Herrería depende de que Corte Láser ya haya completado su meta.
 * @constant
 */
export const AREA_SEQUENCE_DEPENDENCIES = {
  herreria: 'corte-laser',
};

/**
 * Indica si un área está bloqueada para un juego porque el área de la que depende todavía no completa su meta al 100%.
 */
export const isAreaBlockedBySequence = (game, areaId) => {
  const requiredArea = AREA_SEQUENCE_DEPENDENCIES[areaId];
  if (!requiredArea || !game.areas.includes(requiredArea)) return false;
  return game.areaStatus?.[requiredArea] !== 'completado';
};

/**
 * Si `areaId` alimenta a otra área del MISMO juego (ej. Corte Láser → Herrería), regresa
 * el id de esa área dependiente; si no, null. Esa área NO entrega directo a Producto
 * Terminado (es un traspaso interno) y por lo tanto no requiere aprobación de Calidad ni
 * el flujo de notificar/recibir entrega.
 */
export const getFeederDependentAreaId = (game, areaId) => {
  const entry = Object.entries(AREA_SEQUENCE_DEPENDENCIES).find(
    ([dependentArea, requiredArea]) => requiredArea === areaId && game.areas.includes(dependentArea)
  );
  return entry ? entry[0] : null;
};

/**
 * Recalcula el estatus y progreso de Producto Terminado de un juego.
 */
const recalculatePTStatus = (game) => {
  const operativeAreas = game.areas;
  // Las áreas "alimentadoras" (ej. Corte Láser cuando el juego también tiene Herrería)
  // entregan su material internamente a la siguiente área, no a Producto Terminado —
  // no deben exigirse en 'recibido_pt' para considerar el juego consolidado en PT.
  const terminalAreas = operativeAreas.filter((aid) => !getFeederDependentAreaId(game, aid));
  const allOperativeReceived = terminalAreas.every(
    (aid) => game.areaDeliveryStatus?.[aid] === 'recibido_pt'
  );

  const areaStatus = { ...game.areaStatus };
  const producedPieces = { ...game.producedPieces };

  if (allOperativeReceived && allExternalOrdersReceived(game) && isLedWorkComplete(game)) {
    areaStatus['producto-terminado'] = 'completado';
    producedPieces['producto-terminado'] = 1;
  } else {
    areaStatus['producto-terminado'] = 'pendiente';
    producedPieces['producto-terminado'] = 0;
  }

  const allAreasList = [...operativeAreas, 'producto-terminado'];
  const totalProgressSum = allAreasList.reduce((sum, aid) => {
    const areaTarget = game.targetPieces?.[aid] || 1;
    const areaProd = producedPieces[aid] || 0;
    return sum + (areaProd / areaTarget) * 100;
  }, 0);

  const progress = Math.round(totalProgressSum / allAreasList.length);
  const status = progress === 100 ? 'completado' : 'progreso';

  return { areaStatus, producedPieces, progress, status };
};

export const ProduccionContext = createContext(null);

export const ProduccionProvider = ({ children }) => {
  // ============================================
  // ESTADO
  // ============================================
  const [proyectos, setProyectos] = useState([]);
  const [juegos, setJuegos] = useState([]);
  const [historialProduccion, setHistorialProduccion] = useState([]);
  const [tarimas, setTarimas] = useState([]);
  const [envios, setEnvios] = useState([]);
  // Historial de producción por área (mapa areaId -> registros), independiente del
  // `historialProduccion` global de arriba (que alimenta el Dashboard con lo más
  // reciente de TODA la fábrica). Se necesita aparte porque un límite global simple
  // podría dejar a un área sin ver ningún registro si otras áreas tuvieron más
  // actividad reciente.
  const [areaHistorial, setAreaHistorial] = useState({});

  const { limits } = useContext(ConfigContext) || {};
  const historialProduccionLimit = limits?.historialProduccionLimit || DEFAULT_LIMITS.historialProduccionLimit;
  const { user } = useContext(AuthContext) || {};

  // ============================================
  // ESCUCHAS EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !auth) return;

    // Los Providers envuelven toda la app (incluida /login), así que este efecto monta
    // antes de que el usuario inicie sesión. Si nos suscribiéramos a Firestore de inmediato,
    // la primera conexión fallaría por falta de permisos y jamás se reintentaría. Por eso
    // esperamos a `onAuthStateChanged` y nos (re)suscribimos cada vez que cambia la sesión.
    // También se vuelve a suscribir si cambia el límite dinámico configurado por el Admin.
    let unsubscribers = [];

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers = [];

      if (!user) {
        setProyectos([]);
        setJuegos([]);
        setHistorialProduccion([]);
        setTarimas([]);
        setEnvios([]);
        return;
      }

      unsubscribers.push(
        onSnapshot(collection(db, 'proyectos'), (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          setProyectos(list);
        })
      );

      unsubscribers.push(
        onSnapshot(collection(db, 'juegos'), (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          setJuegos(list);
        })
      );

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'historial_produccion'), orderBy('date', 'desc'), limit(historialProduccionLimit)),
          (snap) => {
            const list = [];
            snap.forEach((doc) => list.push(doc.data()));
            list.sort((a, b) => new Date(b.date) - new Date(a.date));
            setHistorialProduccion(list);
          }
        )
      );

      unsubscribers.push(
        onSnapshot(collection(db, 'tarimas'), (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          setTarimas(list);
        })
      );

      unsubscribers.push(
        onSnapshot(collection(db, 'envios'), (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          setEnvios(list);
        })
      );
    });

    return () => {
      unsubAuth();
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [historialProduccionLimit]);

  /**
   * Se suscribe al historial de producción de UNA sola área (no de toda la fábrica),
   * limitado a los `historialProduccionLimit` registros más recientes de esa área.
   * Pensado para que `ProduccionPage.jsx` la llame en un `useEffect` atado al `areaId`
   * de la ruta, y se desuscriba al salir de esa área o cambiar de área.
   * @param {string} areaId
   * @returns {function} función para desuscribirse
   */
  const subscribeAreaHistorial = useCallback((areaId) => {
    // Defensivo: un where('areaId','==',undefined) hace que Firestore rechace el query
    // de inmediato. El llamador (ProduccionPage.jsx) ya no debería invocar esto sin un
    // areaId real, pero se guarda aquí también por si algo más vuelve a llamarlo así.
    if (!db || !auth || !areaId) return () => {};

    const q = query(
      collection(db, 'historial_produccion'),
      where('areaId', '==', areaId),
      orderBy('date', 'desc'),
      limit(historialProduccionLimit)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach((doc) => list.push(doc.data()));
      setAreaHistorial((prev) => ({ ...prev, [areaId]: list }));
    });

    return unsub;
  }, [historialProduccionLimit]);

  // ============================================
  // ACCIONES FIRESTORE
  // ============================================

  /**
   * Registra un nuevo proyecto en el sistema
   */
  const addProject = useCallback(async (projectData) => {
    if (!db) return;
    const id = `PRJ-${String(proyectos.length + 1).padStart(3, '0')}`;
    const created = {
      id,
      progress: 0,
      status: 'progreso',
      ...projectData,
    };
    try {
      await setDoc(doc(db, 'proyectos', id), created);
      logAudit({ user, module: 'produccion', action: 'Creó un proyecto', details: created.name || id });
      return id;
    } catch (error) {
      console.error('Error al guardar proyecto en Firestore:', error);
      return null;
    }
  }, [proyectos, user]);

  /**
   * Actualiza un proyecto existente, por ejemplo para extender su fecha límite
   */
  const updateProject = useCallback(async (projectId, updatedFields) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const project = proyectos.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'Proyecto no encontrado' };

    try {
      await updateDoc(doc(db, 'proyectos', projectId), updatedFields);
      
      // Si se está cambiando la fecha endDate, podemos armar un texto más descriptivo en la bitácora
      let logDetails = project.name || projectId;
      if (updatedFields.endDate && updatedFields.endDate !== project.endDate) {
        logDetails = `${project.name} (Fecha extendida de ${project.endDate} a ${updatedFields.endDate})`;
      }

      logAudit({ user, module: 'produccion', action: 'Actualizó un proyecto', details: logDetails });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar proyecto en Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [proyectos, user]);

  /**
   * Registra un nuevo modelo de juego en el sistema
   */
  const addGame = useCallback(async (gameData) => {
    if (!db) return;
    const { name, projectId, areas, targetPieces } = gameData;
    const project = proyectos.find((p) => p.id === projectId);

    const id = `GME-${String(juegos.length + 101).padStart(3, '0')}`;

    const areaStatus = {};
    const initialProduced = {};
    const initialPalletized = {};
    const areaDeliveryStatus = {};
    const activeDefects = {};

    areas.forEach((area) => {
      areaStatus[area] = 'pendiente';
      initialProduced[area] = 0;
      initialPalletized[area] = 0;
      areaDeliveryStatus[area] = 'pendiente';
      activeDefects[area] = false;
    });

    areaDeliveryStatus['producto-terminado'] = 'pendiente';
    activeDefects['producto-terminado'] = false;

    const extendedTarget = {
      ...targetPieces,
      'producto-terminado': 1,
    };
    const initialProducedExtended = {
      ...initialProduced,
      'producto-terminado': 0,
    };
    const initialPalletizedExtended = {
      ...initialPalletized,
      'producto-terminado': 0,
    };

    const created = {
      id,
      name,
      projectId,
      projectName: project ? project.name : 'Proyecto Desconocido',
      progress: 0,
      status: 'progreso',
      areas,
      areaStatus,
      targetPieces: extendedTarget,
      producedPieces: initialProducedExtended,
      palletizedPieces: initialPalletizedExtended,
      areaDeliveryStatus,
      activeDefects,
      checklist: [],
      externalOrders: [],
      ledWork: null,
      qualityReview: {},
    };

    try {
      await setDoc(doc(db, 'juegos', id), created);
      logAudit({ user, module: 'produccion', action: 'Creó un juego', details: `${name} (${created.projectName})` });
      return id;
    } catch (error) {
      console.error('Error al agregar juego en Firestore:', error);
      return null;
    }
  }, [juegos, proyectos, user]);

  /**
   * Modifica las metas de piezas por área de un juego YA CREADO (ej. el cliente amplió o
   * redujo el pedido) — exclusivo de Supervisor de Área y Admin (ver canEditGameQuantities
   * en JuegosPage.jsx). No permite fijar una meta por debajo de lo que YA se produjo en esa
   * área, para no dejar el progreso de esa área por encima de 100% ni datos inconsistentes.
   */
  const updateGameTargetPieces = useCallback(async (gameId, newTargetPieces) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const game = juegos.find((j) => j.id === gameId);
    if (!game) return { ok: false, error: 'Juego no encontrado.' };

    for (const areaId of Object.keys(newTargetPieces)) {
      const newTarget = Number(newTargetPieces[areaId]);
      const produced = game.producedPieces?.[areaId] || 0;
      if (!Number.isFinite(newTarget) || newTarget <= 0) {
        return { ok: false, error: `La cantidad debe ser un número mayor a 0.` };
      }
      if (newTarget < produced) {
        return { ok: false, error: `No se puede fijar una meta de ${newTarget} pzas: ya se produjeron ${produced} en esa área.` };
      }
    }

    const targetPieces = { ...game.targetPieces, ...newTargetPieces };
    const areaStatus = { ...game.areaStatus };
    game.areas.forEach((areaId) => {
      const target = targetPieces[areaId] || 10;
      const produced = game.producedPieces?.[areaId] || 0;
      if (produced >= target) areaStatus[areaId] = 'completado';
      else if (produced > 0) areaStatus[areaId] = 'proceso';
      else areaStatus[areaId] = 'pendiente';
    });

    const allAreas = [...game.areas, 'producto-terminado'];
    const totalProgressSum = allAreas.reduce((sum, aid) => {
      const areaTarget = targetPieces[aid] || 1;
      const areaProd = game.producedPieces?.[aid] || 0;
      return sum + (areaProd / areaTarget) * 100;
    }, 0);
    const progress = Math.round(totalProgressSum / allAreas.length);
    const status = progress === 100 ? 'completado' : 'progreso';

    try {
      await updateDoc(doc(db, 'juegos', gameId), { targetPieces, areaStatus, progress, status });
      logAudit({ user, module: 'produccion', action: 'Modificó metas de piezas de un juego', details: `${game.name}: ${JSON.stringify(newTargetPieces)}` });

      const project = proyectos.find((p) => p.id === game.projectId);
      if (project) {
        const projectGames = juegos
          .map((jg) => (jg.id === game.id ? { ...jg, progress } : jg))
          .filter((jg) => jg.projectId === project.id);
        if (projectGames.length > 0) {
          const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
          const projProgress = Math.round(sumGamePct / projectGames.length);
          const projStatus = projProgress === 100 ? 'completado' : project.status;
          await updateDoc(doc(db, 'proyectos', project.id), { progress: projProgress, status: projStatus });
        }
      }

      return { ok: true };
    } catch (error) {
      console.error('Error al modificar metas de piezas del juego:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, proyectos, user]);

  /**
   * Renombra un juego ya creado (ej. se corrigió cómo lo pidió el cliente) — exclusivo de
   * Supervisor de Área y Admin (mismo permiso que updateGameTargetPieces, ver
   * canEditGameQuantities en JuegosPage.jsx). No afecta el nombre ya guardado en registros
   * históricos de otras colecciones (producción, actividades, materiales, etc.) — esos
   * quedan como una fotografía del nombre al momento en que se generaron, igual que pasa
   * al renombrar un área.
   */
  const updateGameName = useCallback(async (gameId, newName) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const game = juegos.find((j) => j.id === gameId);
    if (!game) return { ok: false, error: 'Juego no encontrado.' };

    const trimmedName = newName?.trim();
    if (!trimmedName) return { ok: false, error: 'El nombre del juego no puede estar vacío.' };
    if (trimmedName === game.name) return { ok: true };

    try {
      await updateDoc(doc(db, 'juegos', gameId), { name: trimmedName });
      logAudit({ user, module: 'produccion', action: 'Renombró un juego', details: `${game.name} -> ${trimmedName}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al renombrar juego:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Registra un log de producción de piezas y recalcula progresos
   */
  const registerProductionLog = useCallback(async (logData) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const { areaId, quantity, operator, gameName, notes, photos } = logData;
    const qty = Number(quantity);

    const logId = `PROD-${Date.now()}`;
    const createdLog = {
      id: logId,
      areaId,
      date: new Date().toISOString(),
      quantity: qty,
      operator,
      gameName,
      status: 'aprobado',
      notes: notes || 'Sin observaciones.',
      photos: [],
    };

    try {
      // Se guarda primero el registro y se recalculan los progresos; la evidencia
      // fotográfica se sube después y por separado (ver abajo), para que una falla de
      // conexión al subir la foto nunca eche a perder el registro ya guardado.
      await setDoc(doc(db, 'historial_produccion', logId), createdLog);
      logAudit({ user, module: 'produccion', action: 'Registró salida de producción', details: `${qty} pzas de "${gameName}" en ${areaId}` });

      const game = juegos.find((j) => j.name === gameName);
      if (game && !isAreaBlockedBySequence(game, areaId)) {
        const currentProduced = game.producedPieces?.[areaId] || 0;
        const targetLimit = game.targetPieces?.[areaId] || 10;
        const newProduced = Math.min(targetLimit, currentProduced + qty);

        const producedPieces = {
          ...game.producedPieces,
          [areaId]: newProduced,
        };

        const areaStatus = { ...game.areaStatus };
        if (newProduced >= targetLimit) {
          areaStatus[areaId] = 'completado';
        } else if (newProduced > 0) {
          areaStatus[areaId] = 'proceso';
        } else {
          areaStatus[areaId] = 'pendiente';
        }

        const operativeAreas = game.areas;
        const allOperativeReceived = operativeAreas.every(
          (aid) => game.areaDeliveryStatus?.[aid] === 'recibido_pt'
        );

        if (allOperativeReceived && allExternalOrdersReceived(game) && isLedWorkComplete(game)) {
          areaStatus['producto-terminado'] = 'completado';
          producedPieces['producto-terminado'] = 1;
        } else {
          areaStatus['producto-terminado'] = 'pendiente';
          producedPieces['producto-terminado'] = 0;
        }

        const allAreas = [...operativeAreas, 'producto-terminado'];
        const totalProgressSum = allAreas.reduce((sum, aid) => {
          const areaTarget = game.targetPieces?.[aid] || 1;
          const areaProd = producedPieces[aid] || 0;
          return sum + (areaProd / areaTarget) * 100;
        }, 0);

        const progress = Math.round(totalProgressSum / allAreas.length);
        const status = progress === 100 ? 'completado' : 'progreso';

        await updateDoc(doc(db, 'juegos', game.id), {
          producedPieces,
          areaStatus,
          progress,
          status,
          // Se sella una sola vez, en el momento REAL en que el área cruza su meta —
          // si luego se corrigen cantidades, esta fecha ya no se vuelve a tocar (ver
          // startAreaWork abajo para el "banderazo" de inicio, su contraparte).
          ...(newProduced >= targetLimit && !game.areaCompletedAt?.[areaId]
            ? { [`areaCompletedAt.${areaId}`]: new Date().toISOString() }
            : {}),
        });

        const project = proyectos.find((p) => p.id === game.projectId);
        if (project) {
          const projectGames = juegos
            .map((jg) => jg.id === game.id ? { ...jg, progress } : jg)
            .filter((jg) => jg.projectId === project.id);

          if (projectGames.length > 0) {
            const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
            const projProgress = Math.round(sumGamePct / projectGames.length);
            const projStatus = projProgress === 100 ? 'completado' : project.status;

            await updateDoc(doc(db, 'proyectos', project.id), {
              progress: projProgress,
              status: projStatus,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error al registrar log de producción en Firestore:', error);
      return { ok: false, error: error.message };
    }

    // El registro ya quedó guardado a partir de aquí; si falla (o tarda demasiado) la
    // subida de la foto, el registro no se pierde — solo se avisa que falta la evidencia.
    // Se corre con un límite de tiempo porque, sin conexión, Firebase Storage puede
    // seguir reintentando por más de un minuto antes de darse por vencido, y no tiene
    // sentido dejar a la persona esperando ese rato si el registro ya se guardó.
    if (photos && photos.length > 0) {
      // uploadTask nunca rechaza (atrapa su propio error) para que Promise.race dentro
      // de withTimeout jamás lance una excepción sin capturar.
      const uploadTask = uploadEvidencePhotos(logId, photos)
        .then(async (uploadedPhotos) => {
          await updateDoc(doc(db, 'historial_produccion', logId), { photos: uploadedPhotos });
          return { ok: true };
        })
        .catch((error) => {
          console.error('Error al subir evidencia fotográfica (el registro ya se guardó):', error);
          return { ok: false, error: error.message };
        });

      const result = await withTimeout(uploadTask, 8000);

      if (result.timedOut) {
        // No se espera más: la subida sigue en curso en segundo plano (o eventualmente
        // fallará), pero ya no bloquea a la persona. uploadTask ya atrapa su propio
        // error, así que no hace falta ningún manejo adicional aquí.
        return {
          ok: true,
          photoWarning: 'El registro se guardó. La evidencia fotográfica está tardando en subir (posible falla de conexión) y sigue intentándose en segundo plano; si no aparece, agrégala después editando el registro.',
        };
      }

      if (!result.ok) {
        return {
          ok: true,
          photoWarning: 'El registro se guardó, pero la evidencia fotográfica no se pudo subir (revisa tu conexión). Puedes agregarla después editando el registro.',
        };
      }
    }

    return { ok: true };
  }, [juegos, proyectos, user]);

  /**
   * Marca el "banderazo inicial": el momento real en que un área empieza a trabajar en
   * un juego, INDEPENDIENTE de cuándo se registre la primera pieza (un área puede
   * preparar máquina/material antes de entregar algo) — sin esto no había forma de medir
   * cuánto tarda un área en producir su parte, ya que `areaStatus` solo se derivaba de
   * `producedPieces > 0`. Se guarda una sola vez por área; no se puede repetir ni
   * corregir desde aquí. Respeta la misma dependencia de secuencia que ya bloquea el
   * registro de piezas (ej. Herrería no puede iniciar hasta que Corte Láser complete).
   */
  const startAreaWork = useCallback(async (gameId, areaId) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const game = juegos.find((j) => j.id === gameId);
    if (!game) return { ok: false, error: 'Juego no encontrado' };
    if (game.areaKickoff?.[areaId]) {
      return { ok: false, error: 'Ya se registró el inicio de esta área.' };
    }
    if (isAreaBlockedBySequence(game, areaId)) {
      return { ok: false, error: 'Esta área todavía no puede iniciar (depende de que otra área termine primero).' };
    }
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`areaKickoff.${areaId}`]: { startedAt: new Date().toISOString(), startedBy: user?.name || 'Usuario' },
      });
      logAudit({ user, module: 'produccion', action: 'Inició trabajo en un área', details: `${game.name} (${areaId})` });
      return { ok: true };
    } catch (error) {
      console.error('Error al marcar inicio de trabajo en área:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Agrega una tarima de producto terminado
   */
  const addTarima = useCallback(async (tarimaData) => {
    if (!db) return;
    const id = `TAR-${Date.now()}`;
    const created = {
      id,
      status: 'preparada',
      ...tarimaData,
    };
    try {
      await setDoc(doc(db, 'tarimas', id), created);
      logAudit({ user, module: 'produccion', action: 'Creó una tarima', details: id });
    } catch (error) {
      console.error('Error al guardar tarima en Firestore:', error);
    }
  }, [user]);

  /**
   * Elimina una tarima consolidada. Antes de borrarla, revierte las piezas que se habían
   * marcado como "entarimadas" (palletizedPieces) al crearla — de lo contrario esas
   * piezas quedarían descontadas para siempre sin que ninguna tarima las representara,
   * sin poder volver a asignarse a una tarima nueva.
   */
  const deleteTarima = useCallback(async (tarimaId) => {
    if (!db) return;
    try {
      const tarimaRef = doc(db, 'tarimas', tarimaId);
      const tarimaSnap = await getDoc(tarimaRef);
      if (tarimaSnap.exists()) {
        const tarimaData = tarimaSnap.data();
        // Las tarimas creadas antes de este fix no guardan areaId por ítem — esas no se
        // pueden revertir automáticamente (no hay forma de saber a qué área descontar),
        // se ignoran en vez de fallar.
        const gameItems = (tarimaData.items || []).filter(
          (item) => item.type === 'juego' && item.gameId && item.areaId
        );
        for (const item of gameItems) {
          const j = juegos.find((jg) => jg.id === item.gameId);
          if (!j) continue;
          const currentPalletized = j.palletizedPieces?.[item.areaId] || 0;
          const nextQty = Math.max(0, currentPalletized - (Number(item.quantity) || 0));
          await updateDoc(doc(db, 'juegos', item.gameId), {
            [`palletizedPieces.${item.areaId}`]: nextQty,
          });
        }
      }
      await deleteDoc(tarimaRef);
      logAudit({ user, module: 'produccion', action: 'Eliminó una tarima', details: tarimaId });
    } catch (error) {
      console.error('Error al eliminar tarima de Firestore:', error);
    }
  }, [user, juegos]);

  /**
   * Agrega un nuevo envío programado
   */
  const addEnvio = useCallback(async (envioData) => {
    if (!db) return;
    const id = `ENV-${Date.now()}`;
    const created = {
      id,
      status: 'programado',
      ...envioData,
    };
    try {
      await setDoc(doc(db, 'envios', id), created);

      if (envioData.items) {
        const tarimaIds = envioData.items.filter((item) => item.type === 'tarima').map((item) => item.id);
        for (const tId of tarimaIds) {
          await updateDoc(doc(db, 'tarimas', tId), { status: 'cargada' });
        }
      }
      logAudit({ user, module: 'produccion', action: 'Programó un envío', details: id });
    } catch (error) {
      console.error('Error al registrar envío en Firestore:', error);
    }
  }, [user]);

  const editEnvio = useCallback(async (envioId, envioData) => {
    if (!db) return;
    try {
      const envioRef = doc(db, 'envios', envioId);
      const envioSnap = await getDoc(envioRef);
      if (envioSnap.exists()) {
        const oldEnvio = envioSnap.data();
        const oldTarimaIds = oldEnvio.items?.filter(i => i.type === 'tarima').map(i => i.id) || [];
        const newTarimaIds = envioData.items?.filter(i => i.type === 'tarima').map(i => i.id) || [];
        
        const removedTarimaIds = oldTarimaIds.filter(id => !newTarimaIds.includes(id));
        for (const tId of removedTarimaIds) {
          await updateDoc(doc(db, 'tarimas', tId), { status: 'preparada' });
        }
        
        for (const tId of newTarimaIds) {
          await updateDoc(doc(db, 'tarimas', tId), { status: 'cargada' });
        }
      }

      await updateDoc(envioRef, envioData);
      logAudit({ user, module: 'produccion', action: 'Editó un envío', details: envioId });
    } catch (error) {
      console.error('Error al editar envío en Firestore:', error);
    }
  }, [user]);

  /**
   * Actualiza el estatus de un envío (despachado, completado, etc.)
   */
  const updateEnvioStatus = useCallback(async (envioId, status) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'envios', envioId), { status });
      logAudit({ user, module: 'produccion', action: 'Actualizó estado de envío', details: `${envioId} -> ${status}` });
    } catch (error) {
      console.error('Error al actualizar estado del envío en Firestore:', error);
    }
  }, [user]);

  /**
   * Elimina un envío programado
   */
  const deleteEnvio = useCallback(async (envioId) => {
    if (!db) return;
    try {
      const envioRef = doc(db, 'envios', envioId);
      const envioSnap = await getDoc(envioRef);
      if (envioSnap.exists()) {
        const envioData = envioSnap.data();
        if (envioData.items) {
          const tarimaIds = envioData.items.filter((item) => item.type === 'tarima').map((item) => item.id);
          for (const tId of tarimaIds) {
            await updateDoc(doc(db, 'tarimas', tId), { status: 'preparada' });
          }
        }
      }
      await deleteDoc(envioRef);
      logAudit({ user, module: 'produccion', action: 'Eliminó un envío', details: envioId });
    } catch (error) {
      console.error('Error al eliminar envío de Firestore:', error);
    }
  }, [user]);

  /**
   * Elimina un proyecto si no tiene avance registrado y sus juegos tampoco tienen avance
   */
  const deleteProject = useCallback(async (projectId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const project = proyectos.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'Proyecto no encontrado' };

    if (project.progress > 0) {
      return { ok: false, error: 'No se puede eliminar un proyecto con avance registrado.' };
    }

    const projectGames = juegos.filter((g) => g.projectId === projectId);
    const hasActiveGames = projectGames.some((g) => g.progress > 0);
    if (hasActiveGames) {
      return { ok: false, error: 'No se puede eliminar el proyecto porque contiene juegos con avance registrado.' };
    }

    try {
      // Eliminar juegos asociados (que tienen 0% avance)
      const batchPromises = projectGames.map((g) => deleteDoc(doc(db, 'juegos', g.id)));
      await Promise.all(batchPromises);

      // Eliminar el proyecto
      await deleteDoc(doc(db, 'proyectos', projectId));
      logAudit({ user, module: 'produccion', action: 'Eliminó un proyecto', details: project.name || projectId });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar proyecto de Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [proyectos, juegos, user]);

  /**
   * Elimina un juego si no tiene avance registrado
   */
  const deleteGame = useCallback(async (gameId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const game = juegos.find((g) => g.id === gameId);
    if (!game) return { ok: false, error: 'Juego no encontrado' };

    if (game.progress > 0) {
      return { ok: false, error: 'No se puede eliminar un juego con avance registrado.' };
    }

    try {
      await deleteDoc(doc(db, 'juegos', gameId));
      logAudit({ user, module: 'produccion', action: 'Eliminó un juego', details: game.name || gameId });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar juego de Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Recalcula el progreso y estado de un juego y su proyecto en base al historial de producción
   */
  const recalculateGameProgress = useCallback(async (gameName) => {
    if (!db) return;
    try {
      const gameRef = juegos.find((j) => j.name === gameName);
      if (!gameRef) return;

      const gameSnap = await getDoc(doc(db, 'juegos', gameRef.id));
      if (!gameSnap.exists()) return;
      const game = gameSnap.data();

      const logsQuery = query(collection(db, 'historial_produccion'), where('gameName', '==', gameName));
      const logsSnapshot = await getDocs(logsQuery);
      const logs = [];
      logsSnapshot.forEach((docSnap) => {
        logs.push(docSnap.data());
      });

      const producedPieces = { ...game.producedPieces };
      game.areas.forEach((areaId) => {
        producedPieces[areaId] = 0;
      });

      logs.forEach((log) => {
        const areaId = log.areaId;
        if (game.areas.includes(areaId)) {
          const qty = Number(log.quantity) || 0;
          producedPieces[areaId] += qty;
        }
      });

      const areaStatus = { ...game.areaStatus };
      game.areas.forEach((areaId) => {
        const target = game.targetPieces?.[areaId] || 10;
        producedPieces[areaId] = Math.min(target, producedPieces[areaId]);

        if (producedPieces[areaId] >= target) {
          areaStatus[areaId] = 'completado';
        } else if (producedPieces[areaId] > 0) {
          areaStatus[areaId] = 'proceso';
        } else {
          areaStatus[areaId] = 'pendiente';
        }
      });

      const operativeAreas = game.areas;
      const allOperativeReceived = operativeAreas.every(
        (aid) => game.areaDeliveryStatus?.[aid] === 'recibido_pt'
      );

      if (allOperativeReceived && allExternalOrdersReceived(game) && isLedWorkComplete(game)) {
        areaStatus['producto-terminado'] = 'completado';
        producedPieces['producto-terminado'] = 1;
      } else {
        areaStatus['producto-terminado'] = 'pendiente';
        producedPieces['producto-terminado'] = 0;
      }

      const allAreas = [...operativeAreas, 'producto-terminado'];
      const totalProgressSum = allAreas.reduce((sum, aid) => {
        const areaTarget = game.targetPieces?.[aid] || 1;
        const areaProd = producedPieces[aid] || 0;
        return sum + (areaProd / areaTarget) * 100;
      }, 0);

      const progress = Math.round(totalProgressSum / allAreas.length);
      const status = progress === 100 ? 'completado' : 'progreso';

      await updateDoc(doc(db, 'juegos', game.id), {
        producedPieces,
        areaStatus,
        progress,
        status,
      });

      const projectSnap = await getDoc(doc(db, 'proyectos', game.projectId));
      if (projectSnap.exists()) {
        const project = projectSnap.data();
        
        const gamesQuery = query(collection(db, 'juegos'), where('projectId', '==', game.projectId));
        const gamesSnapshot = await getDocs(gamesQuery);
        const projectGames = [];
        gamesSnapshot.forEach((docSnap) => {
          const gData = docSnap.data();
          if (gData.id === game.id) {
            projectGames.push({ ...gData, progress });
          } else {
            projectGames.push(gData);
          }
        });

        if (projectGames.length > 0) {
          const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
          const projProgress = Math.round(sumGamePct / projectGames.length);
          const projStatus = projProgress === 100 ? 'completado' : project.status;
          await updateDoc(doc(db, 'proyectos', project.id), {
            progress: projProgress,
            status: projStatus,
          });
        }
      }
    } catch (error) {
      console.error('Error al recalcular progresos del juego:', error);
    }
  }, [juegos, proyectos]);

  /**
   * Modifica un registro del historial de producción y actualiza progresos
   */
  const editProductionLog = useCallback(async (logId, updatedFields) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const logRef = doc(db, 'historial_produccion', logId);
      const logSnap = await getDoc(logRef);
      if (!logSnap.exists()) return { ok: false, error: 'Registro no encontrado' };
      const logData = logSnap.data();

      await updateDoc(logRef, updatedFields);
      await recalculateGameProgress(logData.gameName);
      logAudit({ user, module: 'produccion', action: 'Editó un registro de producción', details: `${logData.gameName} en ${logData.areaId}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al editar registro de producción:', error);
      return { ok: false, error: error.message };
    }
  }, [recalculateGameProgress, user]);

  /**
   * Elimina un registro del historial de producción y actualiza progresos
   */
  const deleteProductionLog = useCallback(async (logId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const logRef = doc(db, 'historial_produccion', logId);
      const logSnap = await getDoc(logRef);
      if (!logSnap.exists()) return { ok: false, error: 'Registro no encontrado' };
      const logData = logSnap.data();

      if (logData.photos?.length) {
        await deleteEvidencePhotos(logData.photos);
      }

      await deleteDoc(logRef);
      await recalculateGameProgress(logData.gameName);
      logAudit({ user, module: 'produccion', action: 'Eliminó un registro de producción', details: `${logData.gameName} en ${logData.areaId}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar registro de producción:', error);
      return { ok: false, error: error.message };
    }
  }, [recalculateGameProgress, user]);

  /**
   * Sube y agrega nuevas fotos de evidencia a un registro de producción ya existente
   */
  const addEvidenceToLog = useCallback(async (logId, files) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const logRef = doc(db, 'historial_produccion', logId);
      const logSnap = await getDoc(logRef);
      if (!logSnap.exists()) return { ok: false, error: 'Registro no encontrado' };

      const existingPhotos = logSnap.data().photos || [];
      const uploaded = await uploadEvidencePhotos(logId, files);
      const photos = [...existingPhotos, ...uploaded];

      await updateDoc(logRef, { photos });
      logAudit({ user, module: 'produccion', action: 'Agregó evidencia fotográfica a un registro', details: logId });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al subir evidencia fotográfica:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Quita una foto de evidencia de un registro de producción (borra el archivo de
   * Storage y actualiza el arreglo en Firestore)
   */
  const removeEvidenceFromLog = useCallback(async (logId, photoPath) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const logRef = doc(db, 'historial_produccion', logId);
      const logSnap = await getDoc(logRef);
      if (!logSnap.exists()) return { ok: false, error: 'Registro no encontrado' };

      const existingPhotos = logSnap.data().photos || [];
      const target = existingPhotos.find((p) => p.path === photoPath);
      const photos = existingPhotos.filter((p) => p.path !== photoPath);

      await updateDoc(logRef, { photos });
      if (target) await deleteEvidencePhotos([target]);
      logAudit({ user, module: 'produccion', action: 'Quitó evidencia fotográfica de un registro', details: logId });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al quitar evidencia fotográfica:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Registra piezas como entarimadas
   */
  const palletizePieces = useCallback(async (gameId, areaPieces) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const nextPalletized = { ...j.palletizedPieces };
    Object.entries(areaPieces).forEach(([areaId, qty]) => {
      nextPalletized[areaId] = (nextPalletized[areaId] || 0) + qty;
    });
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        palletizedPieces: nextPalletized,
      });
      logAudit({ user, module: 'produccion', action: 'Registró piezas entarimadas', details: j.name || gameId });
    } catch (error) {
      console.error('Error al actualizar piezas entarimadas en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Notifica a Producto Terminado que un área completó sus piezas
   */
  const notifyAreaDelivery = useCallback(async (gameId, areaId) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`areaDeliveryStatus.${areaId}`]: 'notificado_pt',
      });
      logAudit({ user, module: 'produccion', action: 'Notificó entrega de área a Producto Terminado', details: `${areaId} (juego ${gameId})` });
    } catch (error) {
      console.error('Error al notificar entrega de área en Firestore:', error);
    }
  }, [user]);

  /**
   * Actualiza la lista de verificación (checklist) del juego
   */
  const updateGameChecklist = useCallback(async (gameId, checklist) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'juegos', gameId), { checklist });
      logAudit({ user, module: 'produccion', action: 'Actualizó el checklist de un juego', details: gameId });
    } catch (error) {
      console.error('Error al actualizar checklist del juego en Firestore:', error);
    }
  }, [user]);

  /**
   * PT recibe y verifica la entrega de un área
   */
  const receiveAreaDelivery = useCallback(async (gameId, areaId) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;

    const nextDeliveryStatus = {
      ...j.areaDeliveryStatus,
      [areaId]: 'recibido_pt',
    };

    const operativeAreas = j.areas;
    // Ver recalculatePTStatus: las áreas alimentadoras (Corte Láser → Herrería) no
    // entregan directo a PT, así que no se exigen en 'recibido_pt'.
    const terminalAreas = operativeAreas.filter((aid) => !getFeederDependentAreaId(j, aid));
    const allOperativeReceived = terminalAreas.every(
      (aid) => nextDeliveryStatus[aid] === 'recibido_pt'
    );

    const areaStatus = { ...j.areaStatus };
    const producedPieces = { ...j.producedPieces };

    if (allOperativeReceived && allExternalOrdersReceived(j) && isLedWorkComplete(j)) {
      areaStatus['producto-terminado'] = 'completado';
      producedPieces['producto-terminado'] = 1;
      nextDeliveryStatus['producto-terminado'] = 'recibido_pt';
    } else {
      areaStatus['producto-terminado'] = 'pendiente';
      producedPieces['producto-terminado'] = 0;
      nextDeliveryStatus['producto-terminado'] = 'pendiente';
    }

    const allAreasList = [...operativeAreas, 'producto-terminado'];
    const totalProgressSum = allAreasList.reduce((sum, aid) => {
      const areaTarget = j.targetPieces?.[aid] || 1;
      const areaProd = producedPieces[aid] || 0;
      return sum + (areaProd / areaTarget) * 100;
    }, 0);

    const progress = Math.round(totalProgressSum / allAreasList.length);
    const status = progress === 100 ? 'completado' : 'progreso';

    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        areaDeliveryStatus: nextDeliveryStatus,
        areaStatus,
        producedPieces,
        progress,
        status,
      });

      const project = proyectos.find((p) => p.id === j.projectId);
      if (project) {
        const projectGames = juegos
          .map((jg) => jg.id === gameId ? { ...jg, progress } : jg)
          .filter((jg) => jg.projectId === project.id);

        if (projectGames.length > 0) {
          const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
          const projProgress = Math.round(sumGamePct / projectGames.length);
          const projStatus = projProgress === 100 ? 'completado' : project.status;

          await updateDoc(doc(db, 'proyectos', project.id), {
            progress: projProgress,
            status: projStatus,
          });
        }
      }
      logAudit({ user, module: 'produccion', action: 'Recibió entrega de área en Producto Terminado', details: `${areaId} (${j.name})` });
    } catch (error) {
      console.error('Error al recibir entrega en Firestore:', error);
    }
  }, [juegos, proyectos, user]);

  /**
   * Sube y agrega evidencia fotográfica de lo recibido por Producto Terminado en la
   * entrega de un área (independiente de `receiveAreaDelivery`, para poder adjuntarla
   * antes o después de confirmar la recepción)
   */
  const addReceptionEvidence = useCallback(async (gameId, areaId, files) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return { ok: false, error: 'Juego no encontrado' };
    try {
      const existingPhotos = j.receptionEvidence?.[areaId] || [];
      const uploaded = await uploadReceptionEvidencePhotos(gameId, areaId, files);
      const photos = [...existingPhotos, ...uploaded];
      await updateDoc(doc(db, 'juegos', gameId), {
        [`receptionEvidence.${areaId}`]: photos,
      });
      logAudit({ user, module: 'produccion', action: 'Agregó evidencia fotográfica de recepción en PT', details: `${j.name} (${areaId})` });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al subir evidencia fotográfica de recepción:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Quita una foto de evidencia de recepción de PT (borra también el archivo en Storage)
   */
  const removeReceptionEvidence = useCallback(async (gameId, areaId, photoPath) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return { ok: false, error: 'Juego no encontrado' };
    try {
      const existingPhotos = j.receptionEvidence?.[areaId] || [];
      const target = existingPhotos.find((p) => p.path === photoPath);
      const photos = existingPhotos.filter((p) => p.path !== photoPath);
      await updateDoc(doc(db, 'juegos', gameId), {
        [`receptionEvidence.${areaId}`]: photos,
      });
      if (target) await deleteEvidencePhotos([target]);
      logAudit({ user, module: 'produccion', action: 'Quitó evidencia fotográfica de recepción en PT', details: `${j.name} (${areaId})` });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al quitar evidencia fotográfica de recepción:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Control de defectos activos por área
   */
  const updateGameQualityDefect = useCallback(async (gameName, areaId, hasDefect) => {
    if (!db) return;
    const game = juegos.find((j) => j.name === gameName);
    if (!game) return;
    try {
      await updateDoc(doc(db, 'juegos', game.id), {
        [`activeDefects.${areaId}`]: hasDefect,
      });
    } catch (error) {
      console.error('Error al actualizar defecto activo en Firestore:', error);
    }
  }, [juegos]);

  /**
   * Recalcula el estado del defecto activo basado en la última inspección de calidad
   */
  const updateGameQualityDefectFromHistory = useCallback(async (gameName, areaId) => {
    if (!db) return;
    try {
      const q = query(
        collection(db, 'inspecciones'),
        where('gameName', '==', gameName),
        where('areaId', '==', areaId)
      );
      const snapshot = await getDocs(q);
      const inspections = [];
      snapshot.forEach((d) => inspections.push({ ...d.data(), id: d.id }));
      
      // Ordenar por fecha descendente
      inspections.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      const latest = inspections[0];
      const hasDefect = latest ? latest.status === 'defectuoso' : false;
      
      const game = juegos.find((j) => j.name === gameName);
      if (game) {
        await updateDoc(doc(db, 'juegos', game.id), {
          [`activeDefects.${areaId}`]: hasDefect,
        });
      }
    } catch (error) {
      console.error('Error al actualizar defecto activo desde el historial:', error);
    }
  }, [juegos]);

  /**
   * Agrega orden externa a proveedor
   */
  const addExternalOrder = useCallback(async (gameId, orderData) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const nextOrders = j.externalOrders || [];
    const created = {
      id: `OT-${String(nextOrders.length + 1).padStart(3, '0')}`,
      status: 'pendiente',
      orderedDate: new Date().toISOString(),
      receivedDate: null,
      receivedBy: null,
      ...orderData,
    };
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        externalOrders: [created, ...nextOrders],
      });
      logAudit({ user, module: 'produccion', action: 'Agregó orden externa a proveedor', details: `${j.name}: ${created.id}` });
    } catch (error) {
      console.error('Error al agregar orden de trabajo externa en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Recibe orden externa de proveedor
   */
  const receiveExternalOrder = useCallback(async (gameId, orderId, receivedBy) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;

    const nextOrders = (j.externalOrders || []).map((o) =>
      o.id === orderId
        ? { ...o, status: 'recibido', receivedBy, receivedDate: new Date().toISOString() }
        : o
    );
    const updatedGame = { ...j, externalOrders: nextOrders };
    const { areaStatus, producedPieces, progress, status } = recalculatePTStatus(updatedGame);

    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        externalOrders: nextOrders,
        areaStatus,
        producedPieces,
        progress,
        status,
      });

      const project = proyectos.find((p) => p.id === j.projectId);
      if (project) {
        const projectGames = juegos
          .map((jg) => jg.id === gameId ? { ...jg, progress } : jg)
          .filter((jg) => jg.projectId === project.id);

        if (projectGames.length > 0) {
          const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
          const projProgress = Math.round(sumGamePct / projectGames.length);
          const projStatus = projProgress === 100 ? 'completado' : project.status;

          await updateDoc(doc(db, 'proyectos', project.id), {
            progress: projProgress,
            status: projStatus,
          });
        }
      }
      logAudit({ user, module: 'produccion', action: 'Recibió orden externa de proveedor', details: `${j.name}: ${orderId} (recibido por ${receivedBy})` });
    } catch (error) {
      console.error('Error al registrar recepción de orden externa en Firestore:', error);
    }
  }, [juegos, proyectos, user]);

  /**
   * Habilita trabajos LED
   */
  const enableLedWork = useCallback(async (gameId) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        ledWork: {
          required: true,
          steps: {
            instalacionLed: false,
            tableroElectrico: false,
            revisionFuncionamiento: false,
          },
        },
      });
      logAudit({ user, module: 'produccion', action: 'Habilitó trabajo LED', details: gameId });
    } catch (error) {
      console.error('Error al habilitar trabajo LED en Firestore:', error);
    }
  }, [user]);

  /**
   * Actualiza el paso del trabajo LED
   */
  const updateLedStep = useCallback(async (gameId, stepKey, value) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j || !j.ledWork?.required) return { ok: false, error: 'Juego o trabajo LED no encontrado' };

    if (value && !hasReceivedExternalPieces(j)) {
      const hasAnyOrder = (j.externalOrders || []).length > 0;
      return {
        ok: false,
        error: hasAnyOrder
          ? 'No puedes completar el trabajo LED: aún hay piezas externas pendientes de recibir.'
          : 'No puedes completar el trabajo LED: este juego no tiene ninguna pieza externa registrada ni recibida todavía.',
      };
    }

    const updatedGame = {
      ...j,
      ledWork: { ...j.ledWork, steps: { ...j.ledWork.steps, [stepKey]: value } },
    };
    const { areaStatus, producedPieces, progress, status } = recalculatePTStatus(updatedGame);

    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        ledWork: updatedGame.ledWork,
        areaStatus,
        producedPieces,
        progress,
        status,
      });

      const project = proyectos.find((p) => p.id === j.projectId);
      if (project) {
        const projectGames = juegos
          .map((jg) => jg.id === gameId ? { ...jg, progress } : jg)
          .filter((jg) => jg.projectId === project.id);

        if (projectGames.length > 0) {
          const sumGamePct = projectGames.reduce((sum, jg) => sum + jg.progress, 0);
          const projProgress = Math.round(sumGamePct / projectGames.length);
          const projStatus = projProgress === 100 ? 'completado' : project.status;

          await updateDoc(doc(db, 'proyectos', project.id), {
            progress: projProgress,
            status: projStatus,
          });
        }
      }
      logAudit({ user, module: 'produccion', action: 'Actualizó un paso del trabajo LED', details: `${j.name}: ${stepKey} = ${value}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar paso LED en Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, proyectos, user]);

  /**
   * Obtiene la revisión de Calidad local
   */
  function getAreaReview(game, areaId) {
    return game.qualityReview?.[areaId] || {
      checklist: [],
      status: 'pendiente',
      reviewedBy: null,
      reviewedAt: null,
      notes: '',
    };
  }

  /**
   * Agrega punto a la revisión de calidad
   */
  const addQualityChecklistItem = useCallback(async (gameId, areaId, text) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const review = getAreaReview(j, areaId);
    const newItem = { id: `qc-${Date.now()}`, text, checked: false };
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          checklist: [...review.checklist, newItem],
          status: 'pendiente',
        },
      });
      logAudit({ user, module: 'produccion', action: 'Agregó punto de revisión de calidad', details: `${j.name} (${areaId}): "${text}"` });
    } catch (error) {
      console.error('Error al agregar item de checklist en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Quita un punto de la revisión de calidad
   */
  const removeQualityChecklistItem = useCallback(async (gameId, areaId, itemId) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const review = getAreaReview(j, areaId);
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          checklist: review.checklist.filter((it) => it.id !== itemId),
        },
      });
      logAudit({ user, module: 'produccion', action: 'Quitó punto de revisión de calidad', details: `${j.name} (${areaId})` });
    } catch (error) {
      console.error('Error al remover item de checklist en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Marca/desmarca un punto de calidad
   */
  const toggleQualityChecklistItem = useCallback(async (gameId, areaId, itemId) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const review = getAreaReview(j, areaId);
    const nextChecklist = review.checklist.map((it) =>
      it.id === itemId ? { ...it, checked: !it.checked } : it
    );
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          checklist: nextChecklist,
        },
      });
      logAudit({ user, module: 'produccion', action: 'Marcó/desmarcó punto de revisión de calidad', details: `${j.name} (${areaId})` });
    } catch (error) {
      console.error('Error al marcar item de checklist en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Aprueba la revisión de calidad del área
   */
  const approveQualityReview = useCallback(async (gameId, areaId, reviewerName, notes) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return { ok: false, error: 'Juego no encontrado' };

    const review = getAreaReview(j, areaId);
    if (review.checklist.length === 0) {
      return { ok: false, error: 'Agrega al menos un punto al checklist antes de aprobar.' };
    }
    if (!review.checklist.every((it) => it.checked)) {
      return { ok: false, error: 'Todos los puntos del checklist deben estar marcados antes de aprobar.' };
    }
    const produced = j.producedPieces?.[areaId] || 0;
    const target = j.targetPieces?.[areaId] || 1;
    if (produced < target) {
      return { ok: false, error: 'El área todavía no llega al 100% de piezas; no se puede aprobar la entrega todavía.' };
    }

    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          status: 'aprobado',
          reviewedBy: reviewerName,
          reviewedAt: new Date().toISOString(),
          notes: notes || '',
        },
      });
      logAudit({ user, module: 'produccion', action: 'Aprobó revisión de calidad', details: `${j.name} (${areaId}) por ${reviewerName}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al aprobar revisión en Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Rechaza la revisión de calidad del área
   */
  const rejectQualityReview = useCallback(async (gameId, areaId, reviewerName, notes) => {
    if (!db) return;
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return;
    const review = getAreaReview(j, areaId);
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          status: 'rechazado',
          reviewedBy: reviewerName,
          reviewedAt: new Date().toISOString(),
          notes: notes || '',
        },
      });
      logAudit({ user, module: 'produccion', action: 'Rechazó revisión de calidad', details: `${j.name} (${areaId}) por ${reviewerName}` });
    } catch (error) {
      console.error('Error al rechazar revisión en Firestore:', error);
    }
  }, [juegos, user]);

  /**
   * Calidad da el visto bueno final, como testigo, para que Producto Terminado pueda
   * recibir físicamente una entrega ya notificada — aprobación adicional a la que ya se
   * dio antes de notificar (qualityReview), sin checklist ni motivo, solo confirma "todo
   * está correcto para recibir".
   */
  const approveReceptionForPT = useCallback(async (gameId, areaId, reviewerName, reviewerRole) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return { ok: false, error: 'Juego no encontrado' };
    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`receptionApproval.${areaId}`]: {
          approvedBy: reviewerName,
          approvedByRole: reviewerRole,
          approvedAt: new Date().toISOString(),
        },
      });
      logAudit({ user, module: 'produccion', action: 'Aprobó la recepción en Producto Terminado', details: `${j.name} (${areaId}) por ${reviewerName}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al aprobar recepción en Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  /**
   * Producto Terminado regresa una entrega YA notificada (o ya recibida por error) al
   * área de origen para que la retrabaje: revierte `areaDeliveryStatus` a 'pendiente' (sale
   * de la cola de PT) y marca la revisión de Calidad como 'rechazado' con el motivo, para
   * que el área vea por qué se regresó y deba solicitar una nueva revisión antes de poder
   * volver a notificar.
   */
  const returnDeliveryForReview = useCallback(async (gameId, areaId, reviewerName, notes) => {
    if (!db) return { ok: false, error: 'Firestore no está inicializado' };
    if (!notes?.trim()) return { ok: false, error: 'Indica el motivo por el que se regresa al área.' };
    const j = juegos.find((jg) => jg.id === gameId);
    if (!j) return { ok: false, error: 'Juego no encontrado' };
    const review = getAreaReview(j, areaId);

    try {
      await updateDoc(doc(db, 'juegos', gameId), {
        [`qualityReview.${areaId}`]: {
          ...review,
          status: 'rechazado',
          reviewedBy: reviewerName,
          reviewedAt: new Date().toISOString(),
          notes: notes.trim(),
        },
        [`areaDeliveryStatus.${areaId}`]: 'pendiente',
        // Se limpia el visto bueno de recepción: si se vuelve a notificar tras corregir,
        // Calidad debe volver a aprobarla, no debe quedar aprobada de la ronda anterior.
        [`receptionApproval.${areaId}`]: null,
      });
      logAudit({ user, module: 'produccion', action: 'Regresó entrega a revisión del área', details: `${j.name} (${areaId}) por ${reviewerName}: ${notes.trim()}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al regresar entrega a revisión en Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [juegos, user]);

  // ============================================
  // PROVIDER VALUE
  // ============================================
  const value = useMemo(
    () => ({
      proyectos,
      juegos,
      historialProduccion,
      areaHistorial,
      subscribeAreaHistorial,
      addProject,
      updateProject,
      addGame,
      updateGameTargetPieces,
      updateGameName,
      deleteProject,
      deleteGame,
      registerProductionLog,
      startAreaWork,
      editProductionLog,
      deleteProductionLog,
      addEvidenceToLog,
      removeEvidenceFromLog,
      recalculateGameProgress,
      tarimas,
      envios,
      addTarima,
      deleteTarima,
      addEnvio,
      editEnvio,
      updateEnvioStatus,
      deleteEnvio,
      palletizePieces,
      notifyAreaDelivery,
      updateGameChecklist,
      receiveAreaDelivery,
      addReceptionEvidence,
      removeReceptionEvidence,
      updateGameQualityDefect,
      updateGameQualityDefectFromHistory,
      addExternalOrder,
      receiveExternalOrder,
      enableLedWork,
      updateLedStep,
      addQualityChecklistItem,
      removeQualityChecklistItem,
      toggleQualityChecklistItem,
      approveQualityReview,
      rejectQualityReview,
      approveReceptionForPT,
      returnDeliveryForReview,
    }),
    [
      proyectos,
      juegos,
      historialProduccion,
      areaHistorial,
      subscribeAreaHistorial,
      addProject,
      updateProject,
      addGame,
      updateGameTargetPieces,
      updateGameName,
      deleteProject,
      deleteGame,
      registerProductionLog,
      startAreaWork,
      editProductionLog,
      deleteProductionLog,
      addEvidenceToLog,
      removeEvidenceFromLog,
      recalculateGameProgress,
      tarimas,
      envios,
      addTarima,
      deleteTarima,
      addEnvio,
      editEnvio,
      updateEnvioStatus,
      deleteEnvio,
      palletizePieces,
      notifyAreaDelivery,
      updateGameChecklist,
      receiveAreaDelivery,
      addReceptionEvidence,
      removeReceptionEvidence,
      updateGameQualityDefect,
      updateGameQualityDefectFromHistory,
      addExternalOrder,
      receiveExternalOrder,
      enableLedWork,
      updateLedStep,
      addQualityChecklistItem,
      removeQualityChecklistItem,
      toggleQualityChecklistItem,
      approveQualityReview,
      rejectQualityReview,
      approveReceptionForPT,
      returnDeliveryForReview,
    ]
  );

  return <ProduccionContext.Provider value={value}>{children}</ProduccionContext.Provider>;
};

ProduccionProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
