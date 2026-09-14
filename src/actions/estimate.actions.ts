'use server';

import { db } from '@/db';
import { estimates, estimate_lines, customers, companies, company_settings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { getUserCompanies, getActiveCompanyId } from '@/actions/company.actions';
import { emitInvoiceAction } from '@/actions/invoice.actions';
import { sendEstimateEmail } from '@/lib/email/email';
import { renderInvoicePdfBuffer } from '@/lib/pdf/invoicePdf';
import {
  hashEstimateToken,
  getEstimateLink,
  ESTIMATE_STATUS,
  isEstimateEditable,
  isEstimateConvertible,
} from '@/lib/estimates';
import crypto from 'crypto';

// ============================================================
// TIPOS
// ============================================================

interface EstimateLineInput {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  vat_rate?: number | string;
}

interface EstimateCustomerData {
  nombre?: string;
  nif?: string;
  email?: string;
  direccion?: string;
}

/** Estados en los que se permite enviar (o reenviar) el presupuesto. */
const SENDABLE = [
  ESTIMATE_STATUS.BORRADOR,
  ESTIMATE_STATUS.ENVIADO,
  ESTIMATE_STATUS.RECHAZADO,
  ESTIMATE_STATUS.MODIFICACION_SOLICITADA,
];

// ============================================================
// HELPERS
// ============================================================

/** Obligatorio igual que en la emisión de facturas (permite el email y la AEAT). */
function validateCustomer(customerData?: EstimateCustomerData) {
  if (!customerData?.nombre?.trim()) throw new Error('El nombre o razón social del cliente es obligatorio.');
  if (!customerData?.nif?.trim()) throw new Error('El NIF/CIF del cliente es obligatorio.');
  if (!customerData?.email?.trim()) throw new Error('El correo electrónico del cliente es obligatorio.');
}

/** Calcula los totales y las líneas ya formateadas (espejo de emitInvoiceAction). */
function computeEstimateTotals(lines: EstimateLineInput[]) {
  if (!lines || lines.length === 0) throw new Error('El presupuesto debe contener al menos un concepto.');
  for (const line of lines) {
    if (!line.description || !line.description.trim()) {
      throw new Error('Todos los conceptos deben tener una descripción.');
    }
  }

  let subtotalCents = 0;
  let vatTotalCents = 0;

  const formatted = lines.map((l, idx) => {
    const qty = parseFloat(String(l.quantity)) || 1;
    const unitPriceCents = Math.round((parseFloat(String(l.unit_price)) || 0) * 100);
    const lineSubtotal = Math.round(qty * unitPriceCents);
    const vatRate = parseFloat(l.vat_rate as string) || 21;
    const lineVat = Math.round(lineSubtotal * (vatRate / 100));
    const lineTotal = lineSubtotal + lineVat;

    subtotalCents += lineSubtotal;
    vatTotalCents += lineVat;

    return {
      line_index: idx,
      description: l.description,
      quantity: qty.toString(),
      unit_price_cents: unitPriceCents,
      vat_percent: vatRate.toString(),
      vat_amount_cents: lineVat,
      total_amount_cents: lineTotal,
    };
  });

  const totalCents = subtotalCents + vatTotalCents;
  return { subtotalCents, vatTotalCents, totalCents, formatted };
}

/** Número correlativo `P-YYYY-XXXX` por empresa y año (misma lógica que las facturas). */
async function nextEstimateNumber(companyId: string, year: number): Promise<string> {
  const rows = await db
    .select({ formatted_number: estimates.formatted_number })
    .from(estimates)
    .where(eq(estimates.company_id, companyId));

  let maxNum = 0;
  for (const row of rows) {
    const m = /^P-(\d{4})-(\d+)$/.exec(row.formatted_number || '');
    if (m && Number(m[1]) === year) {
      maxNum = Math.max(maxNum, Number(m[2]));
    }
  }
  const next = maxNum + 1;
  return `P-${year}-${String(next).padStart(4, '0')}`;
}

/** Upsert del cliente igual que en emitInvoiceAction → devuelve id (o null). */
async function upsertCustomer(companyId: string, customerData: EstimateCustomerData): Promise<string | null> {
  const taxId = (customerData.nif || '').trim();
  const name = (customerData.nombre || '').trim();
  const email = (customerData.email || '').trim();
  const address = (customerData.direccion || '').trim();

  if (!taxId || taxId === '-') return null;

  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.company_id, companyId), eq(customers.tax_id, taxId)))
    .limit(1);

  if (existing) {
    await db
      .update(customers)
      .set({ name, address, email })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(customers)
    .values({ company_id: companyId, name, tax_id: taxId, email, address })
    .returning({ id: customers.id });
  return created.id;
}

