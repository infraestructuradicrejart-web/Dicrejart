/**
 * @file DisenoPage.jsx
 * @description Sección de Diseño — placeholder. Diseño no es un área de manufactura (no
 * entra a la secuencia de producción ni al catálogo de las 8 áreas), por eso vive en su
 * propia sección en vez de dentro de Producción. Por ahora solo existe como destino para
 * las actividades del área "Diseño" que se crean desde los Bloques del Editor Visual;
 * la gestión real de colaboradores/actividades de esta área todavía no está construida.
 * @author Dicrejart Dev Team
 */

import React from 'react';
import { motion } from 'framer-motion';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';

const DisenoPage = () => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Diseño"
        subtitle="Área creativa de Dicrejart — no forma parte de la línea de manufactura."
        shape="picos"
        accentColor="var(--color-purple-x11)"
      />
      <EmptyState
        message="🚧 Sección en construcción. Por ahora, las actividades de Diseño se crean desde los Bloques del Editor Visual."
        shape="picos"
        color="var(--color-purple-x11)"
      />
    </motion.div>
  );
};

export default DisenoPage;
