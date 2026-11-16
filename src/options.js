const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)
const DEFAULTS = { league: '', rollPercent: 90, countOffset: 0, status: 'available' }

async function init () {
  const s = await api.storage.sync.get(DEFAULTS)
  $('status').value = s.status
  $('rollPercent').value = s.rollPercent
  $('countOffset').value = s.countOffset

  const select = $('league')
  try {
    const res = await api.runtime.sendMessage({ type: 'leagues' })
    if (res?.error) throw new Error(res.error)
    select.options[0].textContent = `Auto (${res.current})`
    for (const id of res.list) select.add(new Option(id, id))
  } catch (e) {
    $('status').textContent = `Could not load the league list: ${e.message}`
  }
  if (s.league && ![...select.options].some(o => o.value === s.league)) select.add(new Option(s.league, s.league))
  select.value = s.league

  for (const id of ['league', 'status', 'rollPercent', 'countOffset']) $(id).addEventListener('change', save)
}

async function save () {
  const rollPercent = Math.min(100, Math.max(0, Math.round(Number($('rollPercent').value) || DEFAULTS.rollPercent)))
  const countOffset = Math.min(10, Math.max(0, Math.round(Number($('countOffset').value) || 0)))
  $('rollPercent').value = rollPercent
  $('countOffset').value = countOffset
  await api.storage.sync.set({ league: $('league').value, status: $('status').value, rollPercent, countOffset })
  $('status').textContent = 'Saved.'
}

init()
