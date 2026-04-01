// ============================================================
// search.ts — Web Search endpoint for James Intelligence
// Uses DuckDuckGo (free, no key) + optional Google CSE
// ============================================================
import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import { logger } from './logger'

export const router = express.Router()

interface SearchResult {
  title: string
  snippet: string
  url: string
}

// ── DuckDuckGo Instant Answer (free, no key) ───────────────────
async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`
  const { data } = await axios.get(url, { timeout: 5000 })

  const results: SearchResult[] = []

  // Abstract (best single answer)
  if (data.AbstractText) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || '' })
  }
  // Answer (math, facts)
  if (data.Answer) {
    results.push({ title: 'Resposta direta', snippet: data.Answer, url: '' })
  }
  // Related Topics
  if (data.RelatedTopics?.length) {
    data.RelatedTopics.slice(0, 4).forEach((t: {Text?: string; FirstURL?: string; Name?: string}) => {
      if (t.Text) results.push({ title: t.Name || 'Resultado', snippet: t.Text, url: t.FirstURL || '' })
    })
  }

  return results
}

// ── Google Custom Search (optional, needs GOOGLE_API_KEY + GOOGLE_SEARCH_ENGINE_ID) ──
async function googleSearch(query: string): Promise<SearchResult[]> {
  const key  = process.env.GOOGLE_API_KEY
  const cx   = process.env.GOOGLE_SEARCH_ENGINE_ID
  if (!key || !cx) return []

  const url  = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=5&hl=pt-BR`
  const { data } = await axios.get(url, { timeout: 6000 })

  return (data.items ?? []).map((item: {title: string; snippet: string; link: string}) => ({
    title:   item.title,
    snippet: item.snippet,
    url:     item.link,
  }))
}

// ── POST /api/search { query } ─────────────────────────────────
router.post('/', async (req, res) => {
  const { query } = req.body
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query required' }); return
  }

  try {
    // Try Google first (if configured), fall back to DuckDuckGo
    let results = await googleSearch(query)
    if (!results.length) results = await duckduckgoSearch(query)

    logger.info('Search', { query, resultCount: results.length })
    res.json({ results, query })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Search error', { err: msg })
    res.status(500).json({ error: msg })
  }
})
