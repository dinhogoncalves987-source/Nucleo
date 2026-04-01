import { useState, useEffect, useCallback } from 'react'
import AppLayout from '../components/AppLayout'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

type MemorySpeaker = 'sistema' | 'cliente' | 'estabelecimento' | 'edson'

interface JamesMemoryRow {
  id: string
  tenant_id: string | null
  speaker: MemorySpeaker
  category: string | null
  input: string
  response: string
  important: boolean
  tags: string[] | null
  created_at: string
}

interface Metrics {
  total: number
  important: number
  strategic: number
  recent: number
}

interface TrainingPreset {
  title: string
  category: string
  input: string
  response: string
  important?: boolean
  tags?: string[]
}

const JAMES_BASE_CONTEXT: TrainingPreset[] = [
  {
    title: 'O Nucleo',
    category: 'negocio',
    input: 'O que e O Nucleo?',
    response: 'O Nucleo e a camada executiva de operacao da holding. Ele centraliza inteligencia, leitura de dados, campanhas, relacao comercial e decisao operacional.',
    important: true,
    tags: ['nucleo', 'posicionamento', 'executivo'],
  },
  {
    title: 'The Beauty Hub',
    category: 'negocio',
    input: 'O que e The Beauty Hub?',
    response: 'The Beauty Hub e a operacao principal validada neste piloto. O sistema organiza estabelecimentos, clientes, campanhas, afiliacao, cashback e acao comercial orientada por dados.',
    important: true,
    tags: ['beauty-hub', 'piloto', 'negocio'],
  },
  {
    title: 'Fornecedor e estabelecimento',
    category: 'estabelecimento',
    input: 'Como funciona fornecedor ou estabelecimento dentro do sistema?',
    response: 'Cada estabelecimento entra como unidade operacional da rede. O papel do James e apoiar cadastro, leitura de performance, ativacao de campanhas e recomendacao de proxima acao comercial.',
    important: true,
    tags: ['estabelecimento', 'fornecedor', 'operacao'],
  },
  {
    title: 'Cliente',
    category: 'cliente',
    input: 'Como o sistema enxerga o cliente final?',
    response: 'Cliente e ativo recorrente da operacao. O objetivo nao e apenas captar, mas aumentar retorno, frequencia, ticket e retencao com mensagens objetivas e acao no momento certo.',
    important: true,
    tags: ['cliente', 'retencao', 'ticket'],
  },
  {
    title: 'Afiliado e comissao',
    category: 'negociacao',
    input: 'Como funciona afiliado e comissao?',
    response: 'Afiliado e um originador de demanda. O sistema precisa rastrear origem, conversao, GMV e comissao para mostrar impacto real de parceria e evitar decisao baseada em achismo.',
    important: true,
    tags: ['afiliado', 'comissao', 'gmv'],
  },
  {
    title: 'Cashback',
    category: 'cliente',
    input: 'Qual e o papel do cashback?',
    response: 'Cashback nao e brinde. E mecanismo de reativacao e frequencia. O uso correto e empurrar recompra em janelas de baixa ocupacao e elevar o valor do ciclo do cliente.',
    important: true,
    tags: ['cashback', 'reativacao', 'frequencia'],
  },
  {
    title: 'Campanhas',
    category: 'operacao',
    input: 'Qual e o objetivo das campanhas?',
    response: 'Campanha existe para mover receita, ocupacao e retorno, nao para gerar ruido. James deve recomendar campanha com alvo claro, momento certo e criterio de resultado.',
    important: true,
    tags: ['campanha', 'ocupacao', 'receita'],
  },
  {
    title: 'Postura executiva',
    category: 'comportamento',
    input: 'Como James deve responder para diretoria e investidores?',
    response: 'James responde como executivo digital. Linguagem curta, objetiva e estrategica. Sem tom de chatbot, sem rodeio, sem excesso de gentileza e sempre com foco em decisao, risco, resultado e proxima acao.',
    important: true,
    tags: ['executivo', 'diretoria', 'investidor'],
  },
]

