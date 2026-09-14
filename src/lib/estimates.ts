import crypto from 'crypto';

/** Estados del ciclo de vida de un presupuesto. */
export const ESTIMATE_STATUS = {
  BORRADOR: 'Borrador',
  ENVIADO: 'Enviado',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  MODIFICACION_SOLICITADA: 'Modificación solicitada',
  FACTURADO: 'Facturado',
} as const;

export type EstimateStatus =
  (typeof ESTIMATE_STATUS)[keyof typeof ESTIMATE_STATUS];

/** Estados en los que el presupuesto se puede editar desde la app. */
export const ESTIMATE_EDITABLE: EstimateStatus[] = [
  ESTIMATE_STATUS.BORRADOR,
  ESTIMATE_STATUS.RECHAZADO,
  ESTIMATE_STATUS.MODIFICACION_SOLICITADA,
];

/**
 * Estados desde los que se puede convertir el presupuesto en factura.
 * - Aceptado: flujo normal (cliente dio el OK).
 * - Borrador: permite facturar directamente sin pasar por el enlace público.
 */
export const ESTIMATE_CONVERTIBLE: EstimateStatus[] = [
  ESTIMATE_STATUS.ACEPTADO,
  ESTIMATE_STATUS.BORRADOR,
];

/** ¿El presupuesto se puede convertir a factura (Aceptado o Borrador)? */
export function isEstimateConvertible(status?: string | null): boolean {
  return Boolean(status && ESTIMATE_CONVERTIBLE.includes(status as EstimateStatus));
}

export function hashEstimateToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

/** Enlace público de respuesta del cliente (Aceptar / Rechazar / Modificar). */
export function getEstimateLink(token: string): string {
  return `${getSiteUrl()}/presupuesto/${token}`;
}

/** Etiqueta legible de un estado para mostrar en la UI. */
export function estimateStatusLabel(status?: string | null): string {
  return status || ESTIMATE_STATUS.BORRADOR;
}

/** ¿El presupuesto es editable (Borrador / Rechazado / Modificación solicitada)? */
export function isEstimateEditable(status?: string | null): boolean {
  return Boolean(status && ESTIMATE_EDITABLE.includes(status as EstimateStatus));
}

/** Color (hex) por estado para los badges de la UI. */
export const ESTIMATE_STATUS_COLOR: Record<string, string> = {
  [ESTIMATE_STATUS.BORRADOR]: '#64748b',
  [ESTIMATE_STATUS.ENVIADO]: '#0284c7',
  [ESTIMATE_STATUS.ACEPTADO]: '#16a34a',
  [ESTIMATE_STATUS.RECHAZADO]: '#dc2626',
  [ESTIMATE_STATUS.MODIFICACION_SOLICITADA]: '#ea580c',
  [ESTIMATE_STATUS.FACTURADO]: '#475569',
};

export function estimateStatusColor(status?: string | null): string {
  return ESTIMATE_STATUS_COLOR[status || ''] || '#64748b';
}