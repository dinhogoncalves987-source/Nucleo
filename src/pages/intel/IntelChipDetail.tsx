// ════════════════════════════════════════════════════════════════════════════
// IntelChipDetail.tsx — Página detalhada de um chip individual
// Rota: /intel/chips/:id
// ════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import {
  INTEL_CSS, BackButton, Badge, MiniBar, SectionHeader,
  makeChips, CHIP_STATUS_COLOR, CANAL_ICON,
  type Chip, colStyle,
} from './intel-shared'

export default function IntelChipDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [chips] = useState<Chip[]>(makeChips)

  const chip = useMemo(() => chips.find(c => c.id === id), [chips, id])

  if (!chip) {
    return (
      <AppLayout title="Chip não encontrado" subtitle="">
        <BackButton to="/intel/chips" label="Voltar aos Chips" />
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(160,190,210,0.5)', fontSize: 14 }}>
          Chip "{id}" não encontrado no sistema.
        </div>
      </AppLayout>
    )
  }

  const color = CHIP_STATUS_COLOR[chip.status]

  // Mock detailed data for this chip
  const msgVolume = { enviadas: Math.floor(200 + Math.random() * 500), recebidas: Math.floor(180 + Math.random() * 400) }
  const taxaResposta = Math.round(60 + Math.random() * 35)
  const taxaConversao = chip.conv

  const historico = [
    { ts: '09:12', acao: 'Resposta automática enviada', canal: 'whatsapp', resultado: 'aprovado' },
    { ts: '09:45', acao: 'Promoção de reativação', canal: 'texto', resultado: 'pendente' },
    { ts: '10:22', acao: 'Objeção tratada', canal: 'voz', resultado: 'convertido' },
    { ts: '11:08', acao: 'Agendamento confirmado', canal: 'whatsapp', resultado: 'aprovado' },
    { ts: '13:30', acao: 'Follow-up automático', canal: 'texto', resultado: 'aprovado' },
    { ts: '14:15', acao: 'Campanha combo ativada', canal: 'whatsapp', resultado: 'ativo' },
    { ts: '15:42', acao: 'Memória criada via correção', canal: 'texto', resultado: 'salvo' },
    { ts: '16:55', acao: 'Resposta editada manualmente', canal: 'voz', resultado: 'corrigido' },
  ]

  const erros = [
    { tipo: 'Timeout na resposta', freq: Math.floor(Math.random() * 5), ultimo: '2h atrás' },
    { tipo: 'Confiança abaixo de 70%', freq: Math.floor(Math.random() * 8), ultimo: '4h atrás' },
    { tipo: 'Canal incorreto selecionado', freq: Math.floor(Math.random() * 3), ultimo: '1d atrás' },
  ]

  const campanhas = [
    { nome: 'Combo Anti-Queda', status: 'ativo', impacto: Math.floor(20 + Math.random() * 50), conversao: Math.round(40 + Math.random() * 40) },
    { nome: 'Reativação 30d', status: 'ativo', impacto: Math.floor(10 + Math.random() * 30), conversao: Math.round(30 + Math.random() * 50) },
    { nome: 'Flash Friday', status: 'pendente', impacto: 0, conversao: 0 },
  ]

  const copilotContext = {
    page: 'chipDetail' as const,
    data: {
      chip: { id: chip.id, status: chip.status, learn: chip.learn, conv: chip.conv, health: chip.health, heat: chip.heat, estab: chip.estab },
      msgVolume, taxaResposta, taxaConversao,
      errosAtivos: erros.filter(e => e.freq > 0).length,
      campanhasAtivas: campanhas.filter(c => c.status === 'ativo').length,
    },
  }

  return (
    <AppLayout title={chip.id} subtitle={`${chip.nome} · ${chip.estab}`}>
      <style>{INTEL_CSS}</style>
      <BackButton to="/intel/chips" label="Voltar aos Chips" />

      {/* Header card */}
      <div style={{ ...colStyle, padding: '20px 24px', marginBottom: 16, borderColor: `${color}30` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 12,
            background: `${color}15`, border: `2px solid ${color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color, fontFamily: 'monospace',
          }}>
            {chip.id.replace('CHI-','')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 4 }}>{chip.id}</div>
            <div style={{ fontSize: 12, color: 'rgba(160,190,210,0.6)' }}>{chip.estab} · Última atividade: {chip.ultima}</div>
          </div>
          <div style={{ padding: '8px 16px', borderRadius: 8, background: `${color}15`, border: `1px solid ${color}40` }}>
            <Badge text={chip.status} color={color} />
          </div>
        </div>
      </div>

      {/* Stats grid — clicável */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Aprendizado', value: chip.learn, color: '#a78bfa', key: 'learn', icon: '🧠' },
          { label: 'Conversão', value: chip.conv, color: '#34d399', key: 'conv', icon: '🎯' },
          { label: 'Promoção', value: chip.promo, color: '#fbbf24', key: 'promo', icon: '📢' },
          { label: 'Recuperação', value: chip.recov, color: '#00B4FF', key: 'recov', icon: '🔄' },
          { label: 'Saúde', value: chip.health, color: '#34d399', key: 'health', icon: '💚' },
          { label: 'Temperatura', value: chip.heat, color: chip.heat > 80 ? '#f87171' : '#fb923c', key: 'heat', icon: '🌡️' },
        ].map(({ label, value, color: c, key: k, icon }) => (
          <div key={label}
            onClick={() => navigate(`/intel/chips/${id}/${k}`)}
            className="cc-btn cc-row"
            style={{ ...colStyle, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${c}50` }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,180,255,0.1)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{icon} {label}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: c }}>{value}%</span>
            </div>
            <MiniBar value={value} color={c} />
            <div style={{ fontSize: 8, color: `${c}60`, marginTop: 6, textAlign: 'right' }}>→ Explorar detalhes</div>
          </div>
        ))}
      </div>

      {/* Volume + Taxa */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ ...colStyle, padding: '16px 18px' }}>
          <div style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Volume de Mensagens</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div><div style={{ fontSize: 22, fontWeight: 800, color: '#00B4FF' }}>{msgVolume.enviadas}</div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)' }}>Enviadas</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, color: '#34d399' }}>{msgVolume.recebidas}</div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)' }}>Recebidas</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24' }}>{taxaResposta}%</div><div style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)' }}>Taxa Resposta</div></div>
          </div>
        </div>
        <div style={{ ...colStyle, padding: '16px 18px' }}>
          <div style={{ fontSize: 10, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Taxa de Conversão</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#34d399', marginBottom: 4 }}>{taxaConversao}%</div>
          <MiniBar value={taxaConversao} color="#34d399" />
        </div>
      </div>

      {/* Histórico + Erros + Campanhas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
        {/* Histórico */}
        <div style={colStyle}>
          <SectionHeader title="HISTÓRICO DE AÇÕES" color="#00B4FF" />
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {historico.map((h, i) => (
              <div key={i} className="cc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.4)', minWidth: 32 }}>{h.ts}</span>
                <span style={{ fontSize: 10 }}>{CANAL_ICON[h.canal]}</span>
                <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.8)', flex: 1 }}>{h.acao}</span>
                <Badge text={h.resultado} color={h.resultado === 'aprovado' ? '#34d399' : h.resultado === 'convertido' ? '#00B4FF' : '#fbbf24'} />
              </div>
            ))}
          </div>
        </div>

        {/* Erros */}
        <div style={colStyle}>
          <SectionHeader title="ERROS RECORRENTES" color="#f87171" />
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {erros.map((e, i) => (
              <div key={i} style={{ padding: '10px 12px', background: 'rgba(248,113,113,0.05)', borderRadius: 6, border: '1px solid rgba(248,113,113,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.8)' }}>{e.tipo}</span>
                  <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>{e.freq}×</span>
                </div>
                <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.4)' }}>Último: {e.ultimo}</span>
              </div>
            ))}
          </div>
          {/* Campanhas */}
          <SectionHeader title="CAMPANHAS ASSOCIADAS" color="#fbbf24" />
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {campanhas.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(0,15,35,0.4)', borderRadius: 6 }}>
                <span style={{ fontSize: 11, color: 'rgba(200,220,240,0.8)', flex: 1 }}>{c.nome}</span>
                <Badge text={c.status} color={c.status === 'ativo' ? '#34d399' : '#a78bfa'} />
                {c.impacto > 0 && <span style={{ fontSize: 9, color: '#00B4FF' }}>{c.impacto} imp.</span>}
                {c.conversao > 0 && <span style={{ fontSize: 9, color: '#34d399' }}>{c.conversao}%</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