/** Carga el presupuesto verificando que pertenece a una empresa del usuario. */
async function loadOwnedEstimate(estimateId: string) {
  const [estimate] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!estimate) throw new Error('Presupuesto no encontrado.');

  const userCompanies = await getUserCompanies();
  const company = userCompanies.find((c) => c.id === estimate.company_id);
  if (!company) throw new Error('No tienes acceso a este presupuesto.');

  const [customer, settings] = await Promise.all([
    estimate.customer_id
      ? db
          .select()
          .from(customers)
          .where(eq(customers.id, estimate.customer_id))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(company_settings)
      .where(eq(company_settings.company_id, estimate.company_id))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const lines = await db
    .select()
    .from(estimate_lines)
    .where(eq(estimate_lines.estimate_id, estimate.id))
    .orderBy(estimate_lines.line_index);

  return { estimate, customer, company, settings, lines };
}

// ============================================================
// CREAR / EDITAR
// ============================================================

export async function createEstimateAction(payload: {
  customerData?: EstimateCustomerData;
  expiryDate?: string;
  notes?: string;
  lines: EstimateLineInput[];
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    validateCustomer(payload.customerData);
    const { subtotalCents, vatTotalCents, totalCents, formatted } = computeEstimateTotals(payload.lines);

    const companyId = await getActiveCompanyId();
    const issuedAt = new Date();
    const formattedNumber = await nextEstimateNumber(companyId, issuedAt.getFullYear());

    const customerId = await upsertCustomer(companyId, payload.customerData!);

    const [estimate] = await db
      .insert(estimates)
      .values({
        company_id: companyId,
        customer_id: customerId,
        formatted_number: formattedNumber,
        issued_at: issuedAt,
        expiry_date: payload.expiryDate ? new Date(payload.expiryDate) : null,
        status: ESTIMATE_STATUS.BORRADOR,
        subtotal_cents: subtotalCents,
        vat_total_cents: vatTotalCents,
        total_cents: totalCents,
        notes: payload.notes || null,
      })
      .returning({ id: estimates.id, formatted_number: estimates.formatted_number });

    for (const line of formatted) {
      await db.insert(estimate_lines).values({
        estimate_id: estimate.id,
        ...line,
      });
    }

    await logAuditEvent({
      eventCode: 'ESTIMATE_CREATED',
      description: `Presupuesto ${estimate.formatted_number} creado en borrador`,
      companyId,
      userId: user.id,
      metadata: { estimateId: estimate.id, total_cents: totalCents, lines: formatted.length },
    });

    revalidatePath('/historial');
    revalidatePath('/presupuestos');
    revalidatePath('/dashboard');
    revalidatePath('/nuevoPresupuesto');

    return { success: true, estimateId: estimate.id, formattedNumber: estimate.formatted_number };
  } catch (error: any) {
    console.error('❌ ERROR AL CREAR PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'No se pudo crear el presupuesto.' };
  }
}

export async function updateEstimateAction(
  estimateId: string,
  payload: {
    customerData?: EstimateCustomerData;
    expiryDate?: string;
    notes?: string;
    lines: EstimateLineInput[];
  }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    const { estimate, company, lines: _oldLines } = await loadOwnedEstimate(estimateId);

    // Solo se puede editar en estados abiertos (Borrador / Rechazado / Modificación solicitada).
    if (!isEstimateEditable(estimate.status)) {
      throw new Error(`El presupuesto no se puede editar en estado "${estimate.status}".`);
    }
    if (estimate.status === ESTIMATE_STATUS.RECHAZADO
      || estimate.status === ESTIMATE_STATUS.MODIFICACION_SOLICITADA) {
      // El cliente ya se ha posicionado; al editar vuelve a Borrador hasta reenviar.
    }

    validateCustomer(payload.customerData);
    const { subtotalCents, vatTotalCents, totalCents, formatted } = computeEstimateTotals(payload.lines);

    const customerId = await upsertCustomer(company.id, payload.customerData!);

    await db
      .update(estimates)
      .set({
        customer_id: customerId,
        expiry_date: payload.expiryDate ? new Date(payload.expiryDate) : null,
        status: ESTIMATE_STATUS.BORRADOR, // al editar vuelve a borrador hasta reenviar
        subtotal_cents: subtotalCents,
        vat_total_cents: vatTotalCents,
        total_cents: totalCents,
        notes: payload.notes || null,
        client_note: null, // la solicitud de cambios previa se considera atendida
      })
      .where(eq(estimates.id, estimateId));

    // Reemplazo de líneas (delete + insert)
    await db.delete(estimate_lines).where(eq(estimate_lines.estimate_id, estimateId));
    for (const line of formatted) {
      await db.insert(estimate_lines).values({ estimate_id: estimateId, ...line });
    }

    await logAuditEvent({
      eventCode: 'ESTIMATE_UPDATED',
      description: `Presupuesto ${estimate.formatted_number} editado`,
      companyId: company.id,
      userId: user.id,
      metadata: { estimateId, total_cents: totalCents, lines: formatted.length },
    });

    revalidatePath('/historial');
    revalidatePath('/presupuestos');
    revalidatePath('/dashboard');
    revalidatePath('/nuevoPresupuesto');

    return { success: true, estimateId, formattedNumber: estimate.formatted_number };
  } catch (error: any) {
    console.error('❌ ERROR AL EDITAR PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'No se pudo actualizar el presupuesto.' };
  }
}

// ============================================================
// ENVIAR (rota el token del enlace público)
// ============================================================

export async function sendEstimateAction(estimateId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    const { estimate, customer, company } = await loadOwnedEstimate(estimateId);

    if (!SENDABLE.includes(estimate.status as any)) {
      throw new Error(`No se puede enviar un presupuesto en estado "${estimate.status}".`);
    }
    if (!customer?.email?.trim()) {
      throw new Error('El cliente no tiene un correo electrónico asociado para recibir el enlace.');
    }

    // Rotar el token: el enlace anterior queda invalidado.
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashEstimateToken(token);

    await db
      .update(estimates)
      .set({
        accept_token: token,
        accept_token_hash: tokenHash,
        status: ESTIMATE_STATUS.ENVIADO,
        client_note: null,
      })
      .where(eq(estimates.id, estimateId));

    const acceptLink = getEstimateLink(token);
    const expiryDate = estimate.expiry_date
      ? new Date(estimate.expiry_date).toLocaleDateString('es-ES')
      : undefined;

    const mail = await sendEstimateEmail({
      to: customer.email,
      clientName: customer.name || 'Cliente',
      estimateNumber: estimate.formatted_number,
      totalEur: (estimate.total_cents / 100).toFixed(2),
      companyName: company.name,
      acceptLink,
      expiryDate,
    });

    if (!mail.success) {
      throw new Error(mail.error || 'No se pudo enviar el correo.');
    }

    await logAuditEvent({
      eventCode: 'ESTIMATE_SENT',
      description: `Presupuesto ${estimate.formatted_number} enviado a ${customer.email} con enlace de aceptación`,
      companyId: company.id,
      userId: user.id,
      metadata: { estimateId, email: customer.email },
    });

    revalidatePath('/historial');
    revalidatePath('/presupuestos');
    revalidatePath('/dashboard');
    revalidatePath('/nuevoPresupuesto');

    return { success: true, acceptLink, emailedTo: customer.email };
  } catch (error: any) {
    console.error('❌ ERROR AL ENVIAR PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'No se pudo enviar el presupuesto.' };
  }
}

// ============================================================
// CONSULTAS
// ============================================================

/** Detalle completo para el editor / modal (con token claro para copiar enlace). */
export async function getEstimateDetailAction(estimateId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    const { estimate, customer, company, settings, lines } = await loadOwnedEstimate(estimateId);

    return {
      success: true,
      estimate: {
        id: estimate.id,
        formatted_number: estimate.formatted_number,
        status: estimate.status,
        issued_at: estimate.issued_at,
        expiry_date: estimate.expiry_date,
        notes: estimate.notes,
        client_note: estimate.client_note,
        accepted_at: estimate.accepted_at,
        converted_invoice_id: estimate.converted_invoice_id,
        subtotal_cents: estimate.subtotal_cents,
        vat_total_cents: estimate.vat_total_cents,
        total_cents: estimate.total_cents,
        accept_link: estimate.accept_token ? getEstimateLink(estimate.accept_token) : null,
        customer: customer
          ? { name: customer.name, tax_id: customer.tax_id, email: customer.email, address: customer.address }
          : null,
        lines: lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
          vat_percent: l.vat_percent,
          total_amount_cents: l.total_amount_cents,
        })),
      },
      company: { name: company.name, tax_id: company.tax_id, address: company.address },
      settings: {
        template_id: settings?.template_id || null,
        theme_color: settings?.theme_color || null,
        logo_url: settings?.logo_url || null,
      },
    };
  } catch (error: any) {
    console.error('❌ ERROR AL CARGAR PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'No se pudo cargar el presupuesto.' };
  }
}

