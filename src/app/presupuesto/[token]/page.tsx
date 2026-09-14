import { getEstimateByTokenAction } from '@/actions/estimate.actions';
import EstimateRespond from '@/components/estimateRespondClient';
import InvoicePDFTemplate from '@/components/invoicePDFTemplate';
import { estimateStatusLabel } from '@/lib/estimates';

export const metadata = { title: 'Presupuesto' };

export default async function PresupuestoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getEstimateByTokenAction(token);

  if (!data.success || !data.estimate || !data.company) {
    return (
      <PublicShell>
        <div style={{ maxWidth: '560px', margin: '80px auto', textAlign: 'center', color: 'var(--text-muted)' }}>
          <i className="fas fa-file-invoice-dollar" style={{ fontSize: '2.5rem', opacity: 0.4, marginBottom: '12px', display: 'block' }}></i>
          <h2 style={{ color: 'var(--text-main)', fontWeight: 800, margin: '0 0 8px' }}>Presupuesto no disponible</h2>
          <p style={{ fontSize: '0.9rem', margin: 0 }}>{data.error}</p>
        </div>
      </PublicShell>
    );
  }

  const e = data.estimate;
  const c = data.customer;
  const company = data.company;
  const settings = data.settings;
  const lines = data.lines || [];

  const statusColor: Record<string, string> = {
    Borrador: '#64748b',
    Enviado: '#0ea5e9',
    Aceptado: '#10b981',
    Rechazado: '#ef4444',
    'Modificación solicitada': '#f59e0b',
    Facturado: '#64748b',
  };

  const factura = {
    id: e.id,
    formatted_number: e.formatted_number,
    issued_at: e.issued_at,
    expiry_date: e.expiry_date,
    client_name: c?.name || 'Cliente',
    client_tax_id: c?.tax_id || null,
    client_address: c?.address || null,
    subtotal_cents: e.subtotal_cents,
    vat_total_cents: e.vat_total_cents,
    total_cents: e.total_cents,
    lines: lines.map((l: any) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price_cents: l.unit_price_cents,
      vat_percent: l.vat_percent,
      total_amount_cents: l.total_amount_cents,
    })),
  };

  const empresa = { name: company.name, tax_id: company.tax_id, address: company.address };

  return (
    <PublicShell>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 16px' }}>

        {/* BARRA SUPERIOR — empresa + estado + botones */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              padding: '5px 14px', borderRadius: '999px', fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.02em',
              backgroundColor: `${statusColor[e.status] || '#64748b'}18`,
              color: statusColor[e.status] || '#64748b',
              border: `1px solid ${statusColor[e.status] || '#64748b'}40`,
            }}>
              <i className="fas fa-circle" style={{ fontSize: '0.45rem', marginRight: '6px' }}></i>
              {estimateStatusLabel(e.status)}
            </div>
            {e.isExpired && e.status === 'Enviado' && (
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#ef4444' }}>
                ⏰ Caducado
              </span>
            )}
          </div>
          <a
            href={`/api/presupuesto/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px',
              backgroundColor: '#0f172a', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.82rem',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            <i className="fas fa-download"></i> Descargar PDF
          </a>
        </div>

        {/* NOTA DEL CLIENTE */}
        {e.client_note && (e.status === 'Rechazado' || e.status === 'Modificación solicitada') && (
          <div style={{
            padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', fontSize: '0.88rem',
            backgroundColor: e.status === 'Rechazado' ? '#fef2f2' : '#fffbeb',
            border: `1px solid ${e.status === 'Rechazado' ? '#fecaca' : '#fed7aa'}`,
            color: '#1e293b',
          }}>
            <strong style={{ color: e.status === 'Rechazado' ? '#991b1b' : '#92400e' }}>
              {e.status === 'Rechazado' ? 'Motivo del rechazo' : 'Solicitud de modificación'}:
            </strong>{' '}
            {e.client_note}
          </div>
        )}

        {/* DOCUMENTO PRESUPUESTO — el mismo look del visor PDF */}
        <div style={{
          backgroundColor: '#ffffff', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', borderRadius: '8px',
          marginBottom: '24px', overflow: 'hidden',
        }}>
          {/* Responsive wrapper: scroll horizontal en móvil, sin scroll en desktop */}
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: '760px', padding: '0', transform: 'none' }}>
              <InvoicePDFTemplate
                factura={factura}
                empresa={empresa}
                settings={settings || undefined}
                templateId={settings?.template_id || undefined}
                isEstimate
              />
            </div>
          </div>
        </div>

        {/* ZONA DE RESPUESTA */}
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <EstimateRespond
            token={token}
            status={e.status}
            respondable={e.respondable}
            isExpired={e.isExpired}
            formattedNumber={e.formatted_number}
          />
        </div>

        <div style={{ textAlign: 'center', margin: '2rem 0 1rem', fontSize: '0.72rem', color: '#94a3b8' }}>
          Generado con FacturON · Al aceptar este presupuesto, {company.name} emitirá la factura correspondiente.
        </div>
      </div>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#1e293b', padding: 'clamp(16px, 4vw, 40px)' }}>
      {children}
    </div>
  );
}
