import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('development identity cannot be enabled by a production VITE flag', () => {
  const source = read('src/contexts/TenantContext.tsx')
  assert.match(source, /const DEV_MODE = import\.meta\.env\.DEV && import\.meta\.env\.VITE_DEV_AUTH_BYPASS === 'true'/)
  assert.match(source, /email: 'dev@example\.invalid'/)
})

test('sidebar fallback is a label and not a bundled mailbox', () => {
  const source = read('src/components/Sidebar.tsx')
  assert.match(source, /user\?\.email \?\? 'Conta autenticada'/)
})

test('opening training reads the tenant state without implicit writes', () => {
  const source = read('src/pages/JamesTraining.tsx')
  const load = source.slice(source.indexOf('// Load saved state'), source.indexOf('// Navigate'))
  assert.match(load, /\.eq\('tenant_id', tenantId\)/)
  assert.match(load, /\.select\('response'\)/)
  assert.doesNotMatch(load, /\.insert\(|\.delete\(|\.upsert\(|\.update\(|syncLearningMemories|autoSeedKnowledge/)
  assert.doesNotMatch(source, /BEAUTY_HUB_DEEP_KNOWLEDGE|autoSeedKnowledge/)
})

test('explicit tenant training save paths remain available', () => {
  const source = read('src/pages/JamesTraining.tsx')
  const actions = source.slice(source.indexOf('// Navigate'), source.indexOf('if (loading)'))
  assert.match(actions, /await saveWizardState\(tenantId, ctx, nextStep\)/)
  assert.match(actions, /await syncLearningMemories\(tenantId, ctx\)/)
  assert.match(actions, /const handleFinalize = async/)
})