// ============================================================
// PDF (servidor)
// ============================================================

export async function getEstimatePdfBase64Action(estimateId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    const { estimate, customer, company, settings, lines } = await loadOwnedEstimate(estimateId);

    const buffer = await renderInvoicePdfBuffer({
      factura: {
        id: estimate.id,
        formatted_number: estimate.formatted_number,
        issued_at: estimate.issued_at,
        expiry_date: estimate.expiry_date,
        client_name: customer?.name,
        client_tax_id: customer?.tax_id,
        client_address: customer?.address,
        subtotal_cents: estimate.subtotal_cents,
        vat_total_cents: estimate.vat_total_cents,
        total_cents: estimate.total_cents,
        lines,
      },
      empresa: { name: company.name, tax_id: company.tax_id, address: company.address },
      settings,
      documentType: 'estimate',
      expiryDate: estimate.expiry_date || undefined,
    });

    await logAuditEvent({
      eventCode: 'ESTIMATE_PDF_DOWNLOADED',
      description: `Descarga del PDF del presupuesto ${estimate.formatted_number}`,
      companyId: company.id,
      userId: user.id,
      metadata: { estimateId },
    });

    return {
      success: true,
      pdfBase64: buffer.toString('base64'),
      filename: `Presupuesto_${estimate.formatted_number}.pdf`,
    };
  } catch (error: any) {
    console.error('❌ ERROR GENERANDO PDF DE PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'Error al generar el PDF.' };
  }
}

