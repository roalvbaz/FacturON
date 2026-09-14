'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  createEstimateAction,
  updateEstimateAction,
  sendEstimateAction,
  getEstimateDetailAction,
} from '@/actions/estimate.actions';
import { getActiveCompanyAction, getCompanyCustomersAction } from '@/actions/invoice.actions';
import { getActiveCompanySettings } from '@/actions/company.actions';
import { createProductAction } from '@/actions/product.actions';
import { showToast } from '@/lib/utils/toast';
import InvoicePDFTemplate from '@/components/invoicePDFTemplate';
import { ProductCatalogSelector } from '@/components/productCatalogSelector';
import { CustomerSelector } from '@/components/customerSelector';
import { PackagePlus, Eye, Send, Save, Users } from 'lucide-react';

const DEFAULT_LINE = { description: '', quantity: 1, unit_price: 0, vat_rate: 21, saved: false };

export default function EstimateForm({ mode, estimateId }: { mode: 'new' | 'edit'; estimateId?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [empresa, setEmpresa] = useState<{ id?: string; name: string; nif: string; address: string }>({
    name: 'Cargando empresa...', nif: '', address: '',
  });
  const [templateId, setTemplateId] = useState<string>('clasico-tradicional');
  const [customerList, setCustomerList] = useState<Array<any>>([]);

  const [suggestions, setSuggestions] = useState<Array<any>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const customerInputRef = useRef<HTMLDivElement>(null);

  const [clientName, setClientName] = useState('');
  const [clientTaxId, setClientTaxId] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');

  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [globalVat, setGlobalVat] = useState(21);
  const [lines, setLines] = useState([{ ...DEFAULT_LINE }]);

  // Modo edición
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [clientNote, setClientNote] = useState<string | null>(null);

  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Fecha de validez por defecto: hoy + 30 días.
  const defaultExpiry = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [compRes, custRes, settingsRes] = await Promise.all([
          getActiveCompanyAction(),
          getCompanyCustomersAction(),
          getActiveCompanySettings(),
        ]);
        if (compRes?.company) {
          setEmpresa({
            id: compRes.company.id,
            name: compRes.company.name,
            nif: compRes.company.tax_id || '',
            address: compRes.company.address || '',
          });
        }
        if (custRes?.customers) setCustomerList(custRes.customers);
        if (settingsRes?.template_id) setTemplateId(settingsRes.template_id);

        setExpiryDate(defaultExpiry());

        // Modo edición: cargar el presupuesto existente.
        if (mode === 'edit' && estimateId) {
          const res: any = await getEstimateDetailAction(estimateId);
          if (res.success) {
            const e = res.estimate;
            setCurrentStatus(e.status);
            setClientNote(e.client_note || null);
            setNotes(e.notes || '');
            if (e.expiry_date) setExpiryDate(new Date(e.expiry_date).toISOString().split('T')[0]);
            if (e.customer) {
              setClientName(e.customer.name || '');
              setClientTaxId(e.customer.tax_id || '');
              setClientEmail(e.customer.email || '');
              setClientAddress(e.customer.address || '');
            }
            if (e.lines && e.lines.length > 0) {
              setLines(
                e.lines.map((l: any) => ({
                  description: l.description || '',
                  quantity: l.quantity ?? 1,
                  unit_price: (Number(l.unit_price_cents) || 0) / 100,
                  vat_rate: Number(l.vat_percent) || 21,
                  saved: true,
                }))
              );
            }
          } else {
            showToast.error(res.error || 'No se pudo cargar el presupuesto.');
          }
        }
      } catch (err) {
        console.error('Error al cargar datos:', err);
      } finally {
        setLoaded(true);
      }
    }
    loadData();
  }, [mode, estimateId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (customerInputRef.current && !customerInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCustomerInputChange = (value: string) => {
    setClientName(value);
    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const filtered = customerList.filter(
      (c) =>
        c.name?.toLowerCase().includes(value.toLowerCase()) ||
        c.tax_id?.toLowerCase().includes(value.toLowerCase())
    );
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
  };

  const handleSelectCustomer = (selected: any) => {
    setClientName(selected.name || '');
    setClientTaxId(selected.tax_id || '');
    setClientEmail(selected.email || '');
    setClientAddress(selected.address || '');
    setShowSuggestions(false);
    showToast.success(`Cliente ${selected.name} cargado`);
  };

  const handleClearCustomer = () => {
    setClientName('');
    setClientTaxId('');
    setClientEmail('');
    setClientAddress('');
    setSuggestions([]);
    setShowSuggestions(false);
    setClientNote(null);
    showToast.info('Datos del cliente limpiados');
  };

  const handleSelectProductFromCatalog = (product: any) => {
    setLines((prev) => {
      if (prev.length === 1 && !prev[0].description.trim() && Number(prev[0].unit_price) === 0) {
        return [{
          description: product.description || product.name,
          quantity: 1,
          unit_price: product.unitPrice || product.price || 0,
          vat_rate: product.vatPercent || product.default_vat || 21,
          saved: true,
        }];
      }
      return [...prev, {
        description: product.description || product.name,
        quantity: 1,
        unit_price: product.unitPrice || product.price || 0,
        vat_rate: product.vatPercent || product.default_vat || 21,
        saved: true,
      }];
    });
    showToast.success('Concepto insertado desde el catálogo');
  };

  const handleQuickSaveProduct = async (index: number) => {
    const line = lines[index];
    if (!line.description) return;
    const formData = new FormData();
    formData.append('name', line.description);
    formData.append('price', String(line.unit_price));
    formData.append('default_vat', String(line.vat_rate));
    const res = await createProductAction(formData);
    if (res.success) {
      showToast.success('Concepto guardado en el catálogo');
      const newLines = [...lines];
      newLines[index].saved = true;
      setLines(newLines);
    } else {
      showToast.error(res.error || 'Error al guardar en catálogo');
    }
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    if (field === 'description' || field === 'unit_price') {
      newLines[index].saved = false;
    }
    setLines(newLines);
  };

  const addLine = () => {
    setLines([...lines, { ...DEFAULT_LINE, vat_rate: globalVat }]);
  };

  const removeLine = (index: number) => {
    if (lines.length === 1) {
      setLines([{ ...DEFAULT_LINE, vat_rate: globalVat }]);
      return;
    }
    setLines(lines.filter((_, i) => i !== index));
  };

  const subtotal = lines.reduce((acc, l) => acc + (parseFloat(String(l.quantity)) || 0) * (parseFloat(String(l.unit_price)) || 0), 0);
  const vatTotal = lines.reduce((acc, l) => {
    const lineSub = (parseFloat(String(l.quantity)) || 0) * (parseFloat(String(l.unit_price)) || 0);
    const vatRate = parseFloat(String(l.vat_rate)) || globalVat;
    return acc + (lineSub * (vatRate / 100));
  }, 0);
  const total = subtotal + vatTotal;

  const validateForm = () => {
    if (!expiryDate || !expiryDate.trim()) {
      showToast.error('Debes indicar la Fecha de Validez del presupuesto.');
      return false;
    }
    if (!clientName.trim()) {
      showToast.error('Debes indicar el Nombre o Razón Social del cliente.');
      return false;
    }
    if (!clientTaxId.trim()) {
      showToast.error('Debes indicar el NIF / CIF del cliente.');
      return false;
    }
    if (!clientEmail.trim()) {
      showToast.error('Debes indicar el Correo Electrónico del cliente.');
      return false;
    }
    if (lines.length === 0) {
      showToast.error('El presupuesto debe tener al menos una línea de concepto.');
      return false;
    }
    const lineaInvalida = lines.find(
      (l) => !l.description || !l.description.trim() || Number(l.quantity) === 0
    );
    if (lineaInvalida) {
      showToast.error('Todas las líneas deben tener una descripción y una cantidad válida distinta de 0.');
      return false;
    }
    return true;
  };

  const buildPayload = () => ({
    customerData: {
      nombre: clientName.trim(),
      nif: clientTaxId.trim(),
      email: clientEmail.trim(),
      direccion: clientAddress.trim(),
    },
    expiryDate,
    notes,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      vat_rate: l.vat_rate,
    })),
  });

  const saveEstimate = async (sendAfter: boolean) => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      const payload = buildPayload();
      const savedRes: any =
        mode === 'edit' && estimateId
          ? await updateEstimateAction(estimateId, payload)
          : await createEstimateAction(payload);

      if (!savedRes.success) {
        showToast.error(savedRes.error || 'Error al guardar el presupuesto.');
        return;
      }

      if (sendAfter) {
        const sent = await sendEstimateAction(savedRes.estimateId);
        if (!sent.success) {
          showToast.error(
            `Presupuesto guardado, pero no se pudo enviar: ${sent.error || ''}`
          );
          router.push('/historial');
          return;
        }
        showToast.success(`Presupuesto ${savedRes.formattedNumber} guardado y enviado a ${sent.emailedTo}`);
      } else {
        showToast.success(`Presupuesto ${savedRes.formattedNumber} guardado en borrador`);
      }
      router.push('/historial');
    } catch (err: any) {
      showToast.error(err.message || 'Error al guardar el presupuesto.');
    } finally {
      setLoading(false);
    }
  };

  const previewFactura = {
    id: mode === 'edit' && estimateId ? estimateId : 'preview-id',
    formatted_number: 'P-2026-XXXX',
    issued_at: new Date().toISOString(),
    expiry_date: expiryDate || undefined,
    client_name: clientName || 'Cliente General',
    client_tax_id: clientTaxId || '-',
    client_address: clientAddress || '-',
    lines: lines.map((l) => {
      const qty = parseFloat(String(l.quantity)) || 0;
      const unitPrice = parseFloat(String(l.unit_price)) || 0;
      const vatRate = parseFloat(String(l.vat_rate)) || globalVat;
      const lineSub = qty * unitPrice;
      const lineTotal = lineSub * (1 + vatRate / 100);
      return {
        description: l.description || 'Concepto sin descripción',
        quantity: l.quantity,
        unit_price_cents: Math.round(unitPrice * 100),
        vat_percent: vatRate,
        total_amount_cents: Math.round(lineTotal * 100),
      };
    }),
    subtotal_cents: Math.round(subtotal * 100),
    vat_total_cents: Math.round(vatTotal * 100),
    total_cents: Math.round(total * 100),
  };

  const editingModification = mode === 'edit' && currentStatus === 'Modificación solicitada';

  return (
    <div style={{ maxWidth: '1300px', margin: '0 auto', paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-color)', margin: '0 0 2px 0' }}>
            {mode === 'edit' ? `Editar Presupuesto` : 'Nuevo Presupuesto'}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {mode === 'edit'
              ? 'Modifica el presupuesto y vuelve a enviarlo con un enlace renovado.'
              : 'Crea un presupuesto editable; al enviarlo tus cliente recibe un enlace para aceptarlo o pedir cambios.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="btn"
            style={{
              background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)',
              fontWeight: 600, fontSize: '0.85rem', padding: '0.4rem 0.9rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}
          >
            <Eye style={{ width: '15px', height: '15px', color: 'var(--primary)' }} />
            <span>Vista Previa</span>
          </button>
          <button
            type="button"
            onClick={() => saveEstimate(true)}
            disabled={loading}
            className="btn btn-primary"
            style={{ fontWeight: 600, fontSize: '0.85rem', padding: '0.4rem 0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send style={{ width: '15px', height: '15px' }} />
            <span>Guardar y Enviar</span>
          </button>
        </div>
      </div>

      {/* Banner al editar un presupuesto con cambios solicitados por el cliente */}
      {editingModification && clientNote && (
        <div style={{
          padding: '12px 16px', borderRadius: '10px', marginBottom: '1rem',
          backgroundColor: 'rgba(234,88,12,0.1)', border: '1px solid rgba(234,88,12,0.4)', color: 'var(--text-color)',
          display: 'flex', gap: '12px', alignItems: 'flex-start',
        }}>
          <i className="fas fa-exclamation-triangle" style={{ color: '#ea580c', marginTop: '3px' }}></i>
          <div>
            <strong style={{ color: '#ea580c', fontSize: '0.85rem' }}>El cliente solicitó cambios</strong>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              “{clientNote}” — al guardar, el presupuesto volverá a Borrador y deberás reenviarlo.
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); saveEstimate(true); }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {/* BLOQUE 1: Nº Y VALIDEZ */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Nº Presupuesto
              </label>
              <input
                type="text"
                value="Automático (al guardar)"
                disabled
                className="form-control"
                style={{ backgroundColor: 'var(--bg-color)', opacity: 0.8, cursor: 'not-allowed', height: '42px', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Fecha Emisión (Hoy)
              </label>
              <input
                type="text"
                value={new Date().toLocaleDateString('es-ES')}
                disabled
                className="form-control"
                style={{ backgroundColor: 'var(--bg-color)', opacity: 0.8, cursor: 'not-allowed', height: '42px', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Fecha de Validez <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="form-control"
                style={{ height: '42px', fontSize: '0.85rem' }}
                required
              />
            </div>
          </div>
        </div>

        {/* BLOQUE 2: CLIENTE */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-color)', margin: 0 }}>
              Cliente (Presupuesto a)
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '6px' }}>
                El email es necesario para enviar el enlace de aceptación.
              </span>
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {clientName && (
                <button type="button" onClick={handleClearCustomer} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', minHeight: '32px' }} title="Limpiar cliente">
                  <i className="fas fa-eraser"></i> Limpiar
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(true)}
                className="btn"
                style={{ fontSize: '0.8rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', borderRadius: '6px' }}
              >
                <Users style={{ width: '14px', height: '14px' }} />
                <span>Directorio Completo</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div ref={customerInputRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={clientName}
                onChange={(e) => handleCustomerInputChange(e.target.value)}
                placeholder="Nombre o Razón Social *"
                className="form-control"
                style={{ height: '36px', fontSize: '0.85rem' }}
                required
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '8px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)', zIndex: 50, maxHeight: '220px', overflowY: 'auto',
                }}>
                  {suggestions.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleSelectCustomer(c)}
                      style={{
                        padding: '8px 12px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: '2px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-color)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--card-bg)')}
                    >
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-color)' }}>{c.name}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.tax_id ? `NIF: ${c.tax_id}` : 'Sin NIF'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <input type="text" value={clientTaxId} onChange={(e) => setClientTaxId(e.target.value)} placeholder="NIF / CIF *" className="form-control" style={{ height: '36px', fontSize: '0.85rem' }} required />
            </div>
            <div>
              <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Correo Electrónico *" className="form-control" style={{ height: '36px', fontSize: '0.85rem' }} required />
            </div>
            <div>
              <input type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Dirección Fiscal" className="form-control" style={{ height: '36px', fontSize: '0.85rem' }} />
            </div>
          </div>
        </div>

        {/* BLOQUE 3: CONCEPTOS */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-color)', margin: 0 }}>Conceptos</h3>
            <button
              type="button"
              onClick={() => setIsCatalogOpen(true)}
              className="btn"
              style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              <PackagePlus style={{ width: '14px', height: '14px' }} />
              <span>+ Insertar del Catálogo</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {lines.map((line, index) => {
              const lineSubtotal = (parseFloat(String(line.quantity)) || 0) * (parseFloat(String(line.unit_price)) || 0);
              const lineVatAmount = lineSubtotal * ((parseFloat(String(line.vat_rate)) || globalVat) / 100);
              const lineTotal = lineSubtotal + lineVatAmount;

              return (
                <div key={index} className="invoice-line-grid">
                  <div>
                    <input type="text" value={line.description} onChange={(e) => handleLineChange(index, 'description', e.target.value)} placeholder="Descripción del producto/servicio" className="form-control" style={{ height: '34px', fontSize: '0.85rem', width: '100%' }} required />
                  </div>
                  <div data-label="Cantidad">
                    <input type="number" step="any" value={line.quantity} onChange={(e) => handleLineChange(index, 'quantity', e.target.value)} className="form-control" style={{ height: '34px', fontSize: '0.85rem' }} required />
                  </div>
                  <div data-label="Precio">
                    <input type="number" step="0.01" value={line.unit_price} onChange={(e) => handleLineChange(index, 'unit_price', e.target.value)} placeholder="Precio" className="form-control" style={{ height: '34px', fontSize: '0.85rem' }} required />
                  </div>
                  <div data-label="IVA">
                    <select value={line.vat_rate} onChange={(e) => handleLineChange(index, 'vat_rate', e.target.value)} className="form-control" style={{ height: '34px', fontSize: '0.8rem', padding: '0 4px' }}>
                      <option value="21">General (21%)</option>
                      <option value="10">Reducido (10%)</option>
                      <option value="4">Superreducido (4%)</option>
                      <option value="0">IVA general de la factura</option>
                    </select>
                  </div>
                  <div data-label="Total" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem', paddingRight: '4px', color: 'var(--text-color)' }}>
                    {lineTotal.toFixed(2)} €
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                    {!line.saved && line.description.trim() !== '' && (
                      <button type="button" onClick={() => handleQuickSaveProduct(index)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '1.1rem', minHeight: '44px', minWidth: '44px' }} title="Guardar este concepto en el catálogo">
                        <i className="fas fa-save"></i>
                      </button>
                    )}
                    <button type="button" onClick={() => removeLine(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', minHeight: '44px', minWidth: '44px' }} title="Vaciar/Eliminar línea">
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" onClick={addLine} className="btn" style={{ background: 'var(--bg-color)', border: '1px dashed var(--border-color)', color: 'var(--text-color)', fontWeight: 600, fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
            + Añadir Línea Libre
          </button>
        </div>

        {/* BLOQUE 4: IVA, TOTALES Y NOTAS */}
        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                IVA GENERAL (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={globalVat}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setGlobalVat(Math.max(0, Math.min(100, isNaN(val) ? 0 : val)));
                }}
                className="form-control"
                style={{ width: '80px', textAlign: 'center', height: '36px', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ flexGrow: 1, minWidth: '280px' }}>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Notas para el presupuesto
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="form-control"
                placeholder="Condiciones, plazos de entrega, observaciones…"
                style={{ fontSize: '0.85rem', resize: 'vertical' }}
              />
            </div>
          </div>

          <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>Base Imponible:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{subtotal.toFixed(2)} €</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>IVA Repercutido:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>+{vatTotal.toFixed(2)} €</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--border-color)', paddingTop: '6px', fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-color)', marginTop: '2px' }}>
              <span>Total Final:</span>
              <span>{total.toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* PIE: ACCIONES */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => saveEstimate(false)}
            disabled={loading}
            className="btn"
            style={{
              background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)',
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: '6px',
              display: 'flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <Save style={{ width: '15px', height: '15px' }} />
            <span>Guardar Borrador</span>
          </button>
          <button
            type="button"
            onClick={() => saveEstimate(true)}
            disabled={loading}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 1.15rem', fontSize: '0.85rem', fontWeight: 700 }}
          >
            {loading ? <i className="fas fa-spinner fa-spin"></i> : <Send style={{ width: '15px', height: '15px' }} />}
            <span>Guardar y Enviar</span>
          </button>
        </div>
      </form>

      {/* VISOR DE VISTA PREVIA */}
      {isPreviewOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 2147483647, backgroundColor: 'var(--bg-color)', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            backgroundColor: 'var(--card-bg)', padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
          }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-color)', fontWeight: 800 }}>
              Vista previa del presupuesto
            </h3>
            <button type="button" onClick={() => setIsPreviewOpen(false)} style={{ background: 'none', border: 'none', fontSize: '2.2rem', cursor: 'pointer', color: '#64748b', lineHeight: '1rem', padding: '0 5px' }} title="Cerrar">
              &times;
            </button>
          </div>
          <div style={{ flexGrow: 1, overflowY: 'auto', padding: '2rem', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: '900px' }}>
              {loaded ? (
                <InvoicePDFTemplate factura={previewFactura} empresa={empresa} settings={{ template_id: templateId }} templateId={templateId} isEstimate />
              ) : (
                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.6rem' }}></i>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ProductCatalogSelector
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectProduct={handleSelectProductFromCatalog}
      />

      <CustomerSelector
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        customers={customerList}
        onSelectCustomer={handleSelectCustomer}
      />
    </div>
  );
}