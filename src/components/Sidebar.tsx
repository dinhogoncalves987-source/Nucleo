import { useState, useEffect, useCallback } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, Bot, Zap, Plug, ShieldCheck, Network,
  LogOut, ChevronLeft, ChevronRight, Sun, Moon, Cpu, BrainCircuit, Radio, FlaskConical,
  Menu, X, Store, UserCheck, Megaphone, MessageCircle
} from 'lucide-react'

import { useTenant } from '../contexts/TenantContext'
import { useTheme } from '../contexts/ThemeContext'

// ── Área Operacional (todos veem) ──
const navItems = [
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/estabelecimentos',  icon: Store,           label: 'Estabelecimentos' },
  { to: '/clientes',          icon: UserCheck,       label: 'Clientes' },
  { to: '/leads',             icon: Users,           label: 'Leads' },
  { to: '/campanhas',         icon: Megaphone,       label: 'Campanhas' },
  { to: '/atendimento',       icon: MessageCircle,   label: 'Atendimento' },
]


// O Núcleo Emblem Component
function NucleoEmblem({ size = 36 }: { size?: number }) {
  const orbitSize1 = size * 1.44
  const orbitSize2 = size * 1.22

  return (
    <div className="nucleo-emblem flex-shrink-0" style={{ width: orbitSize1, height: orbitSize1 }}>
      {/* Outer orbit */}
      <div
        className="orbit orbit-1 absolute"
        style={{ width: orbitSize1, height: orbitSize1, top: 0, left: 0 }}
      />
      {/* Inner orbit */}
      <div
        className="orbit orbit-2 absolute"
        style={{
          width: orbitSize2,
          height: orbitSize2,
          top: (orbitSize1 - orbitSize2) / 2,
          left: (orbitSize1 - orbitSize2) / 2,
        }}
      />
      {/* Core sphere */}
      <div
        className="core absolute"
        style={{
          width: size,
          height: size,
          top: (orbitSize1 - size) / 2,
          left: (orbitSize1 - size) / 2,
        }}
      >
        <span className="core-letter">N</span>
      </div>
    </div>
  )
}

// ── Mobile Menu Button (exportado para o AppLayout usar) ──────────
export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
      style={{
        background: 'var(--surface-hover)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
      aria-label="Menu"
    >
      <Menu size={18} />
    </button>
  )
}