// ============================================================
// RESPUESTA PÚBLICA DEL CLIENTE (sin autenticación)
// ============================================================

export async function respondEstimateAction(
  token: string,
  response: 'ACEPTAR' | 'RECHAZAR' | 'MODIFICAR',
  note?: string
) {
  try {
    if (!token) throw new Error('Enlace no válido.');

    const tokenHash = hashEstimateToken(token);
    const [estimate] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.accept_token_hash, tokenHash))
      .limit(1);

    if (!estimate) throw new Error('Presupuesto no encontrado. El enlace puede haber sido renovado.');

    const available = ['Enviado'];
    if (!available.includes(estimate.status)) {
      throw new Error(
        estimate.status === 'Modificación solicitada'
          ? 'Ya has solicitado una modificación; el emisor está revisándola.'
          : `Este presupuesto ya ha sido respondido (${estimate.status}).`
      );
    }

    // Normaliza la acción. CONFIRM_ACCEPT es un artefacto de UX del cliente
    // (la confirmación visual de "Aceptar"); builds antiguos la enviaban tal cual
    // y el else de abajo la guardaba como "Modificación solicitada". Al normalizar
    // aquí, el servidor queda a salvo aunque el cliente sea una versión antigua.
    const action = response === 'CONFIRM_ACCEPT' ? 'ACEPTAR' : response;
    if (!['ACEPTAR', 'RECHAZAR', 'MODIFICAR'].includes(action)) {
      throw new Error('Respuesta no válida.');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isExpired = estimate.expiry_date ? new Date(estimate.expiry_date).getTime() < today.getTime() : false;

    if (action === 'ACEPTAR' && isExpired) {
      throw new Error('Este presupuesto ha caducado. Solicita una prórroga o una nueva versión.');
    }
    if (action === 'MODIFICAR' && !note?.trim()) {
      throw new Error('Indica qué cambios necesitas para solicitar la modificación.');
    }

    if (action === 'ACEPTAR') {
      await db
        .update(estimates)
        .set({
          status: ESTIMATE_STATUS.ACEPTADO,
          accepted_at: new Date(),
          client_note: null,
        })
        .where(eq(estimates.id, estimate.id));
    } else if (action === 'RECHAZAR') {
      await db
        .update(estimates)
        .set({ status: ESTIMATE_STATUS.RECHAZADO, client_note: note?.trim() || null })
        .where(eq(estimates.id, estimate.id));
    } else {
      await db
        .update(estimates)
        .set({ status: ESTIMATE_STATUS.MODIFICACION_SOLICITADA, client_note: note?.trim() || null })
        .where(eq(estimates.id, estimate.id));
    }

    const eventCode =
      action === 'ACEPTAR' ? 'ESTIMATE_ACCEPTED'
      : action === 'RECHAZAR' ? 'ESTIMATE_REJECTED'
      : 'ESTIMATE_MODIFICATION_REQUESTED';

    await logAuditEvent({
      eventCode: eventCode as any,
      description:
        action === 'ACEPTAR'
          ? `El cliente aceptó el presupuesto ${estimate.formatted_number}`
          : action === 'RECHAZAR'
            ? `El cliente rechazó el presupuesto ${estimate.formatted_number}${note?.trim() ? ` (motivo: ${note.trim()})` : ''}`
            : `El cliente solicitó una modificación del presupuesto ${estimate.formatted_number} (${note?.trim()})`,
      companyId: estimate.company_id,
      userId: null,
      metadata: { estimateId: estimate.id, response: action },
    });

    revalidatePath(`/presupuesto/${token}`);
    revalidatePath('/presupuestos');
    revalidatePath('/dashboard');
    revalidatePath('/historial');

    return { success: true, status: response === 'ACEPTAR' ? 'Aceptado' : response === 'RECHAZAR' ? 'Rechazado' : 'Modificación solicitada' };
  } catch (error: any) {
    console.error('❌ ERROR EN RESPUESTA PÚBLICA:', error);
    return { success: false, error: error?.message || 'No se pudo procesar la respuesta.' };
  }
}

