/**
 * @file AreasContext.jsx
 * @description Contexto global de las áreas de producción. Se conecta a Firestore y
 * permite a los administradores crear, editar y eliminar áreas de manera dinámica.
 * Inicializa las áreas con DEFAULT_AREAS si la colección está vacía.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { AuthContext } from './AuthContext';
import { logAudit } from '../utils/auditLog';
import { DEFAULT_AREAS, resolveAreaId as baseResolveAreaId } from '../data/areasConfig';
import useToast from '../hooks/useToast';

export const AreasContext = createContext(null);

export const AreasProvider = ({ children }) => {
  const [areas, setAreas] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useContext(AuthContext) || {};
  const toast = useToast();

  // Igual que el resto de los contextos de la app (ProduccionContext, ComprasContext,
  // etc.): este Provider envuelve toda la app, incluida /login, así que suscribirse a
  // Firestore de inmediato fallaría por falta de permisos antes del login — y sin
  // reintentarlo después, ya que un onSnapshot que truena por permiso queda "muerto"
  // (no se reactiva solo cuando el usuario inicia sesión más tarde). Se espera a
  // onAuthStateChanged y se (re)suscribe con cada cambio de sesión.
  useEffect(() => {
    if (!db || !auth) {
      setIsLoading(false);
      return;
    }

    let unsubSnapshot = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (unsubSnapshot) unsubSnapshot();

      if (!firebaseUser) {
        setAreas([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      unsubSnapshot = onSnapshot(collection(db, 'areas'), async (snap) => {
        if (snap.empty) {
          // Inicializar áreas por defecto usando writeBatch
          try {
            const batch = writeBatch(db);
            DEFAULT_AREAS.forEach((area) => {
              const areaRef = doc(db, 'areas', area.id);
              batch.set(areaRef, area);
            });
            await batch.commit();
            // onSnapshot se disparará nuevamente después del commit
          } catch (error) {
            console.error("Error al inicializar áreas por defecto:", error);
            setAreas(DEFAULT_AREAS); // Fallback local en caso de error
            setIsLoading(false);
          }
        } else {
          const loadedAreas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          // Opcional: ordenar las áreas alfabéticamente
          loadedAreas.sort((a, b) => a.name.localeCompare(b.name));
          setAreas(loadedAreas);
          setIsLoading(false);
        }
      }, (error) => {
        console.error("Error al escuchar áreas:", error);
        setAreas(DEFAULT_AREAS); // Fallback
        setIsLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, []);

  /**
   * Resuelve el ID del área usando el catálogo actual cargado
   */
  const resolveAreaId = useCallback((rawValue) => {
    return baseResolveAreaId(rawValue, areas);
  }, [areas]);

  /**
   * Agrega una nueva área (solo admin)
   * @param {Object} areaData { id, name }
   */
  const addArea = useCallback(async (areaData) => {
    if (!db || !user || user.roleType !== 'admin') {
      return { ok: false, error: 'Permisos insuficientes o base de datos no lista.' };
    }
    
    // Validar si el id ya existe
    if (areas.some(a => a.id === areaData.id)) {
      return { ok: false, error: 'El ID del área ya existe.' };
    }

    try {
      await setDoc(doc(db, 'areas', areaData.id), areaData);
      logAudit({ user, module: 'areas', action: 'Creó nueva área', details: `Área: ${areaData.name} (${areaData.id})` });
      return { ok: true };
    } catch (error) {
      console.error('Error al agregar área:', error);
      return { ok: false, error: error.message };
    }
  }, [user, areas]);

  /**
   * Actualiza el nombre de un área (solo admin).
   * El ID no se puede cambiar ya que está ligado a registros históricos.
   * @param {string} areaId 
   * @param {Object} areaData { name }
   */
  const updateArea = useCallback(async (areaId, areaData) => {
    if (!db || !user || user.roleType !== 'admin') {
      return { ok: false, error: 'Permisos insuficientes o base de datos no lista.' };
    }

    try {
      await setDoc(doc(db, 'areas', areaId), areaData, { merge: true });
      logAudit({ user, module: 'areas', action: 'Actualizó área', details: `Área ID: ${areaId}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar área:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Elimina un área (solo admin).
   * @param {string} areaId 
   */
  const deleteArea = useCallback(async (areaId) => {
    if (!db || !user || user.roleType !== 'admin') {
      return { ok: false, error: 'Permisos insuficientes o base de datos no lista.' };
    }

    try {
      await deleteDoc(doc(db, 'areas', areaId));
      logAudit({ user, module: 'areas', action: 'Eliminó área', details: `Área ID: ${areaId}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar área:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  const value = useMemo(
    () => ({ areas, isLoading, resolveAreaId, addArea, updateArea, deleteArea }),
    [areas, isLoading, resolveAreaId, addArea, updateArea, deleteArea]
  );

  return <AreasContext.Provider value={value}>{children}</AreasContext.Provider>;
};

AreasProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
