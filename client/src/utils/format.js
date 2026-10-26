// Number, money and date formatting shared by the ticketing pages

const numberFormat = new Intl.NumberFormat('cs-CZ')

export const formatNumber = (n) => numberFormat.format(Math.round(n))
export const formatCzk = (cents) => `${numberFormat.format(Math.round(cents / 100))} Kč`
export const formatPercent = (ratio) => `${Math.round(ratio * 100)} %`

// Compact figure for axis ticks: 1 200 → 1,2k
export const formatCompact = (n) => (n >= 1000 ? `${numberFormat.format(Math.round(n / 100) / 10)}k` : formatNumber(n))

export const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d
}

export const formatDay = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export const formatShortDay = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })

export const timeAgo = (iso, now) => {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ago`
  return `${Math.floor(minutes / (24 * 60))} days ago`
}
