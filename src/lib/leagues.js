// Picks the current softcore trade league from /api/trade/data/leagues.

const PERMANENT = new Set(['Standard', 'Hardcore', 'Ruthless', 'Hardcore Ruthless'])

export function tradeLeagues (apiResult) {
  return (apiResult?.result ?? []).filter(l => (l.realm ?? 'pc') === 'pc').map(l => l.id)
}

export function pickCurrentLeague (leagues) {
  const temp = leagues.filter(id =>
    !PERMANENT.has(id) && !/hardcore|\bHC\b|ruthless|\bSSF\b/i.test(id))
  return temp[0] ?? 'Standard'
}
