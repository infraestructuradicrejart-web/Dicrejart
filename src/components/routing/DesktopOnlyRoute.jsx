/**
 * @file DesktopOnlyRoute.jsx
 * @description Guarda de rutas basada en el tamaño de pantalla (no en el rol): algunas
 * secciones (Editor Visual, Reportes) no están diseñadas para un teléfono y muestran un
 * aviso en su lugar en vez de renderizarse. A diferencia de RoleRoute, NO redirige a la
 * ruta hogar — el usuario sí tiene permiso para ver la sección, solo no en este
 * dispositivo, así que se queda en la misma URL con un mensaje en su lugar.
 * @author Dicrejart Dev Team
 * @requires react
 */

import React from 'react';
import PropTypes from 'prop-types';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import useIsMobile from '../../hooks/useIsMobile';

/**
 * @component
 * @param {Object} props
 * @param {ReactNode} props.children - Página real a mostrar en desktop
 * @param {string} [props.title] - Título mostrado en el aviso (mismo estilo que la página real)
 * @param {string} [props.message] - Mensaje del aviso
 * @param {('mancha'|'picos'|'trebol'|'cacahuate'|'arco-doble'|'anillo')} [props.shape='picos']
 * @param {string} [props.accentColor='var(--color-secondary)']
 * @returns {ReactElement}
 */
const DesktopOnlyRoute = ({
  children,
  title,
  message = 'Esta sección solo está disponible en computadora. Ábrela desde una PC para usarla.',
  shape = 'picos',
  accentColor = 'var(--color-secondary)',
}) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        {title && <PageHeader title={title} shape={shape} accentColor={accentColor} />}
        <EmptyState message={message} shape={shape} color={accentColor} />
      </>
    );
  }

  return children;
};

DesktopOnlyRoute.propTypes = {
  children: PropTypes.node.isRequired,
  title: PropTypes.string,
  message: PropTypes.string,
  shape: PropTypes.oneOf(['mancha', 'picos', 'trebol', 'cacahuate', 'arco-doble', 'anillo']),
  accentColor: PropTypes.string,
};

export default DesktopOnlyRoute;
