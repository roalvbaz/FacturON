/**
 * Generación del PDF de factura EN EL SERVIDOR con @react-pdf/renderer.
 *
 * POR QUÉ: la vía anterior (html2pdf.js + html2canvas dentro de un iframe)
 * dependía de un CDN externo y del parseo de colores modernos (oklch/lab),
 * con lo que podía colgarse o fallar según la red y el navegador. Aquí el PDF
 * se dibuja como vectores puros desde los datos de la factura: sin DOM, sin
 * CDN y sin html2canvas → el render nunca se cuelga ni revienta con colores.
 *
 * LA PLANTILLA SE LEE: el PDF aplica la plantilla elegida en Configuración
 * (settings.template_id) igual que la previsualización en pantalla: colores,
 * estilo de cabecera/ltabla, pie y tipografía (ver `./pdfFonts.ts`).
 *
 * Uso (server-only): `renderInvoicePdfBuffer({ factura, empresa, settings })`
 */

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Image,
  renderToBuffer,
} from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { getTemplateById } from '@/lib/invoice-templates';
import { readableTextOn, readableTextOnGradient } from '@/lib/colorUtils';
import { ensurePdfFontsLoaded, resolvePdfFont } from '@/lib/pdf/pdfFonts';

// ─────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────

function eur(cents: number | string | null | undefined): string {
  const n = Math.round(Number(cents) || 0);
  return `${(n / 100).toFixed(2)} €`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-ES');
}

function isRectification(factura: any): boolean {
  return (
    factura?.series_code === 'R' ||
    String(factura?.formatted_number || '').startsWith('R-') ||
    Boolean(factura?.rectifies_invoice_id)
  );
}

/** Sube a base64(data URI) un logotipo remoto; si falla, devuelve null. */
async function embedLogo(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res: any = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res?.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null; // sin logo no se rompe el PDF
  }
}

