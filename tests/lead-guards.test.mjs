import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/pages/Leads.tsx', import.meta.url), 'utf8')
test('both legacy contact handlers reject before any model or browser operation', () => {
  const generation = source.slice(source.indexOf('const handleBlitz ='), source.indexOf('const handleCadenciadoBlitz ='))
  const cadence = source.slice(source.indexOf('const handleCadenciadoBlitz ='), source.indexOf('//', source.indexOf("    setCadCurrentLead('')")))
  assert.ok(generation.indexOf('if (!LEAD_CONTACT_AVAILABLE)') < generation.indexOf('await generateBatchMessages'))
  assert.ok(cadence.indexOf('if (!LEAD_CONTACT_AVAILABLE)') < cadence.indexOf('for (let i'))
  assert.ok(cadence.indexOf('if (!LEAD_CONTACT_AVAILABLE)', cadence.indexOf('for (let i')) < cadence.indexOf('window.open('))
})
test('no renderable WhatsApp link or result-copy panel bypasses the closed contact gate', () => {
  assert.ok(!source.includes('<a href={whatsappRecipientNumber'))
  assert.ok(source.includes('aria-label="Contato indisponivel"'))
  assert.ok(source.includes('disabled={!LEAD_CONTACT_AVAILABLE || blitzing}'))
  assert.ok(source.includes('disabled={!LEAD_CONTACT_AVAILABLE}'))
  assert.ok(source.includes('{LEAD_CONTACT_AVAILABLE && blitzOpen &&'))
})
test('mutations scope tenant and exact displayed IDs and require returned rows', () => {
  assert.ok(source.includes("query.eq('tenant_id', request.tenantId).in('id', request.ids).select('id,tenant_id,status')"))
  assert.ok(source.includes('const ids = leads.map(lead => lead.id)'))
  assert.ok(source.includes("await changeLeadRecords('delete', ids)"))
  assert.ok(source.includes('Recibos e registros de origem da importacao permanecem'))
  assert.ok(!source.includes(".delete().eq('tenant_id', tenant!.id)"))
})
test('identity changes unmount pending mutation UI and uncertain outcomes block further writes', () => {
  assert.ok(source.includes("(tenant?.id ?? 'no-tenant') + ':' + (user?.id ?? 'no-user')"))
  assert.ok(source.includes('mutationBusyRef.current || mutationBlocked'))
  assert.ok(source.includes("error.outcome === 'uncertain') setMutationBlocked(true)"))
  assert.ok(source.includes('mountedRef.current && tenantIdRef.current === tenantId'))
})
