import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, limit } from 'firebase/firestore';
import { inventorDb } from '../config/firebase';

/**
 * Hook para obtener el catálogo de artículos desde la base de datos de Inventor Manager.
 * Mantiene la lista sincronizada en tiempo real.
 */
export const useInventoryAutocomplete = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!inventorDb) {
      setLoading(false);
      return;
    }
    
    // Traemos todo el catálogo de Inventor (o al menos un límite alto) para filtrar en el cliente
    // ya que Firestore no soporta búsquedas "LIKE %query%" eficientes de forma nativa.
    const q = query(collection(inventorDb, 'items'), limit(5000));
    
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setItems(list);
      setLoading(false);
    }, (error) => {
      console.error('Error al suscribirse al inventario cruzado:', error);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { items, loading };
};
