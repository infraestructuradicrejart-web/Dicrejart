/**
 * @file LienzoSwitcherModal.jsx
 * @description Modal para listar, elegir y crear lienzos del Editor Visual. Antes solo
 * existía un lienzo compartido (`lienzos/general`), donde cualquier guardado de dos
 * usuarios al mismo tiempo puede sobreescribir al otro (autosave de todo el arreglo de
 * nodos/cables de un golpe). Este modal permite crear lienzos adicionales para trabajo
 * aislado (pruebas, un proyecto puntual) sin tocar el general. Componente "tonto": no
 * tiene suscripción propia a Firestore (recibe `lienzos` ya cargados del padre), salvo
 * por la escritura de creación.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { doc, collection, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import useAuth from '../../hooks/useAuth';
import useToast from '../../hooks/useToast';
import styles from './LienzoSwitcherModal.module.css';

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function} props.onClose
 * @param {Array<{id:string, name?:string, updatedAt?:string, lastSavedBy?:string}>} props.lienzos
 * @param {string} props.lienzoActivoId
 * @param {function(string)} props.onNavigate - Recibe el id del lienzo elegido/creado
 */
const LienzoSwitcherModal = ({ isOpen, onClose, lienzos, lienzoActivoId, onNavigate }) => {
  const { user } = useAuth();
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const hasGeneralInList = lienzos.some((l) => l.id === 'general');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !db) return;
    setIsCreating(true);
    try {
      const newRef = doc(collection(db, 'lienzos'));
      const who = user?.name || user?.email || 'Usuario';
      await setDoc(newRef, {
        name: newName.trim(),
        nodes: [],
        edges: [],
        createdAt: new Date().toISOString(),
        createdBy: who,
        updatedAt: new Date().toISOString(),
        lastSavedBy: who,
      });
      setNewName('');
      onNavigate(newRef.id);
    } catch (error) {
      console.error('Error al crear lienzo:', error);
      toast.danger('No se pudo crear el lienzo. Intenta de nuevo.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🗂️ Lienzos de Trabajo">
      <p className={styles.intro}>
        El <strong>Lienzo General</strong> es el compartido de siempre. Crea uno nuevo cuando
        necesites un espacio aislado — pruebas, un proyecto puntual — sin arriesgar lo que
        alguien más esté editando en el general.
      </p>

      <div className={styles.list}>
        {!hasGeneralInList && (
          <button
            type="button"
            className={`${styles.row} ${lienzoActivoId === 'general' ? styles.active : ''}`}
            onClick={() => onNavigate('general')}
          >
            <span className={styles.rowName}>Lienzo General</span>
            <span className={styles.rowMeta}>El compartido de siempre</span>
          </button>
        )}

        {lienzos.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`${styles.row} ${l.id === lienzoActivoId ? styles.active : ''}`}
            onClick={() => onNavigate(l.id)}
          >
            <span className={styles.rowName}>
              {l.name || (l.id === 'general' ? 'Lienzo General' : l.id)}
              {l.id === lienzoActivoId && <span className={styles.activeTag}>Activo</span>}
            </span>
            {(l.lastSavedBy || l.updatedAt) && (
              <span className={styles.rowMeta}>
                {l.lastSavedBy ? `Últ. guardado por ${l.lastSavedBy}` : ''}
                {l.updatedAt ? ` · ${new Date(l.updatedAt).toLocaleString()}` : ''}
              </span>
            )}
          </button>
        ))}
      </div>

      <form className={styles.createForm} onSubmit={handleCreate}>
        <label className={styles.createLabel} htmlFor="new-lienzo-name">+ Crear Lienzo Nuevo</label>
        <div className={styles.createRow}>
          <input
            id="new-lienzo-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej. Prueba Ruta de Fabricación..."
            className={styles.createInput}
          />
          <Button type="submit" variant="primary" size="sm" isLoading={isCreating} isDisabled={!newName.trim()}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
};

LienzoSwitcherModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  lienzos: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    updatedAt: PropTypes.string,
    lastSavedBy: PropTypes.string,
  })).isRequired,
  lienzoActivoId: PropTypes.string.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

export default LienzoSwitcherModal;
