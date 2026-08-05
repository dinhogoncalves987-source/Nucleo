import { lazy, Suspense, Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { ThemeProvider } from './contexts/ThemeContext'

// ── Error Boundary para debug de crashes ────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#ff4444', padding: 32, fontFamily: 'monospace', background: '#0a0a0a', minHeight: '100vh' }}>
          <h2>❌ Erro em {this.props.label ?? 'componente'}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{(this.state.error as Error).message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#888' }}>{(this.state.error as Error).stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Lazy Load: Páginas Operacionais ─────────────────────────
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Estabelecimentos = lazy(() => import('./pages/Estabelecimentos'))
const Clientes = lazy(() => import('./pages/Clientes'))
const Leads = lazy(() => import('./pages/Leads'))
const Campanhas = lazy(() => import('./pages/Campanhas'))
const Atendimento = lazy(() => import('./pages/Atendimento'))

// ── Lazy Load: Páginas Admin/Técnicas ───────────────────────
const AgentConfig = lazy(() => import('./pages/AgentConfig'))
const James = lazy(() => import('./pages/James'))
const Activations = lazy(() => import('./pages/Activations'))
const Integrations = lazy(() => import('./pages/Integrations'))
const AdminProjects = lazy(() => import('./pages/AdminProjects'))
const AffiliateAudit = lazy(() => import('./pages/AffiliateAudit'))
const ChipsMonitor = lazy(() => import('./pages/ChipsMonitor'))
const QueueMonitor = lazy(() => import('./pages/QueueMonitor'))
const JamesTraining = lazy(() => import('./pages/JamesTraining'))
const ChipControl = lazy(() => import('./pages/ChipControl'))
const IntelOverview    = lazy(() => import('./pages/intel/IntelOverview'))
const IntelChips       = lazy(() => import('./pages/intel/IntelChips'))
const IntelChipDetail  = lazy(() => import('./pages/intel/IntelChipDetail'))
const IntelChipMetric  = lazy(() => import('./pages/intel/IntelChipMetric'))
const IntelAnalytics   = lazy(() => import('./pages/intel/IntelAnalytics'))
const IntelMemory      = lazy(() => import('./pages/intel/IntelMemory'))
const IntelInbox       = lazy(() => import('./pages/intel/IntelInbox'))

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-main)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center" style={{ width: 52, height: 52 }}>
          <div style={{ width: 52, height: 52, border: '1px dashed rgba(0,180,255,0.3)', borderRadius: '50%', position: 'absolute', animation: 'spin 8s linear infinite' }} />
          <div style={{ width: 36, height: 36, border: '1.5px solid rgba(0,180,255,0.5)', borderRadius: '50%', position: 'absolute', background: 'radial-gradient(circle at 35% 35%, #1A3A5C, #001829)', boxShadow: '0 0 12px rgba(0,180,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontWeight: 900, fontSize: 14, color: '#00B4FF', textShadow: '0 0 8px rgba(0,180,255,0.8)' }}>N</span>
          </div>
        </div>
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Inicializando O Núcleo...</p>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, superAdminOnly = false }: { children: React.ReactNode; superAdminOnly?: boolean }) {
  const { loading, user, isAuthenticated } = useTenant()
  if (loading) return <LoadingScreen />
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />
  if (superAdminOnly && user?.role !== 'superadmin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { loading } = useTenant()

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/"
          element={
            loading
              ? <LoadingScreen />
              : <Navigate to="/dashboard" replace />
          }
        />
        <Route path="/login" element={<Login />} />

        {/* ── Operacional ───────────────────────────────── */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/estabelecimentos" element={<ProtectedRoute><Estabelecimentos /></ProtectedRoute>} />
        <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
        <Route path="/leads" element={<ProtectedRoute><Leads /></ProtectedRoute>} />
        <Route path="/campanhas" element={<ProtectedRoute><Campanhas /></ProtectedRoute>} />
        <Route path="/atendimento" element={<ProtectedRoute><Atendimento /></ProtectedRoute>} />

        {/* ── Admin / Técnico ───────────────────────────── */}
        <Route path="/agent-config" element={<ProtectedRoute><AgentConfig /></ProtectedRoute>} />
        <Route path="/james" element={<ProtectedRoute><ErrorBoundary label="General James"><James /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/activations" element={<ProtectedRoute><Activations /></ProtectedRoute>} />
        <Route path="/settings/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
        <Route path="/admin/projects" element={<ProtectedRoute superAdminOnly><AdminProjects /></ProtectedRoute>} />
        <Route path="/admin/affiliates" element={<ProtectedRoute superAdminOnly><AffiliateAudit /></ProtectedRoute>} />
        <Route path="/admin/chips" element={<ProtectedRoute superAdminOnly><ChipsMonitor /></ProtectedRoute>} />
        <Route path="/admin/queue" element={<ProtectedRoute superAdminOnly><QueueMonitor /></ProtectedRoute>} />
        <Route path="/james-training" element={<ProtectedRoute><JamesTraining /></ProtectedRoute>} />
        <Route path="/chip-control" element={<ProtectedRoute><ChipControl /></ProtectedRoute>} />
        <Route path="/james-learning-command-center" element={<Navigate to="/intel" replace />} />
        <Route path="/intel" element={<ProtectedRoute><IntelOverview /></ProtectedRoute>} />
        <Route path="/intel/chips" element={<ProtectedRoute><IntelChips /></ProtectedRoute>} />
        <Route path="/intel/chips/:id" element={<ProtectedRoute><IntelChipDetail /></ProtectedRoute>} />
        <Route path="/intel/chips/:id/:metric" element={<ProtectedRoute><IntelChipMetric /></ProtectedRoute>} />
        <Route path="/intel/analytics" element={<ProtectedRoute><IntelAnalytics /></ProtectedRoute>} />
        <Route path="/intel/memory" element={<ProtectedRoute><IntelMemory /></ProtectedRoute>} />
        <Route path="/intel/inbox" element={<ProtectedRoute><IntelInbox /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <TenantProvider>
          <AppRoutes />
        </TenantProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
