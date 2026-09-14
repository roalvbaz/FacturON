import { db } from '@/db';
import { estimates, customers, company_settings } from '@/db/schema';
import { eq, desc, ilike, or, inArray, and, gte, lte } from 'drizzle-orm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getUserCompanies, getActiveCompanyId } from '@/actions/company.actions';
import EstimateTableClient from '@/components/estimateTableClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'Presupuestos — FacturON' };

const ESTIMATE_STATUSES = ['Borrador', 'Enviado', 'Aceptado', 'Rechazado', 'Modificación solicitada', 'Facturado'];

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; from?: string; to?: string }>;
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
  const estadoFiltro = resolvedSearchParams.estado || 'Todos';
  const fechaDesde = resolvedSearchParams.from || '';
  const fechaHasta = resolvedSearchParams.to || '';

  const [settings] = await db
    .select()
    .from(company_settings)
    .where(eq(company_settings.company_id, activeCompanyId))
    .limit(1);

  const conditions = [eq(estimates.company_id, activeCompanyId)];

  if (busqueda.trim()) {
    const term = `%${busqueda.trim()}%`;
    conditions.push(
      or(
        ilike(estimates.formatted_number, term),
        ilike(customers.name, term),
        ilike(customers.tax_id, term)
      )!
    );
  }

  if (estadoFiltro !== 'Todos') {
    conditions.push(eq(estimates.status as any, estadoFiltro));
  }

  if (fechaDesde) {
    const fromDate = new Date(`${fechaDesde}T00:00:00`);
    conditions.push(gte(estimates.issued_at, fromDate));
  }
  if (fechaHasta) {
    const toDate = new Date(`${fechaHasta}T23:59:59.999`);
    conditions.push(lte(estimates.issued_at, toDate));
  }

  const listaPresupuestos = await db
    .select({
      id: estimates.id,
      company_id: estimates.company_id,
      customer_id: estimates.customer_id,
      formatted_number: estimates.formatted_number,
      issued_at: estimates.issued_at,
      expiry_date: estimates.expiry_date,
      status: estimates.status as any,
      converted_invoice_id: estimates.converted_invoice_id as any,
      accept_token: estimates.accept_token as any,
      subtotal_cents: estimates.subtotal_cents,
      vat_total_cents: estimates.vat_total_cents,
      total_cents: estimates.total_cents,
      notes: estimates.notes,
      client_note: estimates.client_note,
      client_name: customers.name,
      client_tax_id: customers.tax_id,
      client_email: customers.email,
      client_address: customers.address,
    })
    .from(estimates)
    .leftJoin(customers, eq(estimates.customer_id, customers.id))
    .where(and(...conditions))
    .orderBy(desc(estimates.issued_at));

  const empresa = {
    id: miEmpresa.id,
    name: miEmpresa.name,
    nif: miEmpresa.tax_id,
    address: miEmpresa.address,
    theme_color: settings?.theme_color || '#4f46e5',
    logo_url: settings?.logo_url || null,
  };

  const templateId = settings?.template_id || 'clasico-tradicional';

  return (
    <div>
      <div className="header-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-color)', margin: '0 0 2px 0' }}>
            Presupuestos - {miEmpresa.name}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Envía el enlace al cliente; cuando lo acepte, pulsa <strong>Tramitar Factura</strong> y envía después la factura final por email.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Link href="/nuevoPresupuesto" className="btn btn-primary" style={{ textDecoration: 'none', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <i className="fas fa-plus"></i>
            <span>Nuevo Presupuesto</span>
          </Link>
        </div>
      </div>

      {/* FILTROS */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <form method="GET" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Buscar Presupuesto o Cliente
            </label>
            <input
              type="text"
              name="q"
              defaultValue={busqueda}
              className="form-control"
              placeholder="Nº Presupuesto, Cliente o NIF..."
              style={{ height: '45px', fontSize: '0.85rem' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Estado
            </label>
            <select
              name="estado"
              defaultValue={estadoFiltro}
              className="form-control"
              style={{ height: '45px', fontSize: '0.85rem' }}
            >
              <option value="Todos">Todos los Estados</option>
              {ESTIMATE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
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
              href="/presupuestos"
              className="btn"
              style={{ background: 'var(--bg-color)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '45px', padding: '0 1rem' }}
            >
              Limpiar
            </Link>
          </div>
        </form>
      </div>

      {/* TABLA DE PRESUPUESTOS */}
      <div className="card" style={{ padding: 0, overflow: 'visible' }}>
        {listaPresupuestos.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <i className="fas fa-file-invoice-dollar" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}></i>
            <h3>No se encontraron presupuestos</h3>
            <p>Prueba a cambiar el estado o los términos de búsqueda.</p>
          </div>
        ) : (
          <EstimateTableClient
            presupuestos={listaPresupuestos}
            empresa={empresa}
            settings={settings}
            templateId={templateId}
            companyId={activeCompanyId}
          />
        )}
      </div>
    </div>
  );
}