import { StatIndex } from './lib/stats.js'
import { ItemsDb } from './lib/items-db.js'
import { buildItemQuery, buildGemQuery, tradeUrl, DEFAULT_OPTIONS } from './lib/query.js'
import { tradeLeagues, pickCurrentLeague } from './lib/leagues.js'

const api = globalThis.browser ?? globalThis.chrome
const LEAGUES_URL = 'https://www.pathofexile.com/api/trade/data/leagues'
const LEAGUE_TTL = 6 * 60 * 60 * 1000

let dbPromise = null
function loadDb () {
  dbPromise ??= Promise.all([
    fetch(api.runtime.getURL('data/stats.ndjson')).then(r => r.text()),
    fetch(api.runtime.getURL('data/items.ndjson')).then(r => r.text())
  ]).then(([stats, items]) => ({ stats: new StatIndex(stats), items: new ItemsDb(items) }))
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

async function getSettings () {
  const s = await api.storage.sync.get({ league: '', rollPercent: DEFAULT_OPTIONS.rollPercent, countOffset: DEFAULT_OPTIONS.countOffset, status: DEFAULT_OPTIONS.status })
  return {
    league: String(s.league || ''),
    status: String(s.status || DEFAULT_OPTIONS.status),
    rollPercent: Math.min(100, Math.max(0, Number(s.rollPercent) || DEFAULT_OPTIONS.rollPercent)),
    countOffset: Math.max(0, Number(s.countOffset) || 0)
  }
}

async function getLeagues () {
  const { leagueCache } = await api.storage.local.get('leagueCache')
  if (leagueCache && Date.now() - leagueCache.at < LEAGUE_TTL && leagueCache.list?.length) return leagueCache.list
  try {
    const res = await fetch(LEAGUES_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const list = tradeLeagues(await res.json())
    if (!list.length) throw new Error('empty league list')
    await api.storage.local.set({ leagueCache: { at: Date.now(), list } })
    return list
  } catch (e) {
    if (leagueCache?.list?.length) return leagueCache.list
    throw new Error(`Could not load leagues from pathofexile.com (${e.message})`)
  }
}

async function resolveLeague (settings) {
  if (settings.league) return settings.league
  try {
    return pickCurrentLeague(await getLeagues())
  } catch {
    return 'Standard'
  }
}

async function openTrade (msg, sender) {
  const db = await loadDb()
  const settings = await getSettings()
  const result = msg.kind === 'gem'
    ? buildGemQuery(msg.gem, db, settings)
    : buildItemQuery(msg.text, db, settings)
  const league = await resolveLeague(settings)
  const url = tradeUrl(league, result.query)
  const tab = sender.tab
  await api.tabs.create({
    url,
    active: !msg.background,
    ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {})
  })
  return { label: result.label, matched: result.matched, total: result.total, skipped: result.skipped, league, known: result.known }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let work
  if (msg?.type === 'trade') work = openTrade(msg, sender)
  else if (msg?.type === 'leagues') work = getLeagues().then(list => ({ list, current: pickCurrentLeague(list) }))
  else return false
  work.then(sendResponse, e => sendResponse({ error: e.message || String(e) }))
  return true
})
