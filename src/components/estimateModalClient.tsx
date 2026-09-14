'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import InvoicePDFTemplate from '@/components/invoicePDFTemplate';
import { descargarPresupuestoPDF } from '@/lib/pdf/estimatePdf';
import {
  getEstimateDetailAction,
  sendEstimateAction,
  convertEstimateToInvoiceAction,
} from '@/actions/estimate.actions';
import { getEstimateLink, isEstimateConvertible } from '@/lib/estimates';
import { showToast } from '@/lib/utils/toast';

export default function EstimateModalClient({
  presupuesto,
  empresa,
  settings,
  templateId,
  companyId,
  editable,
}: {
  presupuesto: any;
  empresa: any;
  settings?: any;
  templateId?: string;
  companyId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState({
    paymentMethod: 'TRANSFERENCIA',
    dueDate: '',
    sendEmail: false,
  });
  const [convertError, setConvertError] = useState<string | null>(null);

  const status = presupuesto.status || 'Borrador';
  // Conversión posible desde Aceptado (flujo normal) o desde Borrador (facturar directo).
  const isConvertible = isEstimateConvertible(status);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [open]);

  const openModal = async () => {
    setOpen(true);
    setLoadingDetail(true);
    const res = await getEstimateDetailAction(presupuesto.id);
    setLoadingDetail(false);
    if (res.success) {
      setDetail(res.estimate);
    } else {
      showToast.error(res.error || 'No se pudo cargar el presupuesto.');
    }
  };

  const close = () => {
    setOpen(false);
    setShowConvert(false);
    setConvertError(null);
  };

  const detailFactura = detail
    ? {
        id: detail.id,
        formatted_number: detail.formatted_number,
        issued_at: detail.issued_at,
        expiry_date: detail.expiry_date,
        client_name: detail.customer?.name,
        client_tax_id: detail.customer?.tax_id,
        client_address: detail.customer?.address,
        subtotal_cents: detail.subtotal_cents,
        vat_total_cents: detail.vat_total_cents,
        total_cents: detail.total_cents,
        lines: detail.lines || [],
      }
    : null;

  const handleDownload = async () => {
    setBusy('download');
    try {
      await descargarPresupuestoPDF(presupuesto.id, detail?.formatted_number || presupuesto.formatted_number);
      showToast.success('PDF del presupuesto descargado.');
    } catch (err: any) {
      showToast.error(err?.message || 'Error al generar el PDF.');
    } finally {
      setBusy(null);
    }
  };

  const handleCopyLink = async () => {
    const link = detail?.accept_link || (presupuesto.accept_token ? getEstimateLink(presupuesto.accept_token) : null);
    if (!link) {
      showToast.error('Este presupuesto no tiene un enlace. Envíalo primero.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast.success('Enlace de aceptación copiado al portapapeles.');
    } catch {
      showToast.error('No se pudo copiar el enlace.');
    }
  };

  const handleSend = async () => {
    setBusy('send');
    const res = await sendEstimateAction(presupuesto.id);
    setBusy(null);
    if (res.success) {
      showToast.success(`Presupuesto enviado por email (${res.emailedTo}).`);
      setDetail((d: any) => ({ ...d, accept_link: res.acceptLink, status: 'Enviado' }));
      router.refresh();
    } else {
      showToast.error(res.error || 'No se pudo enviar el presupuesto.');
    }
  };

  const handleConvert = async () => {
    if (!convertForm.dueDate) {
      setConvertError('La fecha de vencimiento de la factura es obligatoria.');
      return;
    }
    setBusy('convert');
    setConvertError(null);
    const res = await convertEstimateToInvoiceAction(presupuesto.id, {
      paymentMethod: convertForm.paymentMethod,
      dueDate: convertForm.dueDate,
      sendEmail: convertForm.sendEmail,
    });
    setBusy(null);
    if (res.success) {
      showToast.success(`Factura ${res.formattedNumber} emitida desde el presupuesto.`);
      setShowConvert(false);
      router.refresh();
    } else {
      setConvertError(res.error || 'No se pudo convertir el presupuesto.');
    }
  };

  const headerTitle = detail?.formatted_number || presupuesto.formatted_number;
  const showSend = ['Borrador', 'Enviado', 'Rechazado', 'Modificación solicitada'].includes(status);

  const modalContent = open ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 2147483647, backgroundColor: 'var(--bg-color)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Cabecera */}
      <div style={{
        backgroundColor: 'var(--card-bg)', padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', flexShrink: 0, gap: '12px', flexWrap: 'wrap',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)', fontWeight: 800 }}>
            Presupuesto: {headerTitle}
          </h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Estado: <strong>{status}</strong>
            {detail?.client_note && status === 'Modificación solicitada' && (
              <span style={{ color: 'var(--danger)', marginLeft: '8px' }}> · Cliente pidió cambios</span>
            )}
          </span>
        </div>

        <div className="invoice-modal-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {isConvertible && (
            <button
              type="button"
              onClick={() => { setShowConvert(true); setConvertError(null); }}
              style={{
                background: '#10b981', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px',
                cursor: 'pointer', display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 700, fontSize: '0.85rem',
                boxShadow: '0 4px 10px rgba(16,185,129,0.3)',
              }}
            >
              <i className="fas fa-file-invoice-dollar"></i> Tramitar Factura
            </button>
          )}

          {editable && (
            <Link
              href={`/nuevoPresupuesto?editar=${presupuesto.id}`}
              style={{
                background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)',
                padding: '8px 12px', borderRadius: '6px', textDecoration: 'none', display: 'inline-flex', gap: '6px', alignItems: 'center', fontWeight: 600, fontSize: '0.85rem',
              }}
            >
              <i className="fas fa-edit"></i> Editar
            </Link>
          )}

          <button
            type="button"
            onClick={handleCopyLink}
            title={detail?.accept_link ? 'Copiar enlace de aceptación' : 'Envíalo primero para generar el enlace'}
            style={{
              background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)',
              padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            <i className="fas fa-link"></i> Copiar enlace
          </button>

          {showSend && (
            <button
              type="button"
              onClick={handleSend}
              disabled={busy === 'send'}
              style={{
                background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)',
                padding: '8px 12px', borderRadius: '6px', cursor: busy === 'send' ? 'not-allowed' : 'pointer', display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, fontSize: '0.85rem',
              }}
            >
              {busy === 'send' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
              {status === 'Enviado' ? 'Reenviar' : 'Enviar'}
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            disabled={busy === 'download' || !detailFactura}
            style={{
              background: '#0f172a', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px',
              cursor: busy === 'download' || !detailFactura ? 'not-allowed' : 'pointer', display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, fontSize: '0.85rem', opacity: busy === 'download' || !detailFactura ? 0.7 : 1,
            }}
          >
            {busy === 'download' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-download"></i>} Descargar PDF
          </button>

          <button
            type="button"
            onClick={close}
            style={{ background: 'none', border: 'none', fontSize: '2.2rem', cursor: 'pointer', color: '#64748b', marginLeft: '6px', lineHeight: '1rem', padding: '0 5px' }}
            title="Cerrar visor"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Vista previa */}
      <div className="invoice-modal-body" style={{ flexGrow: 1, overflowY: 'auto', padding: '2rem', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '900px' }}>
          {loadingDetail ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.6rem' }}></i>
              <p style={{ marginTop: '0.75rem' }}>Cargando presupuesto…</p>
            </div>
          ) : detailFactura ? (
            <InvoicePDFTemplate factura={detailFactura} empresa={empresa} settings={settings} templateId={templateId} isEstimate />
          ) : (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
              No se pudo cargar la vista previa.
            </div>
          )}
        </div>
      </div>

      {/* Diálogo de conversión */}
      {showConvert && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483647, padding: '1rem',
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: '480px', backgroundColor: 'var(--card-bg)', borderRadius: '12px', padding: '1.5rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(16,185,129,0.15)',
                color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem', flexShrink: 0,
              }}>
                <i className="fas fa-file-invoice-dollar"></i>
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)', fontWeight: 800 }}>
                  Tramitar Factura
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {headerTitle} → Serie F inmutable (Veri*factu). Podrás enviarla por email desde el Historial.
                </p>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                Forma de Pago/Cobro
              </label>
              <select
                value={convertForm.paymentMethod}
                onChange={(e) => setConvertForm({ ...convertForm, paymentMethod: e.target.value })}
                className="form-control"
              >
                <option value="TRANSFERENCIA">Transferencia (Pendiente)</option>
                <option value="TARJETA">Tarjeta / TPV (Pagada)</option>
                <option value="EFECTIVO">Efectivo (Pagada)</option>
                <option value="BIZUM">Bizum Directo (Pagada)</option>
                <option value="DOMICILIACION">Giro Bancario (Pendiente)</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                Fecha de Vencimiento <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="date"
                value={convertForm.dueDate}
                onChange={(e) => setConvertForm({ ...convertForm, dueDate: e.target.value })}
                className="form-control"
                required
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-main)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={convertForm.sendEmail}
                onChange={(e) => setConvertForm({ ...convertForm, sendEmail: e.target.checked })}
                style={{ accentColor: 'var(--primary)', width: '15px', height: '15px' }}
              />
              Enviar la factura final por email al tramitarla (puedes hacerlo después desde el Historial)
            </label>

            {convertError && (
              <div style={{
                padding: '10px 12px', borderRadius: '8px', fontSize: '0.8rem',
                backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)',
              }}>
                <i className="fas fa-exclamation-triangle"></i>&nbsp; {convertError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={() => setShowConvert(false)}
                disabled={busy === 'convert'}
                className="btn"
                style={{ background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={busy === 'convert'}
                style={{
                  background: '#10b981', color: 'white', border: 'none', padding: '0.5rem 1.15rem', fontSize: '0.85rem',
                  fontWeight: 700, borderRadius: '6px', cursor: busy === 'convert' ? 'not-allowed' : 'pointer', display: 'flex', gap: '6px', alignItems: 'center',
                }}
              >
                {busy === 'convert' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-circle"></i>}
                Tramitar Factura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
        <button
          type="button"
          onClick={openModal}
          title={`Ver presupuesto ${presupuesto.formatted_number} y acciones`}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '1.1rem' }}
        >
          <i className="fas fa-eye"></i>
        </button>
        {companyId && isConvertible && (
          <button
            type="button"
            onClick={openModal}
            title="Convertir a factura"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)', cursor: 'pointer', color: '#10b981', fontSize: '0.85rem', padding: '4px 8px', borderRadius: '6px' }}
          >
            <i className="fas fa-file-invoice-dollar"></i>
          </button>
        )}
      </div>

      {mounted && createPortal(modalContent, document.body)}
    </>
  );
}