export default function Sidebar() {
  const { user, logout } = useTenant()
  const { toggleTheme, isDark } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Fechar sidebar mobile ao navegar
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Fechar sidebar mobile ao redimensionar para desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setMobileOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleLogout = () => { logout(); navigate('/') }

  // Exportar toggle como callback estável
  const toggleMobile = useCallback(() => setMobileOpen(prev => !prev), [])

  // Guardar toggle na sidebar para o AppLayout acessar
  ;(Sidebar as SidebarComponent).__toggleMobile = toggleMobile

  return (
    <>
    {/* Overlay backdrop (mobile only) */}
    {mobileOpen && (
      <div
        className="fixed inset-0 z-40 md:hidden"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={() => setMobileOpen(false)}
      />
    )}

    <aside
      className={`flex flex-col ${collapsed ? 'w-[64px]' : 'w-[220px]'} min-h-screen flex-shrink-0 transition-all duration-300 ease-in-out
        fixed md:relative z-50 md:z-auto
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
      style={{
        background: 'var(--surface-card)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Header — O Núcleo identity */}
      <div
        className="flex items-center gap-3 px-4 py-4 min-h-[72px]"
        style={{
          background: 'var(--gradient-sidebar-header)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <NucleoEmblem size={collapsed ? 28 : 32} />

        {!collapsed && (
          <div className="overflow-hidden ml-1">
            <p
              className="font-black text-sm leading-tight truncate tracking-tight"
              style={{ color: 'var(--accent)', textShadow: '0 0 12px rgba(0,180,255,0.5)' }}
            >
              O NÚCLEO
            </p>
          </div>
        )}
      </div>

      {/* James Status Bar */}
      {!collapsed && (
        <div
          className="mx-3 mt-3 px-3 py-2 rounded-xl flex items-center gap-2"
          style={{
            background: 'rgba(0,180,255,0.06)',
            border: '1px solid rgba(0,180,255,0.12)',
          }}
        >
          <Cpu size={13} style={{ color: 'var(--accent)' }} />
          <div className="james-online flex-1 truncate">General Online</div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5 mt-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => isActive
              ? { background: 'var(--accent-muted)', color: 'var(--accent)' }
              : { color: 'var(--text-muted)' }
            }
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group"
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className="flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                {!collapsed && (
                  <span className="truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {label}
                  </span>
                )}
                {isActive && !collapsed && (
                  <div
                    className="ml-auto w-1 h-4 rounded-full flex-shrink-0"
                    style={{
                      background: 'var(--accent)',
                      boxShadow: '0 0 8px var(--accent)',
                    }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Admin — Telas técnicas + configuração */}
        {user?.role === 'superadmin' && (
          <>
            <div className="mx-2 my-2" style={{ height: '1px', background: 'var(--border)' }} />
            <p className={`px-3 text-[10px] font-bold uppercase tracking-widest mb-1 ${collapsed ? 'hidden' : ''}`}
               style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Admin</p>
            {[
              { to: '/james',                icon: Bot,          label: 'James 3D',       color: 'var(--accent)' },
              { to: '/james-training',       icon: BrainCircuit, label: 'James Training', color: 'var(--accent)' },
              { to: '/intel',                icon: FlaskConical, label: 'James Intel',    color: 'var(--accent)' },
              { to: '/chip-control',         icon: Radio,        label: 'Chip Control',   color: 'var(--accent)' },
              { to: '/settings/integrations',icon: Plug,         label: 'Conexões',       color: 'var(--accent)' },
              { to: '/activations',          icon: Zap,          label: 'Viralizador (legacy)', color: 'var(--text-muted)' },
            ].map(({ to, icon: Icon, label, color }) => (
              <NavLink
                key={to}
                to={to}
                style={({ isActive }) => isActive
                  ? { background: 'rgba(0,180,255,0.08)', color }
                  : { color: 'var(--text-muted)' }
                }
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
              >
                {({ isActive }) => (
                  <>
                    <Icon size={15} className="flex-shrink-0" style={{ color: isActive ? color : 'var(--text-muted)' }} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </>
                )}
              </NavLink>
            ))}
            <div className="mx-2 my-1" style={{ height: '1px', background: 'var(--border)', opacity: 0.5 }} />
            <NavLink
              to="/admin/projects"
              style={({ isActive }) => isActive
                ? { background: 'rgba(212,160,23,0.10)', color: 'var(--gold)' }
                : { color: 'var(--text-muted)' }
              }
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <ShieldCheck size={15} className="flex-shrink-0" style={{ color: isActive ? 'var(--gold)' : 'var(--text-muted)' }} />
                  {!collapsed && <span className="truncate">SuperAdmin</span>}
                </>
              )}
            </NavLink>
            <NavLink
              to="/admin/affiliates"
              style={({ isActive }) => isActive
                ? { background: 'rgba(16,185,129,0.10)', color: '#34d399' }
                : { color: 'var(--text-muted)' }
              }
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Network size={15} className="flex-shrink-0" style={{ color: isActive ? '#34d399' : 'var(--text-muted)' }} />
                  {!collapsed && <span className="truncate">Afiliados</span>}
                </>
              )}
            </NavLink>
            <NavLink
              to="/admin/chips"
              style={({ isActive }) => isActive
                ? { background: 'rgba(0,180,255,0.10)', color: 'var(--accent)' }
                : { color: 'var(--text-muted)' }
              }
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Radio size={15} className="flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                  {!collapsed && <span className="truncate">Chips Monitor</span>}
                </>
              )}
            </NavLink>
            <NavLink
              to="/admin/queue"
              style={({ isActive }) => isActive
                ? { background: 'rgba(124,58,237,0.10)', color: '#a78bfa' }
                : { color: 'var(--text-muted)' }
              }
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Cpu size={15} className="flex-shrink-0" style={{ color: isActive ? '#a78bfa' : 'var(--text-muted)' }} />
                  {!collapsed && <span className="truncate">Queue Monitor</span>}
                </>
              )}
            </NavLink>
          </>
        )}
      </nav>

      {/* Neon divider */}
      <div className="mx-3 mb-3 accent-line" />

      {/* Bottom */}
      <div className="px-2 pb-4 flex flex-col gap-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 w-full group"
          style={{ color: 'var(--text-muted)' }}
        >
          {isDark
            ? <Sun size={16} style={{ color: 'var(--gold)' }} />
            : <Moon size={16} style={{ color: 'var(--accent)' }} />
          }
          {!collapsed && (
            <span style={{ color: 'var(--text-muted)' }}>
              {isDark ? 'Light Mode' : 'Dark Mode'}
            </span>
          )}
        </button>

        {/* User info */}
        {!collapsed && (
          <div className="px-3 py-2 rounded-xl my-1" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-main)' }}>
              {user?.email ?? 'admin@nucleo.com'}
            </p>
            <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
              {user?.role ?? 'commander'}
            </p>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 w-full"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.07)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <LogOut size={16} className="flex-shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>

      {/* Close button (mobile) */}
      <button
        onClick={() => setMobileOpen(false)}
        className="md:hidden flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-all mx-auto mb-2"
        style={{
          background: 'var(--surface-hover)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        <X size={14} />
      </button>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden md:flex items-center justify-center w-5 h-5 rounded-full cursor-pointer transition-all mx-auto mb-3"
        style={{
          background: 'var(--surface-hover)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>
    </aside>
    </>
  )
}

export type SidebarComponent = typeof Sidebar & {
  __toggleMobile?: () => void
}
