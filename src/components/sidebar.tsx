'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, useEffect } from 'react';
import { signOut } from '@/app/actions/auth';
import CompanySelector from '@/components/companySelector';

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#94a3b8',
        borderRadius: '8px',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        flexShrink: 0,
      }}
    >
      <i className={`fas ${isDark ? 'fa-sun' : 'fa-moon'}`} style={{ fontSize: '0.85rem' }}></i>
    </button>
  );
}

export default function Sidebar({
  companies,
  activeCompanyId,
  nombreEmpresa,
  emailUsuario,
  isAdmin,
  isOpen,
}: {
  companies: Array<{ id: string; name: string; tax_id: string; role: string }>;
  activeCompanyId: string;
  nombreEmpresa: string;
  emailUsuario: string;
  isAdmin?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname?.startsWith(path);

  // Estilo base para los enlaces
  const linkStyle = (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    borderRadius: '8px',
    textDecoration: 'none',
    fontWeight: active ? 600 : 500,
    fontSize: '0.875rem',
    backgroundColor: active ? 'rgba(14,165,233,0.15)' : 'transparent',
    color: active ? '#38bdf8' : '#94a3b8',
    transition: 'all 0.15s ease-in-out',
    borderLeft: active ? '3px solid #0ea5e9' : '3px solid transparent',
    paddingLeft: active ? '11px' : '14px',
  });

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    padding: '16px 14px 6px',
    margin: 0,
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} style={{
      width: '260px',
      height: '100vh',
      backgroundColor: '#080f1a',
      color: '#94a3b8',
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      transition: 'background-color 0.2s ease',
      flexShrink: 0,
    }}>

{/* Cabecera: Logo + Empresa */}
      <div style={{ padding: '1.25rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
            <div style={{
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              color: '#ffffff',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(14,165,233,0.3)',
            }}>
              <i className="fas fa-building"></i>
            </div>
            <div style={{ overflow: 'hidden' }}>
              <h2 style={{
                margin: 0,
                fontSize: '0.95rem',
                fontWeight: 700,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: '1.2',
              }}>
                {nombreEmpresa}
              </h2>
              <span style={{ fontSize: '0.7rem', color: '#475569' }}>Panel de control</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <ThemeToggle />
            <Link
              href="/configuracion"
              title="Configuración"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isActive('/configuracion') ? 'rgba(14,165,233,0.15)' : 'rgba(255,255,255,0.06)',
                color: isActive('/configuracion') ? '#38bdf8' : '#64748b',
                textDecoration: 'none',
                transition: 'all 0.15s ease-in-out',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <i className="fas fa-cog" style={{ fontSize: '0.8rem' }}></i>
            </Link>
          </div>
        </div>
      </div>

      {/* Selector de empresa */}
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <CompanySelector companies={companies} activeCompanyId={activeCompanyId} />
      </div>

{/* Menú de navegación */}
      <nav style={{ flexGrow: 1, padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Sección: Principal */}
        <p style={sectionLabel}>Principal</p>
        <Link href="/dashboard" style={linkStyle(isActive('/dashboard'))}>
          <i className="fas fa-chart-pie" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Dashboard
        </Link>
        <Link href="/nuevoPresupuesto" style={linkStyle(isActive('/nuevoPresupuesto'))}>
          <i className="fas fa-file-signature" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Nuevo Presupuesto
        </Link>
        <Link href="/presupuestos" style={linkStyle(isActive('/presupuestos'))}>
          <i className="fas fa-file-invoice-dollar" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Presupuestos
        </Link>
        <Link href="/historial" style={linkStyle(isActive('/historial'))}>
          <i className="fas fa-list" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Historial
        </Link>

        {/* Sección: Directorio */}
        <p style={sectionLabel}>Directorio</p>
        <Link href="/clientes" style={linkStyle(isActive('/clientes'))}>
          <i className="fas fa-users" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Clientes
        </Link>
        <Link href="/productos" style={linkStyle(isActive('/productos'))}>
          <i className="fas fa-box" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Productos
        </Link>
        <Link href="/gastos" style={linkStyle(isActive('/gastos'))}>
          <i className="fas fa-receipt" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Gastos
        </Link>

        {/* Sección: Empresa */}
        <p style={sectionLabel}>Empresa</p>
        <Link href="/empresas" style={linkStyle(isActive('/empresas'))}>
          <i className="fas fa-building" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Mis Empresas
        </Link>
        {isAdmin && (
          <Link href="/invitaciones" style={linkStyle(isActive('/invitaciones'))}>
            <i className="fas fa-envelope-open-text" style={{ width: '20px', textAlign: 'center', fontSize: '0.9rem' }}></i> Invitaciones
          </Link>
        )}
      </nav>

      {/* Pie del sidebar */}
      <div style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <p style={{
          margin: '0 0 0.75rem 0',
          fontSize: '0.75rem',
          color: '#64748b',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '0 4px',
        }} title={emailUsuario}>
          {emailUsuario}
        </p>
        <form action={signOut} style={{ width: '100%', margin: 0 }}>
          <button type="submit" style={{
            width: '100%',
            padding: '9px',
            backgroundColor: 'rgba(239,68,68,0.1)',
            color: '#f87171',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontWeight: 600,
            fontSize: '0.8rem',
            transition: 'all 0.2s',
          }}>
            <i className="fas fa-sign-out-alt" style={{ fontSize: '0.8rem' }}></i> Cerrar Sesión
          </button>
        </form>
      </div>

    </aside>
  );
}
