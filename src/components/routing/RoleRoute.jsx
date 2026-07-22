/**
 * @file RoleRoute.jsx
 * @description Guarda de rutas basada en el rol del usuario autenticado
 * Redirige a la ruta "hogar" del usuario si su rol no tiene permiso para
 * ver la sección solicitada (ver reglas en utils/roleAccess.js)
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 */

import React from 'react';
import PropTypes from 'prop-types';
import { Navigate, useParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { canAccessSection, getHomeRoute } from '../../utils/roleAccess';

/**
 * Componente RoleRoute
 * Envuelve el elemento de una ruta y solo lo renderiza si el rol del usuario
 * tiene permiso para esa sección; de lo contrario redirige a su ruta hogar
 *
 * @component
 * @param {Object} props
 * @param {string} props.section - Identificador de la sección a proteger
 * @param {ReactNode} props.children - Contenido a proteger
 * @returns {ReactElement} Children si el rol tiene acceso, o redirección
 */
const RoleRoute = ({ section, children }) => {
  const { user } = useAuth();
  const { areaId } = useParams();

  if (!canAccessSection(user, section, areaId)) {
    return <Navigate to={getHomeRoute(user)} replace />;
  }

  return children;
};

RoleRoute.propTypes = {
  section: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

export default RoleRoute;