/** Data pública para la página /presupuesto/[token] (sin datos sensibles). */
export async function getEstimateByTokenAction(token: string) {
  try {
    if (!token) return { success: false, error: 'Enlace no válido.' };

    const tokenHash = hashEstimateToken(token);
    const [estimate] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.accept_token_hash, tokenHash))
      .limit(1);
    if (!estimate) {
      return { success: false, error: 'Presupuesto no encontrado. El enlace puede haber sido renovado por el emisor.' };
    }

    const [customer, company, companySettings] = await Promise.all([
      estimate.customer_id
        ? db
            .select()
            .from(customers)
            .where(eq(customers.id, estimate.customer_id))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      db
        .select()
        .from(companies)
        .where(eq(companies.id, estimate.company_id))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(company_settings)
        .where(eq(company_settings.company_id, estimate.company_id))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    const lines = await db
      .select()
      .from(estimate_lines)
      .where(eq(estimate_lines.estimate_id, estimate.id))
      .orderBy(estimate_lines.line_index);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isExpired = estimate.expiry_date ? new Date(estimate.expiry_date).getTime() < today.getTime() : false;

    return {
      success: true,
      estimate: {
        id: estimate.id,
        formatted_number: estimate.formatted_number,
        status: estimate.status,
        issued_at: estimate.issued_at,
        expiry_date: estimate.expiry_date,
        client_note: estimate.client_note,
        notes: estimate.notes,
        subtotal_cents: estimate.subtotal_cents,
        vat_total_cents: estimate.vat_total_cents,
        total_cents: estimate.total_cents,
        isExpired,
        respondable: estimate.status === 'Enviado',
      },
      customer: customer
        ? { name: customer.name, tax_id: customer.tax_id, email: customer.email, address: customer.address }
        : null,
      company: company
        ? { name: company.name, tax_id: company.tax_id, address: company.address, city: company.city, postal_code: company.postal_code }
        : null,
      settings: companySettings
        ? { template_id: companySettings.template_id, theme_color: companySettings.theme_color, logo_url: companySettings.logo_url, font_family: companySettings.font_family }
        : null,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        vat_percent: l.vat_percent,
        total_amount_cents: l.total_amount_cents,
      })),
    };
  } catch (error: any) {
    console.error('❌ ERROR CARGANDO PRESUPUESTO PÚBLICO:', error);
    return { success: false, error: 'No se pudo cargar el presupuesto.' };
  }
}

