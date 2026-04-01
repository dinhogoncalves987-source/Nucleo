import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import { Bell } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'

interface Props {
  children: ReactNode
  title: string
  subtitle?: string
}

export default function AppLayout({ children, title, subtitle }: Props) {
  const { tenant } = useTenant()
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-main)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-6 py-3.5 flex-shrink-0"
          style={{
            background: 'var(--surface-card)',
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          }}
        >
          <div>
            <h1
              className="text-xl font-bold tracking-tight"
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                color: 'var(--text-main)',
                lineHeight: 1.2,
              }}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors"
              style={{
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}
            >
              <Bell size={15} />
            </button>
            <div className="h-6 w-px" style={{ background: 'var(--border)' }} />
            {/* Avatar with gradient */}
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-sm"
                style={{ background: 'var(--gradient-accent)' }}
              >
                {(tenant?.name ?? 'B').charAt(0).toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--text-main)' }}>
                  {tenant?.name ?? 'Demo'}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          className="flex-1 overflow-y-auto p-6 animate-fade-in bg-grid"
          style={{ background: 'var(--surface-main)' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
