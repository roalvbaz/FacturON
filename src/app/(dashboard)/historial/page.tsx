import { db } from '@/db';
import { invoices, invoice_lines, customers, company_settings, verifactu_submissions } from '@/db/schema';
import { eq, desc, and, ilike, gte, lte, or, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getUserCompanies, getActiveCompanyId } from '@/actions/company.actions';
import InvoicesTableClient from '@/components/invoiceTableClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; series?: string; from?: string; to?: string }>;
}) {
  const resolvedSearchParams = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const userCompanies = await getUserCompanies();
  const activeCompanyId = await getActiveCompanyId();
  const miEmpresa = userCompanies.find((c) => c.id === activeCompanyId);

  if (!miEmpresa) {
    redirect('/empresas');
  }
  const busqueda = resolvedSearchParams.q || '';
  const estadoFiltro = resolvedSearchParams.status || 'Todas';
  const serieFiltro = resolvedSearchParams.series || 'Todas';
  const fechaDesde = resolvedSearchParams.from || '';
  const fechaHasta = resolvedSearchParams.to || '';

  const [settings] = await db
    .select()
    .from(company_settings)
    .where(eq(company_settings.company_id, activeCompanyId))
    .limit(1);

  const conditions = [eq(invoices.company_id, activeCompanyId)];

  if (busqueda.trim()) {
    const term = `%${busqueda.trim()}%`;
    conditions.push(
      or(
        ilike(invoices.formatted_number, term),
        ilike(customers.name, term),
        ilike(customers.tax_id, term)
      )!
    );
  }

  if (estadoFiltro !== 'Todas') {
    conditions.push(eq(invoices.status as any, estadoFiltro));
  }
  if (serieFiltro !== 'Todas') {
    conditions.push(eq(invoices.series_code, serieFiltro));
  }

  if (fechaDesde) {
    const fromDate = new Date(`${fechaDesde}T00:00:00`);
    conditions.push(gte(invoices.issued_at, fromDate));
  }
  if (fechaHasta) {
    const toDate = new Date(`${fechaHasta}T23:59:59.999`);
    conditions.push(lte(invoices.issued_at, toDate));
  }

  const listaFacturas = await db
    .select({
      id: invoices.id,
      company_id: invoices.company_id,
      customer_id: invoices.customer_id,
      series_code: invoices.series_code,
      year: invoices.year,
      number: invoices.number,
      formatted_number: invoices.formatted_number,
      issued_at: invoices.issued_at,
      due_date: invoices.due_date as any,
      status: invoices.status as any,
      rectifies_invoice_id: invoices.rectifies_invoice_id as any,
      rectification_type: invoices.rectification_type as any,
      rectification_reason: invoices.rectification_reason as any,
      subtotal_cents: invoices.subtotal_cents,
      vat_total_cents: invoices.vat_total_cents,
      total_cents: invoices.total_cents,
      qr_code_url: invoices.qr_code_url,
      current_hash: invoices.current_hash,
      client_name: customers.name,
      client_tax_id: customers.tax_id,
      client_address: customers.address,
      client_email: customers.email,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customer_id, customers.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.issued_at));

  // Estado Veri*factu de las facturas listadas (una sola consulta a la cola).
  // Se pasa como prop a la tabla para mostrar el badge sin N requests al cliente.
  const invoiceIds = listaFacturas.map((f) => f.id);
  const vfRows = invoiceIds.length
    ? await db
        .select()
        .from(verifactu_submissions)
        .where(inArray(verifactu_submissions.invoice_id, invoiceIds))
    : [];
  const vfByInvoice = new Map<string, (typeof vfRows)[number]>();
  for (const row of vfRows) {
    const prev = vfByInvoice.get(row.invoice_id);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      vfByInvoice.set(row.invoice_id, row);
    }
  }
  const verifactuStatus: Record<
    string,
    { status?: string | null; csv?: string | null; last_error?: string | null }
  > = {};
  for (const [invId, row] of vfByInvoice) {
    verifactuStatus[invId] = {
      status: row.status,
      csv: row.csv,
      last_error: row.last_error,
    };
  }

  const empresa = {
    id: miEmpresa.id,
    name: miEmpresa.name,
    nif: miEmpresa.tax_id,
    address: miEmpresa.address,
    theme_color: settings?.theme_color || '#4f46e5',
    logo_url: settings?.logo_url || null,
  };

  const templateId = settings?.template_id || 'clasico-tradicional';

  const todasLasLineas = await db.select().from(invoice_lines);

  const facturasConLineas = listaFacturas.map((f) => ({
    ...f,
    lines: todasLasLineas.filter((l) => l.invoice_id === f.id),
  }));

  const exportParams = new URLSearchParams();
  if (busqueda) exportParams.set('q', busqueda);
  if (estadoFiltro !== 'Todas') exportParams.set('status', estadoFiltro);
  if (serieFiltro !== 'Todas') exportParams.set('series', serieFiltro);
  if (fechaDesde) exportParams.set('from', fechaDesde);
  if (fechaHasta) exportParams.set('to', fechaHasta);
  const exportUrl = `/api/invoices/export?${exportParams.toString()}`;

  return (
    <div>
      <div className="header-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-color)', margin: '0 0 2px 0' }}>
            Historial - {miEmpresa.name}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Consulta, filtra y exporta tus facturas ordinarias y rectificativas. Los presupuestos tienen su propia página.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <a
            href={exportUrl}
            className="btn"
            style={{
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              padding: '0.45rem 0.9rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              borderRadius: '6px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <i className="fas fa-file-excel"></i>
            <span>Exportar CSV/Excel</span>
          </a>

          <Link href="/presupuestos" style={{ fontSize: '0.78rem', color: 'var(--primary)', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <i className="fas fa-file-invoice-dollar"></i> Ver Presupuestos
          </Link>
        </div>
      </div>

      {/* FILTROS */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <form method="GET" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Buscar Factura o Cliente
            </label>
            <input 
              type="text" 
              name="q" 
              defaultValue={busqueda} 
              className="form-control" 
              placeholder="Nº Factura, Cliente o NIF..." 
              style={{ height: '45px', fontSize: '0.85rem' }} 
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Tipo de Factura
            </label>
            <select 
              name="series" 
              defaultValue={serieFiltro} 
              className="form-control" 
              style={{ height: '45px', fontSize: '0.85rem' }}
            >
              <option value="Todas">Todas las Series</option>
              <option value="F">Serie F (Ordinarias)</option>
              <option value="R">Serie R (Rectificativas)</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Estado
            </label>
            <select 
              name="status" 
              defaultValue={estadoFiltro} 
              className="form-control" 
              style={{ height: '45px', fontSize: '0.85rem' }}
            >
              <option value="Todas">Todos los Estados</option>
              <option value="Pendiente">Pendientes</option>
              <option value="Pagada">Pagadas</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Fecha Desde
            </label>
            <input 
              type="date" 
              name="from" 
              defaultValue={fechaDesde} 
              className="form-control" 
              style={{ height: '45px', fontSize: '0.85rem' }} 
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Fecha Hasta
            </label>
            <input 
              type="date" 
              name="to" 
              defaultValue={fechaHasta} 
              className="form-control" 
              style={{ height: '45px', fontSize: '0.85rem' }} 
            />
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ flex: 1, height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <i className="fas fa-search"></i> Filtrar
            </button>
            <Link 
              href="/historial" 
              className="btn" 
              style={{ background: 'var(--bg-color)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '45px', padding: '0 1rem' }}
            >
              Limpiar
            </Link>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'visible' }}>
        {facturasConLineas.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <i className="fas fa-file-invoice" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}></i>
            <h3>No se encontraron facturas</h3>
            <p>Prueba a cambiar el tipo de serie, rango de fechas o términos de búsqueda.</p>
          </div>
        ) : (
          <InvoicesTableClient
            facturas={facturasConLineas}
            empresa={empresa}
            settings={settings}
            templateId={templateId}
            verifactuStatus={verifactuStatus}
          />
        )}
      </div>
    </div>
  );
}