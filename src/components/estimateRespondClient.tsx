'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { respondEstimateAction } from '@/actions/estimate.actions';

type ResponseKind = 'ACEPTAR' | 'RECHAZAR' | 'MODIFICAR' | null;

export default function EstimateRespond({
  token,
  status,
  respondable,
  isExpired,
  formattedNumber,
}: {
  token: string;
  status: string;
  respondable: boolean;
  isExpired: boolean;
  formattedNumber: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ResponseKind | 'CONFIRM_ACCEPT' | null>(null);
  const [note, setNote] = useState('');
  const [noteRequired, setNoteRequired] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!respondable) {
    const done =
      status === 'Aceptado' ? 'Has aceptado este presupuesto. El emisor generará la factura en breve.'
      : status === 'Rechazado' ? 'Has rechazado este presupuesto.'
      : status === 'Facturado' ? 'Este presupuesto ya ha sido facturado.'
      : status === 'Modificación solicitada' ? 'Tu solicitud de modificación está en manos del emisor.'
      : 'Este presupuesto ya no admite más respuestas.';

    return (
      <div style={{
        padding: '16px 18px', borderRadius: '12px', textAlign: 'center',
        backgroundColor: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color)',
        fontSize: '0.9rem', color: 'var(--text-main)',
      }}>
        <i className="fas fa-check-circle" style={{ color: 'hsl(142 71% 45%)', marginRight: '8px' }}></i>
        {done}
      </div>
    );
  }

  const openKind = (kind: Exclude<ResponseKind, null>) => {
    setPending(kind);
    setError(null);
    setNoteRequired(kind === 'MODIFICAR');
  };

  const submit = async () => {
    if (pending === 'MODIFICAR' && !note.trim()) {
      setNoteRequired(true);
      setError('Describe qué cambios necesitas para solicitar la modificación.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      // CONFIRM_ACCEPT es la confirmación visual; la acción real de servidor es ACEPTAR.
      const action: 'ACEPTAR' | 'RECHAZAR' | 'MODIFICAR' =
        pending === 'CONFIRM_ACCEPT' ? 'ACEPTAR' : (pending as 'ACEPTAR' | 'RECHAZAR' | 'MODIFICAR');
      const res = await respondEstimateAction(token, action, note.trim() || undefined);
      if (!res.success) {
        setError(res.error || 'No se pudo procesar la respuesta.');
      } else {
        setPending(null);
        router.refresh(); // re-render del servidor con el nuevo estado
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la respuesta.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={{ borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg, #ffffff)', padding: '20px' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)' }}>
        ¿Qué quieres hacer con el presupuesto {formattedNumber}?
      </h3>

      {isExpired && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.82rem',
          backgroundColor: 'var(--warning-bg, #fef3c7)', border: '1px solid var(--warning-border, #fcd34d)',
          color: 'var(--text-main)',
        }}>
          ⏰ El periodo de validez ha vencido. Puedes solicitar que el emisor prorrogue el plazo o ajuste el presupuesto.
        </div>
      )}

      {/* Selector de acción */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {!isExpired && (
          <button type="button" onClick={() => { setPending('CONFIRM_ACCEPT'); setError(null); }}
            style={{ flex: '1 1 160px', padding: '12px', border: 'none', borderRadius: '10px', cursor: 'pointer', background: 'hsl(142 71% 45%)', color: '#ffffff', fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 4px 10px rgba(16,185,129,0.25)' }}>
            <i className="fas fa-check-double"></i>&nbsp; Aceptar
          </button>
        )}
        <button type="button" onClick={() => openKind('RECHAZAR')}
          style={{ flex: '1 1 160px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', cursor: 'pointer', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: '0.88rem' }}>
          <i className="fas fa-times"></i>&nbsp; Rechazar
        </button>
        <button type="button" onClick={() => openKind('MODIFICAR')}
          style={{ flex: '1 1 160px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', cursor: 'pointer', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: '0.88rem' }}>
          <i className="fas fa-edit"></i>&nbsp; Pedir modificación
        </button>
      </div>

      {/* Textarea para nota (rechazo / modificación) */}
      {(pending === 'RECHAZAR' || pending === 'MODIFICAR') && (
        <div style={{ marginTop: '14px' }}>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
            {pending === 'MODIFICAR' ? 'Indica qué cambios necesitas (obligatorio)' : '¿Motivo del rechazo? (opcional)'}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={pending === 'MODIFICAR' ? 'Ej: ajustar cantidades, cambiar la fecha de entrega, añadir costes de envío…' : 'Es opcional, pero ayuda al emisor a entender tu decisión.'}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '8px', resize: 'vertical',
              border: noteRequired && !note.trim() ? '1.5px solid var(--danger, #dc2626)' : '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.85rem', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button type="button" onClick={() => setPending(null)} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={working}
              style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: working ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.84rem',
                background: pending === 'RECHAZAR' ? 'hsl(0 72% 51%)' : 'hsl(32 95% 44%)', color: '#ffffff' }}>
              {working ? <i className="fas fa-spinner fa-spin"></i> : pending === 'RECHAZAR' ? 'Confirmar rechazo' : 'Solicitar modificación'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmación de aceptación */}
      {pending === 'CONFIRM_ACCEPT' && (
        <div style={{ marginTop: '14px', padding: '14px', borderRadius: '10px', backgroundColor: 'hsl(142 71% 45% / 0.08)', border: '1px solid hsl(142 71% 45% / 0.35)' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.84rem', color: 'var(--text-main)' }}>
            Al confirmar, acepta este presupuesto y autoriza a la empresa a emitir la factura correspondiente. ¿Desea continuar?
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setPending(null)} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={working}
              style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: working ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.84rem', background: 'hsl(142 71% 45%)', color: '#ffffff' }}>
              {working ? <i className="fas fa-spinner fa-spin"></i> : 'Sí, aceptar el presupuesto'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', fontSize: '0.82rem', backgroundColor: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger-border, #fecaca)', color: 'var(--danger, #dc2626)' }}>
          <i className="fas fa-exclamation-triangle"></i>&nbsp; {error}
        </div>
      )}
    </div>
  );
}