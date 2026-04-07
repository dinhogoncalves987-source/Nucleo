import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Bot, Zap, Plug, ShieldCheck, Network,
  LogOut, ChevronLeft, ChevronRight, Sun, Moon, Cpu, BrainCircuit, Radio, FlaskConical
} from 'lucide-react'

import { useTenant } from '../contexts/TenantContext'
import { useTheme } from '../contexts/ThemeContext'

const navItems = [
  { to: '/dashboard',                      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads',                          icon: Users,           label: 'O Predador' },
  { to: '/james',                          icon: Bot,             label: 'James' },
  { to: '/james-training',                 icon: BrainCircuit,    label: 'James Training' },
  { to: '/intel',                          icon: FlaskConical,    label: 'James Intel' },
  { to: '/chip-control',                   icon: Radio,           label: 'Chip Control' },
  { to: '/activations',                    icon: Zap,             label: 'Viralizador' },
  { to: '/settings/integrations',          icon: Plug,            label: 'Conexões' },
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

export default function Sidebar() {
  const { user, logout } = useTenant()
  const { toggleTheme, isDark } = useTheme()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = () => { logout(); navigate('/') }

  return (
    <aside
      className={`flex flex-col ${collapsed ? 'w-[64px]' : 'w-[220px]'} min-h-screen flex-shrink-0 transition-all duration-300 ease-in-out`}
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

        {/* SuperAdmin */}
        {user?.role === 'superadmin' && (
          <>
            <div className="mx-2 my-2" style={{ height: '1px', background: 'var(--border)' }} />
            <NavLink
              to="/admin/projects"
              style={({ isActive }) => isActive
                ? { background: 'rgba(212,160,23,0.10)', color: 'var(--gold)' }
                : { color: 'var(--text-muted)' }
              }
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <ShieldCheck size={17} className="flex-shrink-0" style={{ color: isActive ? 'var(--gold)' : 'var(--text-muted)' }} />
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
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Network size={17} className="flex-shrink-0" style={{ color: isActive ? '#34d399' : 'var(--text-muted)' }} />
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
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Radio size={17} className="flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
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
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            >
              {({ isActive }) => (
                <>
                  <Cpu size={17} className="flex-shrink-0" style={{ color: isActive ? '#a78bfa' : 'var(--text-muted)' }} />
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

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center w-5 h-5 rounded-full cursor-pointer transition-all mx-auto mb-3"
        style={{
          background: 'var(--surface-hover)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>
    </aside>
  )
}