/** QR de la factura como data URI (local, sin CORS ni red externa). */
async function buildQrDataUri(value: string | null | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  try {
    return await QRCode.toDataURL(value, { width: 176, margin: 1 });
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { padding: 34, color: '#0f172a' },
  header: {
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: 16,
    borderRadius: 4,
    marginBottom: 12,
  },
  headerLabel: { fontWeight: 'bold', fontSize: 17, marginBottom: 4 },
  headerMeta: { fontSize: 9, opacity: 0.9, lineHeight: 1.4 },
  logo: { maxHeight: 34, maxWidth: 140, marginBottom: 5, objectFit: 'contain' },
  rectBox: {
    flexDirection: 'row',
    backgroundColor: '#fef2f2',
    border: 1,
    borderColor: '#fecaca',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
  },
  rectTitle: { fontSize: 8, fontWeight: 'bold', color: '#dc2626', textTransform: 'uppercase' },
  rectText: { fontSize: 9, color: '#7f1d1d', marginTop: 2 },
  clientBox: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderLeftWidth: 4,
    borderLeftColor: '#4f46e5',
    padding: 10,
    marginBottom: 14,
  },
  clientLabel: { fontSize: 7.5, fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', marginBottom: 2 },
  clientName: { fontSize: 12, fontWeight: 'bold', color: '#0f172a', marginBottom: 2 },
  clientMeta: { fontSize: 9.5, color: '#475569' },
  table: { width: '100%', marginBottom: 14 },
  th: {
    padding: 5,
    fontSize: 8.5,
    fontWeight: 'bold',
    textAlign: 'left',
  },
  thR: { textAlign: 'right' },
  thC: { textAlign: 'center' },
  td: { padding: 5, fontSize: 9.5, color: '#0f172a', borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  tdR: { textAlign: 'right' },
  tdC: { textAlign: 'center' },
  tdMut: { color: '#475569' },
  tdBold: { fontWeight: 'bold' },
});

interface TotalsRow {
  label: string;
  value: string;
}

function buildTotals(factura: any): TotalsRow[] {
  const rows: TotalsRow[] = [{ label: 'Base Imponible', value: eur(factura.subtotal_cents) }];
  rows.push({ label: 'IVA Repercutido', value: eur(factura.vat_total_cents) });
  if (Number(factura.irpf_total_cents) > 0) {
    rows.push({ label: 'Retención IRPF', value: `-${eur(factura.irpf_total_cents)}` });
  }
  rows.push({ label: 'TOTAL', value: eur(factura.total_cents) });
  return rows;
}

function InvoicePdf({ factura, empresa, settings }: { factura: any; empresa: any; settings?: any }) {
  const rectification = isRectification(factura);
  const isEstimate = factura.__is_estimate === true;

  // ── PLANTILLA: se lee igual que en la previsualización en pantalla ──
  const template = settings?.template_id ? getTemplateById(settings.template_id) : null;

  const primaryColor = rectification
    ? '#dc2626'
    : (template?.accentColor || settings?.theme_color || empresa?.theme_color || '#4f46e5');
  const secondaryColor = template?.secondaryColor || primaryColor;

  const headerLayout = template?.headerLayout || 'classic';
  const headerStyle = template?.headerStyle || 'solid';
  const tableHeaderStyle = template?.tableHeaderStyle || 'filled';
  const showFooter = template ? template.showFooter !== false : true;

  const pdfFont = resolvePdfFont(template?.fontFamily);

  // Contraste garantizado (misma regla que el front): texto blanco u oscuro
  // según el fondo real de la cabecera.
  const headerTextColor =
    headerStyle === 'gradient' || headerStyle === 'split'
      ? readableTextOnGradient(primaryColor, secondaryColor)
      : readableTextOn(primaryColor);

  // react-pdf no soporta linear-gradient(): se simula con una franja de color
  // secundario — arriba para 'split', abajo para 'gradient'.
  const showTopStripe = headerStyle === 'split';
  const showBottomStripe = headerStyle === 'gradient';
  const stripe = {
    height: 3,
    backgroundColor: secondaryColor,
    marginHorizontal: 4,
    borderRadius: 2,
  };

  // Alineación de la cabecera según headerLayout.
  const centeredHeader = headerLayout === 'centered';
  const leftHeader = headerLayout === 'left';
  const metaTextAlign: 'left' | 'center' | 'right' = centeredHeader
    ? 'center'
    : leftHeader
      ? 'left'
      : 'right';
  const metaAlign: 'flex-start' | 'center' | 'flex-end' =
    metaTextAlign === 'right' ? 'flex-end' : metaTextAlign === 'center' ? 'center' : 'flex-start';

  // Cabeza de tabla según tableHeaderStyle.
  const tableThBg =
    tableHeaderStyle === 'filled' ? primaryColor
    : tableHeaderStyle === 'outlined' ? 'transparent'
    : '#f8fafc';
  const tableThColor =
    tableHeaderStyle === 'filled' ? readableTextOn(primaryColor)
    : tableHeaderStyle === 'outlined' ? primaryColor
    : '#475569';
  const tableThBorderColor =
    tableHeaderStyle === 'outlined' ? primaryColor
    : tableHeaderStyle === 'minimal' ? '#e2e8f0'
    : undefined;
  const tableThBorder =
    tableHeaderStyle === 'outlined' || tableHeaderStyle === 'minimal' ? 1 : 0;

  const lines = Array.isArray(factura.lines) ? factura.lines : [];
  const totals = buildTotals(factura);
  const qrUri = factura.__qr_data_uri as string | undefined;
  const logoUri = factura.__logo_data_uri as string | null | undefined;
  const white = '#ffffff';

  return (
    <Document>
      <Page
        size="A4"
        style={{
          ...styles.page,
          fontFamily: pdfFont,
          flexDirection: 'column',
          justifyContent: 'space-between', // ancla los totales + pie al final de la página
        }}
      >
        {/* SECCIÓN SUPERIOR: cabecera, cliente y conceptos */}
        <View>
        {/* Cabecera */}
        <View style={{ ...styles.header, backgroundColor: primaryColor }}>
          {showTopStripe && <View style={stripe} />}
          <View
            style={{
              flexDirection: centeredHeader ? 'column' : 'row',
              justifyContent: centeredHeader ? 'center' : 'space-between',
              alignItems: centeredHeader ? 'center' : 'flex-start',
              width: '100%',
            }}
          >
            <View
              style={{
                alignItems: centeredHeader ? 'center' : 'flex-start',
                textAlign: centeredHeader ? 'center' : 'left',
              }}
            >
              {logoUri && <Image src={{ uri: logoUri }} style={styles.logo} />}
              <Text style={{ ...styles.headerLabel, color: white }}>{empresa?.name || 'FacturON'}</Text>
              <Text style={{ ...styles.headerMeta, color: '#f1f5f9' }}>
                NIF: {empresa?.tax_id || '-'} · {empresa?.address || ''}
              </Text>
            </View>
            <View style={{ alignItems: metaAlign, textAlign: metaTextAlign }}>
              <Text style={{ ...styles.headerLabel, color: white, fontSize: rectification ? 14 : 20 }}>
                {isEstimate
                  ? 'PRESUPUESTO'
                  : rectification
                    ? 'FACTURA RECTIFICATIVA'
                    : 'FACTURA'}
              </Text>
              <Text style={{ ...styles.headerMeta, color: '#f1f5f9' }}>
                Nº: {factura.formatted_number}
              </Text>
              <Text style={{ ...styles.headerMeta, color: '#f1f5f9' }}>
                Fecha: {fmtDate(factura.issued_at)}
              </Text>
              {isEstimate ? (
                factura.expiry_date && (
                  <Text style={{ ...styles.headerMeta, color: '#f1f5f9' }}>
                    Validez: {fmtDate(factura.expiry_date)}
                  </Text>
                )
              ) : (
                factura.due_date && (
                  <Text style={{ ...styles.headerMeta, color: '#f1f5f9' }}>
                    Vence: {fmtDate(factura.due_date)}
                  </Text>
                )
              )}
            </View>
          </View>
          {showBottomStripe && <View style={stripe} />}
        </View>

        {rectification && !isEstimate && (
          <View style={styles.rectBox}>
            <View>
              <Text style={styles.rectTitle}>Documento de Rectificación (RD 1619/2012)</Text>
              <Text style={styles.rectText}>
                <Text style={{ fontWeight: 'bold' }}>Motivo: </Text>
                {factura.rectification_reason || 'R1 - Error fundado en derecho / rectificación de importes'}
              </Text>
            </View>
          </View>
        )}

        {/* Cliente */}
        <View style={{ ...styles.clientBox, borderLeftColor: primaryColor }}>
          <View>
            <Text style={styles.clientLabel}>{isEstimate ? 'PRESUPUESTO A:' : 'FACTURAR A:'}</Text>
            <Text style={styles.clientName}>{factura.client_name || 'Cliente General'}</Text>
            <Text style={styles.clientMeta}>NIF/CIF: {factura.client_tax_id || '-'}</Text>
            {factura.client_address && (
              <Text style={styles.clientMeta}>{factura.client_address}</Text>
            )}
          </View>
        </View>

        {/* Conceptos */}
        <View style={styles.table}>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: tableThBg,
              borderRadius: 2,
              border: tableThBorder,
              borderColor: tableThBorderColor,
            }}
          >
            <Text style={{ ...styles.th, ...{ color: tableThColor }, width: '44%' }}>CONCEPTO</Text>
            <Text style={{ ...styles.th, ...styles.thC, ...{ color: tableThColor }, width: '10%' }}>CANT.</Text>
            <Text style={{ ...styles.th, ...styles.thR, ...{ color: tableThColor }, width: '16%' }}>PRECIO UD.</Text>
            <Text style={{ ...styles.th, ...styles.thC, ...{ color: tableThColor }, width: '10%' }}>I.V.A.</Text>
            <Text style={{ ...styles.th, ...styles.thR, ...{ color: tableThColor }, width: '20%' }}>TOTAL</Text>
          </View>
          {lines.length === 0 ? (
            <View style={{ padding: 8 }}>
              <Text style={{ fontSize: 9, color: '#94a3b8', textAlign: 'center' }}>
                Sin conceptos registrados
              </Text>
            </View>
          ) : (
            lines.map((l: any, idx: number) => (
              <View key={idx} style={{ flexDirection: 'row' }}>
                <Text style={{ ...styles.td, width: '44%' }}>{l.description}</Text>
                <Text style={{ ...styles.td, ...styles.tdC, ...styles.tdMut, width: '10%' }}>
                  {Number(l.quantity || 1).toFixed(2)}
                </Text>
                <Text style={{ ...styles.td, ...styles.tdR, ...styles.tdMut, width: '16%' }}>
                  {eur(l.unit_price_cents)}
                </Text>
                <Text style={{ ...styles.td, ...styles.tdC, ...styles.tdMut, width: '10%' }}>
                  {Number(l.vat_percent || 0) > 0 ? `${Number(l.vat_percent)}%` : '—'}
                </Text>
                <Text style={{ ...styles.td, ...styles.tdR, ...styles.tdBold, width: '20%' }}>
                  {eur(l.total_amount_cents)}
                </Text>
              </View>
            ))
          )}
        </View>

        </View>

        {/* SECCIÓN INFERIOR: totales + pie anclados al fondo */}
        <View>
        {/* Totales */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 }}>
          <View style={{ width: '42%' }}>
            {totals.map((row, i) => {
              const isTotal = row.label === 'TOTAL';
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 1.5,
                    paddingHorizontal: 4,
                    borderTopWidth: isTotal ? 1.5 : 0,
                    borderTopColor: primaryColor,
                  }}
                >
                  <Text
                    style={{
                      fontSize: isTotal ? 11 : 9,
                      fontWeight: isTotal ? 'bold' : 'normal',
                      color: isTotal ? primaryColor : '#64748b',
                    }}
                  >
                    {row.label}:
                  </Text>
                  <Text
                    style={{
                      fontSize: isTotal ? 12 : 9,
                      fontWeight: 'bold' as any,
                      color: isTotal ? primaryColor : '#0f172a',
                    }}
                  >
                    {row.value}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Pie Veri*factu + QR (oculto en presupuestos) */}
        {isEstimate ? (
          <View style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#334155', marginBottom: 2 }}>
              Presupuesto sin compromiso
            </Text>
            <Text style={{ fontSize: 7.5, color: '#64748b', lineHeight: 1.35 }}>
              Al aceptarlo se emitirá la factura correspondiente. Si tiene dudas, contacte con {empresa?.name || 'su emisor'}.
            </Text>
            {showFooter && (
              <Text style={{ fontSize: 8, color: primaryColor, fontWeight: 'bold', marginTop: 3 }}>
                Generado con FacturON
              </Text>
            )}
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              borderTopWidth: 1,
              borderTopColor: '#e2e8f0',
              paddingTop: 8,
            }}
          >
            <View style={{ width: '78%', paddingRight: 10 }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#334155', marginBottom: 2 }}>
                Factura Verificada (Veri*factu)
              </Text>
              <Text style={{ fontSize: 7.5, color: '#64748b', lineHeight: 1.35 }}>
                Emitido al amparo del Reglamento que regula los requisitos de los sistemas informáticos de
                facturación (Real Decreto 1007/2023).
              </Text>
              {showFooter && (
                <Text style={{ fontSize: 8, color: primaryColor, fontWeight: 'bold', marginTop: 3 }}>
                  Generado de forma segura con FacturON
                </Text>
              )}
            </View>
            {qrUri ? (
              <Image src={{ uri: qrUri }} style={{ width: 44, height: 44 }} />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderWidth: 1,
                  borderColor: '#cbd5e1',
                  borderStyle: 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 6, color: '#94a3b8' }}>QR</Text>
              </View>
            )}
          </View>
        )}
        </View>
      </Page>
    </Document>
  );
}

