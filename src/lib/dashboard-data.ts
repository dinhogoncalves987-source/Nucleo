export type Resource<T> = { status: 'ready'; data: T } | { status: 'error' }
export type ReadPage = (table: 'finances' | 'leads', tenantId: string, from: number, to: number, start: string, end: string) => PromiseLike<{ data: unknown[] | null; error: unknown; count: number | null }>
export type LeadCounts = Record<'new' | 'contacted' | 'qualified' | 'converted' | 'lost', number>
export type BillingPoint = { month: string; value: number }
const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export function monthWindow(now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

export function groupFinances(rows: unknown[], start: string, end: string): BillingPoint[] {
  const totals = new Map<string, number>()
  const cursor = new Date(start)
  while (cursor.toISOString() < end) {
    totals.set(cursor.toISOString().slice(0, 7), 0)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  for (const value of rows) {
    const row = value as { transaction_date?: unknown; amount?: unknown }
    if (!row || typeof row.transaction_date !== 'string' ||
        !['number', 'string'].includes(typeof row.amount) || String(row.amount).trim() === '') throw new Error('Invalid finance')
    const date = new Date(row.transaction_date)
    const amount = Number(row.amount)
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(amount)) throw new Error('Invalid finance')
    const iso = date.toISOString()
    if (iso < start || iso >= end) throw new Error('Finance outside requested window')
    const key = iso.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + Math.round(amount * 100))
  }
  return [...totals].map(([key, cents]) => ({ month: `${months[Number(key.slice(5)) - 1]}/${key.slice(2, 4)}`, value: cents / 100 }))
}

export function countLeads(rows: unknown[]): LeadCounts {
  const counts: LeadCounts = { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 }
  for (const value of rows) {
    const row = value as { status?: unknown }
    if (!row || typeof row.status !== 'string' || !Object.prototype.hasOwnProperty.call(counts, row.status)) throw new Error('Unknown lead status')
    counts[row.status as keyof LeadCounts]++
  }
  return counts
}

export function conversionRate(counts: LeadCounts): number | null {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return total === 0 ? null : counts.converted * 100 / total
}

export async function readAllRows(read: ReadPage, table: 'finances' | 'leads', tenantId: string, start: string, end: string) {
  if (!tenantId) throw new Error('Missing tenant')
  const rows: unknown[] = []
  let expected: number | null = null
  for (;;) {
    const result = await read(table, tenantId, rows.length, rows.length + 999, start, end)
    if (result.error || !Array.isArray(result.data) || !Number.isInteger(result.count) || result.count === null || result.count < 0) throw new Error('Unavailable data')
    if (expected !== null && expected !== result.count) throw new Error('Data changed while reading')
    expected = result.count
    rows.push(...result.data)
    if (rows.length === expected) return rows
    if (rows.length > expected || result.data.length === 0) throw new Error('Incomplete data')
  }
}

export async function loadDashboard(read: ReadPage, tenantId: string, now: Date) {
  const { start, end } = monthWindow(now)
  async function resource<T>(table: 'finances' | 'leads', transform: (rows: unknown[]) => T): Promise<Resource<T>> {
    try { return { status: 'ready', data: transform(await readAllRows(read, table, tenantId, start, end)) } }
    catch { return { status: 'error' } }
  }
  const [billing, leads] = await Promise.all([
    resource('finances', rows => ({ points: groupFinances(rows, start, end), count: rows.length })),
    resource('leads', countLeads),
  ])
  return { billing, leads }
}

// A refresh supersedes older requests; cleanup invalidates all outstanding work.
export function createRequestGate() {
  let generation = 0
  return {
    begin() { const current = ++generation; return () => current === generation },
    cancel() { generation++ },
  }
}