// ============================================================
// CONVERTIR A FACTURA (AEAT opcional: solo si hay certificado)
// ============================================================

export async function convertEstimateToInvoiceAction(
  estimateId: string,
  opts: { paymentMethod: string; dueDate: string; sendEmail: boolean }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autorizado');

    const { estimate, customer, company, settings, lines } = await loadOwnedEstimate(estimateId);

    if (!isEstimateConvertible(estimate.status)) {
      throw new Error('Solo puedes convertir a factura un presupuesto Aceptado o en Borrador.');
    }
    if (!customer?.tax_id) {
      throw new Error('El cliente no tiene NIF/CIF. Edita el presupuesto antes de convertir.');
    }

    // No exigimos certificado AEAT para convertir: la AEAT se encola solo si
    // la empresa ha subido uno (ver emitInvoiceAction). Mientras no se envíe
    // nada a la AEAT, se puede facturar sin certificado.
    void settings;

    // Reutilizamos emitInvoiceAction al 100%: numeración F, cadena de hashes,
    // cola AEAT y email con PDF. Solo le pasamos los datos del presupuesto.
    const invoiced = await emitInvoiceAction({
      seriesCode: 'F',
      dueDate: opts.dueDate,
      paymentMethod: opts.paymentMethod,
      sendEmail: opts.sendEmail,
      customerData: {
        nombre: customer.name || undefined,
        nif: customer.tax_id || undefined,
        email: customer.email || undefined,
        direccion: customer.address || undefined,
      },
      lines: lines.map((l) => ({
        description: l.description || 'Concepto',
        quantity: parseFloat(l.quantity as string) || 1,
        unit_price: (l.unit_price_cents || 0) / 100,
        vat_rate: parseFloat(l.vat_percent as string) || 21,
      })),
    });

    // emitInvoiceAction lanza excepción si falla; si llegamos aquí, la factura existe.
    await db
      .update(estimates)
      .set({
        status: ESTIMATE_STATUS.FACTURADO,
        converted_invoice_id: invoiced.invoiceId,
      })
      .where(eq(estimates.id, estimateId));

    await logAuditEvent({
      eventCode: 'ESTIMATE_CONVERTED',
      description: `Presupuesto ${estimate.formatted_number} convertido en factura ${invoiced.formattedNumber}`,
      companyId: company.id,
      userId: user.id,
      metadata: { estimateId, invoiceId: invoiced.invoiceId, formattedNumber: invoiced.formattedNumber },
    });

    revalidatePath('/historial');
    revalidatePath('/presupuestos');
    revalidatePath('/dashboard');
    revalidatePath('/nuevoPresupuesto');

    return {
      success: true,
      invoiceId: invoiced.invoiceId,
      formattedNumber: invoiced.formattedNumber,
      emailSent: invoiced.emailSent,
      verifactuQueued: invoiced.verifactuQueued,
    };
  } catch (error: any) {
    console.error('❌ ERROR CONVIRTIENDO PRESUPUESTO:', error);
    return { success: false, error: error?.message || 'No se pudo convertir el presupuesto en factura.' };
  }
}