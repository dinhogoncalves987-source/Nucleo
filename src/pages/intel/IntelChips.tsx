// ════════════════════════════════════════════════════════════════════════════
// IntelChips.tsx — Listagem completa dos 100 chips
// Rota: /intel/chips
// ════════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import {
  BackButton, SectionHeader, MiniBar, Badge,
} from './intel-shared'
import { makeChips, CHIP_STATUS_COLOR, type Chip, type ChipStatus } from './intel-data'
import { INTEL_CSS, colStyle, tabBtnStyle } from './intel-styles'

export default function IntelChips() {
  const navigate = useNavigate()
  const [chips] = useState<Chip[]>(makeChips)
  const [chipFilter, setChipFilter] = useState<ChipStatus|'todos'>('todos')

  const filtered = chipFilter === 'todos' ? chips : chips.filter(c => c.status === chipFilter)
  const statusCounts = chips.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc }, {} as Record<string, number>)

  const copilotContext = {
    page: 'chips' as const,
    data: {
      total: chips.length,
      filtro: chipFilter,
      statusCounts,
      avgLearn: Math.round(chips.reduce((a,c) => a + c.learn, 0) / chips.length),
      avgConv: Math.round(chips.reduce((a,c) => a + c.conv, 0) / chips.length),
      alertas: chips.filter(c => c.status === 'alerta').map(c => c.id),
      quentes: chips.filter(c => c.status === 'quente').map(c => c.id),
    },
  }
  void copilotContext

  return (
    <AppLayout title="Chips" subtitle="Mapa operacional dos 100 chips">
      <style>{INTEL_CSS}</style>
      <BackButton to="/intel" label="Intel Overview" />

      {/* Status summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(Object.entries(statusCounts) as [ChipStatus, number][]).map(([status, count]) => (
          <div key={status} style={{
            padding: '6px 12px', borderRadius: 6,
            border: `1px solid ${CHIP_STATUS_COLOR[status]}30`,
            background: `${CHIP_STATUS_COLOR[status]}10`,
            color: CHIP_STATUS_COLOR[status], fontSize: 12, fontWeight: 600,
          }}>
            {status}: {count}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ ...colStyle, marginBottom: 16 }}>
        <SectionHeader title="FILTRAR POR STATUS">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['todos','ativo','aprendendo','estavel','avancado','alerta','quente'] as Array<ChipStatus|'todos'>).map(s => (
              <button key={s} style={tabBtnStyle(chipFilter===s)} onClick={() => setChipFilter(s)}>{s}</button>
            ))}
          </div>
        </SectionHeader>
      </div>

      {/* Chips Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
        {filtered.map(chip => (
          <div key={chip.id}
            onClick={() => navigate(`/intel/chips/${chip.id}`)}
            className="cc-btn cc-row"
            style={{
              ...colStyle, padding: '12px 14px', cursor: 'pointer',
              borderColor: `${CHIP_STATUS_COLOR[chip.status]}25`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: CHIP_STATUS_COLOR[chip.status], fontFamily: 'monospace' }}>{chip.id}</span>
              <Badge text={chip.status} color={CHIP_STATUS_COLOR[chip.status]} />
            </div>
            <div style={{ fontSize: 9, color: 'rgba(160,190,210,0.5)', marginBottom: 8 }}>{chip.estab}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { l: 'Learn', v: chip.learn, c: '#a78bfa' },
                { l: 'Conv', v: chip.conv, c: '#34d399' },
                { l: 'Health', v: chip.health, c: '#00B4FF' },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 8, color: 'rgba(100,130,160,0.5)', minWidth: 32 }}>{l}</span>
                  <MiniBar value={v} color={c} />
                  <span style={{ fontSize: 9, color: c, minWidth: 22, textAlign: 'right' }}>{v}%</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 8, color: 'rgba(100,130,160,0.35)', marginTop: 6 }}>🕐 {chip.ultima}</div>
          </div>
        ))}
      </div>

      {/* Average scores */}
      <div style={{ ...colStyle, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {(['learn','conv','promo','recov'] as Array<keyof Chip>).map(k => {
            const avg = Math.round(filtered.reduce((a,c) => a + (c[k] as number), 0) / Math.max(1, filtered.length))
            const colors: Record<string,string> = {learn:'#a78bfa',conv:'#34d399',promo:'#fbbf24',recov:'#00B4FF'}
            return (
              <div key={String(k)} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 140, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9, color: 'rgba(100,130,160,0.5)', textTransform: 'uppercase' }}>{k} score</span>
                  <span style={{ fontSize: 9, color: colors[String(k)] }}>{avg}%</span>
                </div>
                <MiniBar value={avg} color={colors[String(k)]}/>
              </div>
            )
          })}
        </div>
      </div>
    </AppLayout>
  )
}
