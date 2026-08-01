/**
 * @file overtimeRules.js
 * @description Utilidades y reglas de negocio para la gestión de horas extras en Dicrejart.
 * Incluye la regla de bloqueo automático por inasistencia (penalización de 7 días naturales)
 * y el cálculo dinámico de franjas de horario (Matutino vs Vespertino).
 * @author Dicrejart Dev Team
 */

import { getTodayLocalDateStr } from './dateUtils';

/**
 * Nombres y descripciones de los tipos de ausencia
 */
export const AUSENCIA_TITULOS = {
  falta: 'Falta (Inasistencia)',
  incapacidad: 'Incapacidad Médica',
  salida_campo: 'Salida Fuera / Actividad Externa',
  viaje: 'Viaje / Ensamble Foráneo',
  actividad_externa: 'Comisión Externa',
  vacaciones: 'Vacaciones / Permiso',
};

/**
 * Evalúa si un colaborador es elegible para solicitar o realizar horas extras en la fecha solicitada.
 * Regla de Inasistencia: Si el colaborador registró una 'falta' dentro de los 7 días naturales
 * anteriores a targetDateStr, queda BLOQUEADO AUTOMÁTICAMENTE para horas extras durante esos 7 días.
 *
 * @param {Object} operario - Objeto completo del colaborador
 * @param {string} targetDateStr - Fecha para la cual se piden horas extras (YYYY-MM-DD)
 * @returns {{ isEligible: boolean, reason: string, blockedUntil: string|null }}
 */
export const checkOvertimeEligibility = (operario, targetDateStr = getTodayLocalDateStr()) => {
  if (!operario) {
    return { isEligible: false, reason: 'Colaborador no encontrado.', blockedUntil: null };
  }

  const targetDateObj = new Date(`${targetDateStr}T00:00:00`);

  // 1. Verificar si tiene un estado activo de ausencia directa en la fecha solicitada
  if (operario.estado && operario.estado.tipo && operario.estado.tipo !== 'activo') {
    const tipo = operario.estado.tipo;
    const desde = operario.estado.desde || getTodayLocalDateStr();
    const hasta = operario.estado.hasta;

    // Si la fecha solicitada cae dentro del periodo de ausencia
    const isAbsenceActive = !hasta ? targetDateStr >= desde : (targetDateStr >= desde && targetDateStr <= hasta);

    if (isAbsenceActive) {
      return {
        isEligible: false,
        reason: `⛔ No disponible: El colaborador está registrado como ${AUSENCIA_TITULOS[tipo] || tipo} (${operario.estado.notas || 'Sin notas'})`,
        blockedUntil: hasta || 'Indefinido',
      };
    }
  }

  // 2. Reorganizar historial de estados para buscar faltas registradas
  const historial = operario.estadoHistorial || [];
  const todosLosEstados = operario.estado ? [...historial, operario.estado] : historial;

  // Filtrar todos los registros de falta
  const faltas = todosLosEstados.filter((est) => est.tipo === 'falta');

  for (const faltaRecord of faltas) {
    const fechaFaltaStr = faltaRecord.desde || (faltaRecord.registradoAt ? faltaRecord.registradoAt.split('T')[0] : null);
    if (!fechaFaltaStr) continue;

    const fechaFaltaObj = new Date(`${fechaFaltaStr}T00:00:00`);
    const diffTime = targetDateObj.getTime() - fechaFaltaObj.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));

    // Si la falta ocurrió entre 0 y 6 días antes de la fecha solicitada (bloqueo de 7 días naturales)
    if (diffDays >= 0 && diffDays < 7) {
      const fechaDesbloqueoObj = new Date(fechaFaltaObj);
      fechaDesbloqueoObj.setDate(fechaDesbloqueoObj.getDate() + 7);
      const fechaDesbloqueoStr = fechaDesbloqueoObj.toISOString().split('T')[0];

      return {
        isEligible: false,
        reason: `⛔ Bloqueado automáticamente: El colaborador registró una inasistencia el ${fechaFaltaStr}. Penalización activa de 7 días naturales sin horas extras (desbloqueo el ${fechaDesbloqueoStr}).`,
        blockedUntil: fechaDesbloqueoStr,
        fechaFalta: fechaFaltaStr,
      };
    }
  }

  return { isEligible: true, reason: 'Elegible para horas extras.', blockedUntil: null };
};

/**
 * Calcula los horarios de inicio y fin ajustados sumando las horas extras al bloque Matutino o Vespertino.
 *
 * @param {number} baseStart - Hora de inicio base (ej. 8); en bloque 'domingo' es la hora
 *   de entrada REAL de ese turno (no hay jornada base que extender un domingo)
 * @param {number} baseEnd - Hora de fin base (ej. 18 o 13 los sábados); en bloque
 *   'domingo' es la hora de salida REAL de ese turno
 * @param {number} overtimeHours - Cantidad de horas extras (ej. 2); ignorado en bloque
 *   'domingo', se recalcula directo de baseStart/baseEnd
 * @param {'matutino'|'vespertino'|'domingo'} bloque - Bloque de tiempo extra
 * @returns {{ startHour: number, endHour: number, overtimeHours: number, bloque: string }}
 */
export const calculateScheduleFromOvertime = (baseStart = 8, baseEnd = 18, overtimeHours = 0, bloque = 'vespertino') => {
  // Domingo es un turno completo desde cero, no una extensión de una jornada base — se
  // usan las horas de entrada/salida tal cual, sin los topes de 6:00/22:00 que sí aplican
  // a matutino/vespertino (esos topes asumen que ya existe una jornada 8-18 de por medio).
  if (bloque === 'domingo') {
    return { startHour: baseStart, endHour: baseEnd, overtimeHours: Math.max(0, baseEnd - baseStart), bloque: 'domingo' };
  }

  const hours = Number(overtimeHours) || 0;
  if (hours <= 0) {
    return { startHour: baseStart, endHour: baseEnd, overtimeHours: 0, bloque };
  }

  if (bloque === 'matutino') {
    // Las horas extras matutinas inician a las 6:00 AM como máximo (máximo 2h antes de las 8:00 AM)
    const effectiveHours = Math.min(hours, Math.max(0, baseStart - 6));
    const newStart = Math.max(6, baseStart - effectiveHours);
    return {
      startHour: newStart,
      endHour: baseEnd,
      overtimeHours: effectiveHours,
      bloque: 'matutino',
    };
  }

  // Bloque 'vespertino': las horas extras terminan a las 22:00 (10:00 PM) como máximo (hasta 4h después de las 18:00 PM)
  const effectiveHours = Math.min(hours, Math.max(0, 22 - baseEnd));
  const newEnd = Math.min(22, baseEnd + effectiveHours);
  return {
    startHour: baseStart,
    endHour: newEnd,
    overtimeHours: effectiveHours,
    bloque: 'vespertino',
  };
};
