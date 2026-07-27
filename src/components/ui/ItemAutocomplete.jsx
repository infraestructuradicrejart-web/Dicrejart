import React, { useState, useEffect, useRef } from 'react';
import styles from './ItemAutocomplete.module.css';
import { useInventoryAutocomplete } from '../../hooks/useInventoryAutocomplete';

const ItemAutocomplete = ({ value, onChange, placeholder = 'Ej: Tornillo de expansión 1/2"' }) => {
  const { items, loading } = useInventoryAutocomplete();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value?.name || '');
  const containerRef = useRef(null);

  // Filtrar artículos que coincidan con la búsqueda
  const filteredItems = items
    .filter(it => it.name && it.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(0, 10); // Mostrar máximo 10 opciones

  // Determinar si el término actual ya existe exactamente en el inventario
  const exactMatch = items.find(it => it.name && it.name.toLowerCase() === searchTerm.toLowerCase().trim());

  useEffect(() => {
    setSearchTerm(value?.name || '');
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        // Si cierran sin seleccionar, volvemos al valor original o lo dejamos si es texto nuevo
        if (!exactMatch && searchTerm.trim() !== '') {
           onChange({ ...value, name: searchTerm.trim(), itemId: null });
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exactMatch, searchTerm, value, onChange]);

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
    onChange({ ...value, name: e.target.value, itemId: null }); // Se resetea el itemId al escribir
  };

  const handleSelect = (item) => {
    setSearchTerm(item.name);
    onChange({ ...value, name: item.name, itemId: item.id });
    setIsOpen(false);
  };

  const handleCreateNew = () => {
    onChange({ ...value, name: searchTerm.trim(), itemId: null });
    setIsOpen(false);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        type="text"
        className={styles.input}
        value={searchTerm}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        placeholder={loading ? 'Cargando inventario...' : placeholder}
        disabled={loading}
      />
      {isOpen && searchTerm.trim() !== '' && (
        <div className={styles.dropdown}>
          {filteredItems.map(item => (
            <div key={item.id} className={styles.option} onClick={() => handleSelect(item)}>
              <span className={styles.optionText}>🔧 {item.name}</span>
              {item.section && <span className={styles.optionSubtext}>{item.section}</span>}
            </div>
          ))}
          {!exactMatch && (
            <div className={`${styles.option} ${styles.createNew}`} onClick={handleCreateNew}>
              <span className={styles.optionText}>➕ Crear nuevo artículo: "{searchTerm}"</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ItemAutocomplete;