const IDEAL_RESPONSE_EXAMPLES: TrainingPreset[] = [
  {
    title: 'Analise de negocio',
    category: 'negocio',
    input: 'Analise o negocio deste mes.',
    response: 'O ponto central e conversao, nao volume. Se leads cresceram e receita nao acompanhou, o gargalo esta entre abordagem, oferta e follow-up. Minha recomendacao e revisar a sequencia comercial e medir retorno por campanha.',
    important: true,
    tags: ['analise', 'receita', 'conversao'],
  },
  {
    title: 'Proposta de campanha',
    category: 'operacao',
    input: 'Que campanha devemos rodar esta semana?',
    response: 'Prioridade em reativacao da base morna com oferta simples e prazo curto. Campanha boa aqui e recuperar clientes de 30 a 60 dias sem retorno e medir agendamento gerado em vez de clique ou resposta.',
    important: true,
    tags: ['campanha', 'reativacao', 'agendamento'],
  },
  {
    title: 'Leitura de dados',
    category: 'calculo',
    input: 'O que os dados estao dizendo?',
    response: 'Os dados precisam responder tres pontos: onde a receita entra, onde trava e qual acao corrige isso rapido. Se eu nao tiver essas tres respostas, falta contexto operacional e nao vale concluir antes.',
    important: true,
    tags: ['dados', 'analise', 'decisao'],
  },
  {
    title: 'Sugestao de acao',
    category: 'operacao',
    input: 'Qual e a proxima acao recomendada?',
    response: 'Minha sugestao e atacar a alavanca de menor custo e maior velocidade: reativar base existente, corrigir abordagem comercial e rodar uma campanha com meta de agendamento. Expansao vem depois que a base responder.',
    important: true,
    tags: ['acao', 'prioridade', 'estrategia'],
  },
]

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-1"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <span className="text-2xl font-bold" style={{ color: 'var(--text-main)' }}>{value}</span>
    </div>
  )
}

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-medium
      ${type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-300' : 'bg-red-900/90 border-red-500/40 text-red-300'}`}>
      {type === 'success' ? 'OK' : 'ERRO'} {msg}
    </div>
  )
}

