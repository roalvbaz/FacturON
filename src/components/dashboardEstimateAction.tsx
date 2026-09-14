'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendEstimateAction } from '@/actions/estimate.actions';
import { getEstimateLink } from '@/lib/estimates';
import { showToast } from '@/lib/utils/toast';

/**
 * Acciones rápidas por fila para los presupuestos del dashboard:
 * - Copiar enlace de aceptación (si tiene token).
 * - Enviar por email (pasando de Borrador → Enviado), ligero, sin abrir el visor.
 */
export default function DashboardEstimateAction({
  estimateId,
  status,
  acceptToken,
}: {
  estimateId: string;
  status: string;
  acceptToken: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const copyLink = async () => {
    if (!acceptToken) {
      showToast.error('Este presupuesto no tiene enlace todavía. Envíalo primero.');
      return;
    }
    try {
      await navigator.clipboard.writeText(getEstimateLink(acceptToken));
      showToast.success('Enlace de aceptación copiado.');
    } catch {
      showToast.error('No se pudo copiar el enlace.');
    }
  };

  const send = async () => {
    setBusy('send');
    try {
      const res = await sendEstimateAction(estimateId);
      if (res.success) {
        showToast.success(`Presupuesto enviado por email (${res.emailedTo}).`);
        router.refresh();
      } else {
        showToast.error(res.error || 'No se pudo enviar el presupuesto.');
      }
    } catch (err: any) {
      showToast.error(err?.message || 'No se pudo enviar el presupuesto.');
    } finally {
      setBusy(null);
    }
  };

  const canSend = ['Borrador', 'Enviado', 'Rechazado', 'Modificación solicitada'].includes(status);

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end' }}>
      {canSend && (
        <button
          type="button"
          onClick={send}
          disabled={busy === 'send'}
          title={`Enviar ${status === 'Enviado' ? 'de nuevo' : ''} por email al cliente`}
          style={{
            background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px',
            padding: '5px 8px', cursor: busy === 'send' ? 'not-allowed' : 'pointer', color: 'var(--primary)',
            fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600,
          }}
        >
          {busy === 'send' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
          Enviar
        </button>
      )}
      <button
        type="button"
        onClick={copyLink}
        title={acceptToken ? 'Copiar enlace de aceptación' : 'Envíalo primero para generar el enlace'}
        style={{
          background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px',
          padding: '5px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.78rem',
          display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600,
        }}
      >
        <i className="fas fa-link"></i>
        {acceptToken ? 'Enlace' : '—'}
      </button>
    </div>
  );
}