// ─────────────────────────────────────────────────────────────
// Public API (server-only)
// ─────────────────────────────────────────────────────────────

export interface InvoicePdfInput {
  factura: any;
  empresa: any;
  settings?: any;
  documentType?: 'invoice' | 'estimate';
  expiryDate?: Date | string;
}

/**
 * Renderiza el PDF (Buffer). Monta el logo y el QR como data URIs locales y
 * devuelve un Buffer listo para base64. Nunca depende de html2canvas/CDN.
 *
 * @param documentType — 'estimate' genera un presupuesto (sin QR, sin Veri*factu, con
 *   "PRESUPUESTO" como título).
 */
export async function renderInvoicePdfBuffer({
  factura,
  empresa,
  settings,
  documentType,
  expiryDate,
}: InvoicePdfInput): Promise<Buffer> {
  // Fuentes web de plantilla (best-effort con timeout: si la red falla, se
  // usa la fuente estándar del mismo género y el PDF se genera igualmente).
  await ensurePdfFontsLoaded();

  const isEstimate = documentType === 'estimate';

  const facturaForPdf = {
    ...factura,
    // Para estimate: no generar QR ni pagar por el fetch innecesario
    __logo_data_uri: await embedLogo(settings?.logo_url || empresa?.logo_url),
    __qr_data_uri: isEstimate ? undefined : await buildQrDataUri(factura?.qr_code_url),
    // Inyectar flags y campos de presupuesto
    __is_estimate: isEstimate,
    expiry_date: isEstimate && expiryDate ? expiryDate : factura.expiry_date,
  };

  // `renderToBuffer` acepta un elemento React; se renderiza dentro del
  // propio watchdog de @react-pdf (sin timers que cuelguen al navegador).
  return renderToBuffer(
    <InvoicePdf factura={facturaForPdf} empresa={empresa} settings={settings} />
  );
}