export default function JamesTraining() {
  const { tenant } = useTenant()
  const [memories, setMemories] = useState<JamesMemoryRow[]>([])
  const [metrics, setMetrics] = useState<Metrics>({ total: 0, important: 0, strategic: 0, recent: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    speaker: 'sistema' as MemorySpeaker,
    category: 'negocio',
    input: '',
    response: '',
    tags: 'executivo,beauty-hub',
    important: true,
  })

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchMemories = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('james_memories')
      .select('id, tenant_id, speaker, category, input, response, important, tags, created_at')
      .eq('tenant_id', tenant.id)
      .order('important', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(150)

    if (!error && data) {
      const rows = data as JamesMemoryRow[]
      setMemories(rows)
      setMetrics({
        total: rows.length,
        important: rows.filter(r => r.important).length,
        strategic: rows.filter(r => ['negocio', 'operacao', 'negociacao', 'calculo', 'comportamento'].includes(r.category ?? '')).length,
        recent: rows.filter(r => Date.now() - new Date(r.created_at).getTime() < 86_400_000).length,
      })
    }
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { void fetchMemories() }, [fetchMemories])

  const resetForm = () => {
    setEditId(null)
    setForm({
      speaker: 'sistema',
      category: 'negocio',
      input: '',
      response: '',
      tags: 'executivo,beauty-hub',
      important: true,
    })
  }

  const handleSave = async () => {
    if (!tenant?.id) return
    if (!form.input.trim() || !form.response.trim()) {
      showToast('Preencha contexto e resposta ideal.', 'error')
      return
    }

    setSaving(true)
    const payload = {
      tenant_id: tenant.id,
      speaker: form.speaker,
      category: form.category.trim() || null,
      input: form.input.trim(),
      response: form.response.trim(),
      important: form.important,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }

    const { error } = editId
      ? await supabase.from('james_memories').update(payload).eq('id', editId)
      : await supabase.from('james_memories').insert([payload])

    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }

    showToast(editId ? 'Memoria executiva atualizada.' : 'Memoria executiva adicionada.')
    resetForm()
    void fetchMemories()
  }

  const handleEdit = (memory: JamesMemoryRow) => {
    setEditId(memory.id)
    setForm({
      speaker: memory.speaker,
      category: memory.category ?? 'geral',
      input: memory.input,
      response: memory.response,
      tags: (memory.tags ?? []).join(', '),
      important: memory.important,
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Apagar esta memoria executiva?')) return
    const { error } = await supabase.from('james_memories').delete().eq('id', id)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Memoria removida.')
    void fetchMemories()
  }

  const insertPresetSet = async (presets: TrainingPreset[]) => {
    if (!tenant?.id) return

    const inputs = presets.map(p => p.input)
    const { data: existing } = await supabase
      .from('james_memories')
      .select('input')
      .eq('tenant_id', tenant.id)
      .in('input', inputs)

    const existingInputs = new Set((existing ?? []).map((row: { input: string }) => row.input))
    const fresh = presets
      .filter(p => !existingInputs.has(p.input))
      .map(p => ({
        tenant_id: tenant.id,
        speaker: 'sistema' as const,
        category: p.category,
        input: p.input,
        response: p.response,
        important: p.important ?? true,
        tags: p.tags ?? [],
      }))

    if (!fresh.length) {
      showToast('Esse bloco ja esta carregado.')
      return
    }

    const { error } = await supabase.from('james_memories').insert(fresh)
    if (error) {
      showToast(error.message, 'error')
      return
    }

    showToast(`${fresh.length} memorias adicionadas.`)
    void fetchMemories()
  }

  const handleSeedBaseContext = async () => {
    setSeeding(true)
    await insertPresetSet(JAMES_BASE_CONTEXT)
    setSeeding(false)
  }

  const handleSeedExamples = async () => {
    setSeeding(true)
    await insertPresetSet(IDEAL_RESPONSE_EXAMPLES)
    setSeeding(false)
  }

  const fieldClass = 'w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]'
  const fieldStyle = { background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-main)' }

  return (
    <AppLayout title="James Executive Training" subtitle="Contexto estrategico, posicionamento e memoria executiva do James">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Memorias" value={metrics.total} icon="MEM" />
        <MetricCard label="Prioritarias" value={metrics.important} icon="TOP" />
        <MetricCard label="Estrategicas" value={metrics.strategic} icon="ROI" />
        <MetricCard label="Ultimas 24h" value={metrics.recent} icon="NOW" />
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>Base executiva do James</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Este painel grava contexto no mesmo repositório consultado pelo James em produção. O objetivo aqui e posicionar o James como executivo digital, nao como chatbot operacional.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleSeedBaseContext} disabled={seeding} className="btn-primary text-sm gap-2">
              {seeding ? 'Carregando...' : 'Carregar contexto-base'}
            </button>
            <button onClick={handleSeedExamples} disabled={seeding} className="btn-secondary text-sm gap-2">
              {seeding ? 'Carregando...' : 'Carregar respostas ideais'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>Posicionamento</p>
            <p className="text-sm" style={{ color: 'var(--text-main)', lineHeight: 1.6 }}>
              James deve falar como executivo digital: direto, claro, estrategico, orientado a resultado, sem linguagem de chatbot e sem floreio desnecessario.
            </p>
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>Escopo de negocio</p>
            <p className="text-sm" style={{ color: 'var(--text-main)', lineHeight: 1.6 }}>
              O contexto cobre O Nucleo, The Beauty Hub, fornecedores, estabelecimentos, clientes, afiliacao, cashback, campanhas e leitura de dados para decisao executiva.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>
            {editId ? 'Editar memoria executiva' : 'Criar memoria executiva'}
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Speaker</label>
              <select
                value={form.speaker}
                onChange={e => setForm(f => ({ ...f, speaker: e.target.value as MemorySpeaker }))}
                className={fieldClass}
                style={fieldStyle}
              >
                <option value="sistema">Sistema</option>
                <option value="cliente">Cliente</option>
                <option value="estabelecimento">Estabelecimento</option>
                <option value="edson">Edson</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Categoria</label>
              <input
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="negocio, operacao, cliente, negociacao"
                className={fieldClass}
                style={fieldStyle}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Pergunta ou contexto</label>
            <textarea
              rows={3}
              value={form.input}
              onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
              placeholder="Ex: Como James deve responder para um investidor?"
              className={`${fieldClass} resize-none`}
              style={fieldStyle}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Resposta ideal</label>
            <textarea
              rows={5}
              value={form.response}
              onChange={e => setForm(f => ({ ...f, response: e.target.value }))}
              placeholder="Resposta executiva, curta, acionavel e com foco em negocio."
              className={`${fieldClass} resize-none`}
              style={fieldStyle}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tags</label>
            <input
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="executivo, estrategia, beauty-hub"
              className={fieldClass}
              style={fieldStyle}
            />
          </div>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-main)' }}>
            <input
              type="checkbox"
              checked={form.important}
              onChange={e => setForm(f => ({ ...f, important: e.target.checked }))}
            />
            Priorizar esta memoria nas respostas do James
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
              style={{ background: 'var(--gradient-accent)' }}
            >
              {saving ? 'Salvando...' : editId ? 'Atualizar memoria' : 'Salvar memoria'}
            </button>
            {editId && (
              <button
                onClick={resetForm}
                className="px-4 py-2.5 rounded-xl text-sm transition-all"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>Exemplos ideais de postura executiva</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Estes exemplos mostram o tom esperado: leitura de negocio, recomendacao objetiva, foco em resultado e proxima acao.
          </p>

          <div className="flex flex-col gap-3">
            {IDEAL_RESPONSE_EXAMPLES.map(example => (
              <div key={example.title} className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>{example.title}</p>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{example.input}</p>
                <p className="text-sm" style={{ color: 'var(--text-main)', lineHeight: 1.6 }}>{example.response}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>Memorias executivas salvas</h2>
          <button onClick={() => void fetchMemories()} className="text-xs transition-colors" style={{ color: 'var(--accent)' }}>Atualizar</button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>Carregando...</div>
        ) : memories.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-card)' }}>
            Nenhuma memoria executiva cadastrada ainda.
          </div>
        ) : (
          <table className="w-full text-sm" style={{ background: 'var(--surface-card)' }}>
            <thead>
              <tr className="text-xs uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th className="text-left px-5 py-3">Contexto</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Resposta</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Categoria</th>
                <th className="text-center px-5 py-3 hidden lg:table-cell">Prioridade</th>
                <th className="text-right px-5 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {memories.map(memory => (
                <tr key={memory.id} className="group transition-colors" style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-5 py-3 max-w-[220px]">
                    <p className="truncate text-xs" style={{ color: 'var(--text-main)' }}>{memory.input}</p>
                  </td>
                  <td className="px-5 py-3 max-w-[280px] hidden md:table-cell">
                    <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{memory.response}</p>
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell">
                    <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}>
                      {memory.category ?? 'geral'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center hidden lg:table-cell">
                    <span className="text-xs font-bold" style={{ color: memory.important ? 'var(--gold)' : 'var(--text-muted)' }}>
                      {memory.important ? 'ALTA' : 'NORMAL'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(memory)} className="text-xs px-2 py-1 rounded-lg bg-blue-900/40 text-blue-300 hover:bg-blue-800/50 transition-colors">
                        Editar
                      </button>
                      <button onClick={() => void handleDelete(memory.id)} className="text-xs px-2 py-1 rounded-lg bg-red-900/40 text-red-300 hover:bg-red-800/50 transition-colors">
                        Apagar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}
