// ============================================================
// seed-launch.ts — Migração + Seed para Lançamento
// Roda: npx tsx seed-launch.ts
// ============================================================
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

interface TenantRow {
  id: string
  name: string
}

async function main() {
  // Carregar variáveis do .env
  let supabaseUrl = process.env.SUPABASE_URL || ''
  let supabaseKey = process.env.SUPABASE_SERVICE_KEY || ''

  if (!supabaseKey) {
    try {
      const envContent = fs.readFileSync('.env', 'utf-8')
      const urlMatch = envContent.match(/SUPABASE_URL=(.+)/)
      const keyMatch = envContent.match(/SUPABASE_SERVICE_KEY=(.+)/)
      if (urlMatch) supabaseUrl = urlMatch[1].trim()
      if (keyMatch) supabaseKey = keyMatch[1].trim()
    } catch { /* ignore */ }
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_KEY são necessárias')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  })

  console.log('\n═══════════════════════════════════════════')
  console.log('  🚀 O Núcleo — Seed de Lançamento')
  console.log('═══════════════════════════════════════════\n')

  // ── 1. Validar conexão ──
  console.log('── 1. Validando conexão...')
  const { error: testErr } = await supabase.from('tenants').select('id').limit(1)
  if (testErr) { console.error('❌ Erro:', testErr.message); process.exit(1) }
  console.log('  ✅ Conexão OK\n')

  // ── 2. Verificar migração ──
  console.log('── 2. Verificando campos de migração...')
  const { error: tenantErr } = await supabase
    .from('tenants').select('id, name, phone, address, segment, status').limit(1)

  if (tenantErr && tenantErr.message.includes('column')) {
    console.log('\n  ⚠️  Campos novos NÃO existem em tenants.')
    console.log('  📄 Execute o SQL em: supabase/migration_estabelecimentos_clientes.sql')
    console.log('  🔗 https://supabase.com/dashboard/project/oehjrasezdqsklhwscza/sql\n')
    process.exit(1)
  }
  console.log('  ✅ Campos de tenants OK')

  const { error: contactErr } = await supabase
    .from('contacts').select('id, email, status, tenant_origin').limit(1)

  if (contactErr && contactErr.message.includes('column')) {
    console.log('\n  ⚠️  Campos novos NÃO existem em contacts.')
    console.log('  📄 Execute o SQL em: supabase/migration_estabelecimentos_clientes.sql\n')
    process.exit(1)
  }
  console.log('  ✅ Campos de contacts OK\n')

  // ── 3. Seed: Estabelecimentos ──
  console.log('── 3. Seed de Estabelecimentos...')
  const estabelecimentos = [
    { name: 'The Beauty Hub',         phone: '11999001001', address: 'Av. Paulista, 1000 - SP',         segment: 'salao',     status: 'ativo' },
    { name: 'Studio Lavoo',           phone: '11999002002', address: 'R. Augusta, 500 - SP',            segment: 'estetica',  status: 'ativo' },
    { name: 'Barbearia Corte & Arte', phone: '11999003003', address: 'R. Oscar Freire, 300 - SP',       segment: 'barbearia', status: 'ativo' },
    { name: 'Clínica Derma Plus',     phone: '11999004004', address: 'R. Haddock Lobo, 200 - SP',       segment: 'clinica',   status: 'pendente' },
    { name: 'Espaço Beleza Viva',     phone: '21999005005', address: 'R. Visconde de Pirajá, 400 - RJ', segment: 'salao',     status: 'pendente' },
  ]

  for (const est of estabelecimentos) {
    const { data: existing } = await supabase.from('tenants').select('id').eq('name', est.name).maybeSingle()
    if (existing) {
      await supabase.from('tenants').update({
        phone: est.phone, address: est.address, segment: est.segment, status: est.status
      }).eq('id', existing.id)
      console.log(`  🔄 ${est.name} — atualizado`)
    } else {
      await supabase.from('tenants').insert(est)
      console.log(`  ✨ ${est.name} — criado`)
    }
  }
  console.log('')

  // ── 4. Pegar ID do tenant principal ──
  const { data: tenants } = await supabase.from('tenants').select('id, name').order('name')
  const tenantMap = new Map((tenants ?? []).map((tenant: TenantRow) => [tenant.name, tenant.id]))
  const mainTenantId = tenantMap.get('The Beauty Hub') || (tenants?.[0]?.id ?? null)

  if (!mainTenantId) { console.error('❌ Nenhum tenant encontrado'); process.exit(1) }

  // ── 5. Seed: Clientes ──
  console.log('── 4. Seed de Clientes...')
  const clientes = [
    { name: 'Ana Silva',        phone: '11988001001', email: 'ana.silva@email.com',   source: 'whatsapp',  status: 'ativo' },
    { name: 'Carla Mendes',     phone: '11988002002', email: 'carla.m@email.com',     source: 'instagram', status: 'ativo' },
    { name: 'Juliana Costa',    phone: '11988003003', email: 'ju.costa@email.com',    source: 'manual',    status: 'recorrente' },
    { name: 'Mariana Oliveira', phone: '11988004004', email: null,                     source: 'whatsapp',  status: 'novo' },
    { name: 'Patrícia Santos',  phone: '11988005005', email: 'pat.santos@email.com',  source: 'indicacao', status: 'ativo' },
    { name: 'Fernanda Lima',    phone: '21988006006', email: null,                     source: 'whatsapp',  status: 'novo' },
    { name: 'Gabriela Rocha',   phone: '11988007007', email: 'gabi.r@email.com',      source: 'instagram', status: 'ativo' },
    { name: 'Beatriz Almeida',  phone: '11988008008', email: 'bea.almeida@email.com', source: 'manual',    status: 'recorrente' },
  ]

  for (const cli of clientes) {
    const { data: existing } = await supabase.from('contacts').select('id').eq('phone', cli.phone).maybeSingle()
    if (existing) {
      await supabase.from('contacts').update({
        email: cli.email, status: cli.status, tenant_origin: mainTenantId
      }).eq('id', existing.id)
      console.log(`  🔄 ${cli.name} — atualizado`)
    } else {
      await supabase.from('contacts').insert({
        ...cli, tenant_id: mainTenantId, tenant_origin: mainTenantId,
      })
      console.log(`  ✨ ${cli.name} — criado`)
    }
  }
  console.log('')

  // ── 6. Seed: Leads ──
  console.log('── 5. Seed de Leads...')
  const leads = [
    { name: 'Salão Elegance',      phone: '11977001001', source: 'maps',      status: 'new',       validation_status: 'valid' },
    { name: 'Espaço Zen',          phone: '11977002002', source: 'instagram', status: 'contacted', validation_status: 'valid' },
    { name: 'Studio Hair Design',  phone: '11977003003', source: 'maps',      status: 'qualified', validation_status: 'valid' },
    { name: 'Barbearia Premium',   phone: '11977004004', source: 'manual',    status: 'converted', validation_status: 'valid' },
    { name: 'Clínica Renova',      phone: '11977005005', source: 'maps',      status: 'new',       validation_status: 'pending' },
    { name: 'Studio Beauty Line',  phone: '21977006006', source: 'instagram', status: 'contacted', validation_status: 'valid' },
    { name: 'Salão du Charme',     phone: '11977007007', source: 'maps',      status: 'new',       validation_status: 'valid' },
    { name: 'Espaço Corpo & Arte', phone: '11977008008', source: 'manual',    status: 'contacted', validation_status: 'valid' },
    { name: 'Hair Studio VIP',     phone: '11977009009', source: 'instagram', status: 'qualified', validation_status: 'valid' },
    { name: 'Bela Forma Clínica',  phone: '21977010010', source: 'maps',      status: 'new',       validation_status: 'pending' },
  ]

  for (const lead of leads) {
    const { data: existing } = await supabase.from('leads').select('id').eq('phone', lead.phone).maybeSingle()
    if (!existing) {
      await supabase.from('leads').insert({ ...lead, tenant_id: mainTenantId })
      console.log(`  ✨ ${lead.name} — criado`)
    } else {
      console.log(`  ⏭️  ${lead.name} — já existe`)
    }
  }

  console.log('\n═══════════════════════════════════════════')
  console.log('  ✅ Seed concluído!')
  console.log(`  🏪 ${estabelecimentos.length} estabelecimentos`)
  console.log(`  👥 ${clientes.length} clientes`)
  console.log(`  📋 ${leads.length} leads`)
  console.log('  🔗 Acesse: http://localhost:5173')
  console.log('═══════════════════════════════════════════\n')
}

main().catch(err => { console.error('❌ Erro fatal:', err); process.exit(1) })
