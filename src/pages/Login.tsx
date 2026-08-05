import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight, AlertCircle, Cpu } from 'lucide-react'
import { useTenant } from '../contexts/tenant-context'

// O Núcleo Login Page
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { loginWithSupabase } = useTenant()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await loginWithSupabase(email.trim(), password)

    setLoading(false)

    if (authError) {
      setError(authError)
      return
    }

    navigate('/dashboard', { replace: true })
  }

  return (
    <div
      className="min-h-screen flex overflow-hidden bg-grid"
      style={{ background: 'var(--surface-main)' }}
    >
      {/* Left panel — O Núcleo brand */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #050810 0%, #0A1628 40%, #001840 100%)', borderRight: '1px solid var(--border)' }}
      >
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(0,180,255,0.08) 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 w-full h-32"
            style={{ background: 'linear-gradient(0deg, rgba(0,180,255,0.04) 0%, transparent 100%)' }} />
          {/* Grid lines */}
          <div className="absolute inset-0"
            style={{
              backgroundImage: 'linear-gradient(rgba(0,180,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.04) 1px, transparent 1px)',
              backgroundSize: '40px 40px'
            }}
          />
        </div>

        {/* Logo area */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            {/* Núcleo emblem */}
            <div className="relative flex items-center justify-center" style={{ width: 52, height: 52 }}>
              <div className="absolute rounded-full animate-spin" style={{
                width: 52, height: 52,
                border: '1px dashed rgba(0,180,255,0.25)',
                animationDuration: '8s'
              }} />
              <div className="absolute rounded-full animate-spin" style={{
                width: 42, height: 42,
                border: '1px solid rgba(212,160,23,0.2)',
                animationDuration: '5s',
                animationDirection: 'reverse'
              }} />
              <div className="absolute flex items-center justify-center rounded-full" style={{
                width: 32, height: 32,
                background: 'radial-gradient(circle at 35% 35%, #1A3A5C, #001829)',
                border: '1.5px solid rgba(0,180,255,0.4)',
                boxShadow: '0 0 12px rgba(0,180,255,0.3), inset 0 0 12px rgba(0,180,255,0.1)'
              }}>
                <span style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 12,
                  fontWeight: 900,
                  color: '#00B4FF',
                  textShadow: '0 0 10px rgba(0,180,255,0.8)'
                }}>N</span>
              </div>
            </div>
            <div>
              <p style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontWeight: 900,
                fontSize: 18,
                color: '#00B4FF',
                textShadow: '0 0 12px rgba(0,180,255,0.5)',
                letterSpacing: '-0.01em'
              }}>O NÚCLEO</p>
              <p style={{ fontSize: 11, color: 'rgba(107,122,153,1)', fontWeight: 500 }}>XGlobal Partners</p>
            </div>
          </div>
        </div>

        {/* Center headline */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-1 h-8 rounded-full" style={{ background: 'linear-gradient(180deg, #00B4FF, transparent)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Sistema Operacional da Holding
            </span>
          </div>
          <h2 style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 36,
            fontWeight: 800,
            color: '#E8EDF5',
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            marginBottom: 16
          }}>
            Inteligência que<br />
            <span style={{ color: '#00B4FF', textShadow: '0 0 24px rgba(0,180,255,0.4)' }}>
              comanda o império.
            </span>
          </h2>
          <p style={{ color: 'rgba(107,122,153,1)', fontSize: 14, lineHeight: 1.6, maxWidth: 300 }}>
            Gerencie todas as empresas da holding em um só núcleo — comandadas por James, o agente central de inteligência.
          </p>
        </div>

        {/* James status */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 p-4 rounded-2xl" style={{
            background: 'rgba(0,180,255,0.06)',
            border: '1px solid rgba(0,180,255,0.12)',
          }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{
              background: 'rgba(0,180,255,0.12)',
              border: '1px solid rgba(0,180,255,0.2)'
            }}>
              <Cpu size={16} style={{ color: '#00B4FF' }} />
            </div>
            <div>
              <div className="james-online" style={{ fontSize: 10 }}>James Online</div>
              <p style={{ fontSize: 11, color: 'rgba(107,122,153,1)', marginTop: 1 }}>
                Agente central ativo e monitorando
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative">

        {/* Mobile logo */}
        <div className="lg:hidden text-center mb-10">
          <p style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 900,
            fontSize: 22,
            color: '#00B4FF',
            textShadow: '0 0 12px rgba(0,180,255,0.5)',
            letterSpacing: '-0.01em'
          }}>O NÚCLEO</p>
        </div>

        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold mb-1 tracking-tight" style={{ color: 'var(--text-main)' }}>
            Acesso ao Núcleo
          </h2>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
            Insira suas credenciais de comando
          </p>

          <div className="card-glass">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="label">E-mail</label>
                <input type="email" className="input-field" placeholder="seu@email.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className="label">Senha</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className="input-field pr-11"
                    placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl px-3 py-2.5 text-sm flex items-center gap-2"
                  style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
                  <AlertCircle size={14} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary h-11 mt-1">
                {loading
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><span>Entrar no Núcleo</span><ArrowRight size={15} /></>}
              </button>
            </form>
          </div>

          <p className="text-center text-xs mt-5" style={{ color: 'var(--text-muted)' }}>
            Acesso restrito. Para solicitar credenciais, entre em contato com o administrador.
          </p>
        </div>
      </div>
    </div>
  )
}
