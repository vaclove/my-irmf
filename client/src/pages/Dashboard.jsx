import React, { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'
import { formatNumber, formatCzk, formatPercent, formatCompact, formatDay, formatShortDay, timeAgo } from '../utils/format'
import {
  SERIES, GRID_COLOR, AXIS_TEXT, Delta, StatTile, Legend, useElementWidth, niceTicks, topRoundedRect
} from '../components/charts/primitives'

/**
 * Tickets → Dashboard: every ticketing channel and the door of an edition on one
 * page, for management. Data: GET /api/dashboard/:edition_id
 * (server/services/edition-dashboard.js).
 */

// A channel keeps its colour on every chart of the page
const CHANNEL = {
  goout: { label: 'GoOut online', color: SERIES.blue },
  boxOffice: { label: 'Box office', color: SERIES.orange },
  passes: { label: 'Festival passes', color: SERIES.aqua }
}

// How people came in, in badge_scans terms
const ENTRY_TYPES = [
  { key: 'ticket', label: 'GoOut tickets', color: SERIES.blue },
  { key: 'boxOffice', label: 'Box-office tickets', color: SERIES.orange },
  { key: 'pass', label: 'Festival passes', color: SERIES.aqua },
  { key: 'badge', label: 'Badges', color: SERIES.yellow },
  { key: 'other', label: 'Other', color: SERIES.gray }
]

const DAY_METRICS = {
  attendance: {
    label: 'Attendance',
    description: 'Admissions at the door by entry type, per screening day',
    series: ENTRY_TYPES.map(t => ({ ...t, value: d => d.scans[t.key] })),
    format: formatNumber,
    axis: formatCompact
  },
  tickets: {
    label: 'Tickets',
    description: 'Tickets sold for the day\'s screenings, against the seats for sale',
    series: [
      { key: 'goout', ...CHANNEL.goout, value: d => d.gooutSold },
      { key: 'boxOffice', ...CHANNEL.boxOffice, value: d => d.boxOfficeSold }
    ],
    marker: { label: 'Seats for sale', value: d => d.capacity },
    format: formatNumber,
    axis: formatCompact
  },
  revenue: {
    label: 'Revenue',
    description: 'Ticket revenue of the day\'s screenings, without GoOut fees and passes',
    series: [
      { key: 'goout', ...CHANNEL.goout, value: d => d.gooutRevenueCents / 100 },
      { key: 'boxOffice', ...CHANNEL.boxOffice, value: d => d.boxOfficeRevenueCents / 100 }
    ],
    format: v => `${formatNumber(v)} Kč`,
    axis: formatCompact
  }
}

const dayDate = (date) => new Date(`${date}T12:00:00`)

/**
 * Part-to-whole: one horizontal stacked bar with a row per segment
 */
function RevenueMix({ revenue }) {
  const segments = [
    { ...CHANNEL.goout, cents: revenue.gooutTicketsCents },
    { ...CHANNEL.passes, cents: revenue.gooutPassesCents },
    {
      ...CHANNEL.boxOffice,
      cents: revenue.boxOfficeCashCents + revenue.boxOfficeCardCents,
      note: `cash ${formatCzk(revenue.boxOfficeCashCents)} · card ${formatCzk(revenue.boxOfficeCardCents)}`
    }
  ]
  const total = revenue.totalCents
  if (!total) return <div className="text-sm text-gray-500 py-6 text-center">No revenue yet</div>

  return (
    <div>
      <div className="flex h-3 rounded overflow-hidden" role="img" aria-label="Revenue by channel">
        {segments.filter(s => s.cents > 0).map((s, i) => (
          <div key={s.label} title={`${s.label}: ${formatCzk(s.cents)}`}
            style={{ width: `${(s.cents / total) * 100}%`, background: s.color, marginLeft: i ? 2 : 0 }} />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {segments.map(s => (
          <li key={s.label} className="text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-gray-700 truncate">{s.label}</span>
              <span className="ml-auto pl-3 font-medium text-gray-900 tabular-nums whitespace-nowrap">{formatCzk(s.cents)}</span>
              <span className="w-12 text-right text-xs text-gray-500 tabular-nums">{formatPercent(s.cents / total)}</span>
            </div>
            {s.note && <div className="ml-5 text-xs text-gray-500">{s.note}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Admissions by entry type, as bars against the largest type
 */
function EntryTypes({ attendance }) {
  const rows = ENTRY_TYPES.map(t => ({ ...t, count: attendance[t.key] })).filter(r => r.count > 0)
  if (!rows.length) return <div className="text-sm text-gray-500 py-6 text-center">Nobody scanned yet</div>
  const max = Math.max(...rows.map(r => r.count))
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-gray-700">{r.label}</span>
            <span className="text-gray-900 font-medium tabular-nums">
              {formatNumber(r.count)}
              <span className="ml-2 text-xs text-gray-500 font-normal">{formatPercent(r.count / attendance.total)}</span>
            </span>
          </div>
          <div className="mt-1 h-2 bg-gray-100 rounded-r">
            <div className="h-2 rounded-r" style={{ width: `${(r.count / max) * 100}%`, background: r.color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Stacked columns, one per festival day; the metric picks the series.
 */
function DayChart({ days, metric, today }) {
  const [containerRef, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const spec = DAY_METRICS[metric]
  const height = 280
  const margin = { top: 24, right: 12, bottom: 28, left: 48 }

  if (!days.length) {
    return <div ref={containerRef} className="h-64 flex items-center justify-center text-sm text-gray-500">No screenings in the programme</div>
  }

  const stacks = days.map(d => {
    const parts = spec.series.map(s => ({ ...s, v: s.value(d) || 0 })).filter(p => p.v > 0)
    return { day: d, parts, total: parts.reduce((sum, p) => sum + p.v, 0), marker: spec.marker ? spec.marker.value(d) : null }
  })
  const ticks = niceTicks(Math.max(...stacks.map(s => Math.max(s.total, s.marker || 0))))
  const yMax = ticks[ticks.length - 1]

  const plotWidth = Math.max(width - margin.left - margin.right, 1)
  const plotHeight = height - margin.top - margin.bottom
  const band = plotWidth / days.length
  const barWidth = Math.min(24, Math.max(band - 8, 4))
  const x = (i) => margin.left + band * i + (band - barWidth) / 2
  const y = (v) => margin.top + plotHeight - (v / yMax) * plotHeight
  const GAP = 2

  const hovered = hover !== null ? stacks[hover] : null
  const tooltipLeft = hover !== null ? x(hover) + barWidth / 2 : 0
  const flip = tooltipLeft > margin.left + plotWidth / 2

  return (
    <div ref={containerRef} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label={spec.description}>
          {today !== null && days.some(d => d.day === today) && (
            <rect x={margin.left + band * days.findIndex(d => d.day === today)} y={margin.top} width={band} height={plotHeight} fill="#f3f4f6" />
          )}
          {ticks.map(t => (
            <g key={t}>
              <line x1={margin.left} x2={margin.left + plotWidth} y1={y(t)} y2={y(t)} stroke={GRID_COLOR} strokeWidth="1" />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>{spec.axis(t)}</text>
            </g>
          ))}

          {stacks.map((s, i) => {
            let cursor = y(0)
            return (
              <g key={s.day.date}>
                {s.parts.map((p, j) => {
                  const h = y(0) - y(p.v)
                  const top = cursor - h
                  cursor = top
                  const last = j === s.parts.length - 1
                  const drawTop = last ? top : top + GAP
                  const drawHeight = Math.max(cursor + h - drawTop, 0)
                  return last
                    ? <path key={p.key} d={topRoundedRect(x(i), drawTop, barWidth, drawHeight, 4)} fill={p.color} opacity={hover === null || hover === i ? 1 : 0.6} />
                    : <rect key={p.key} x={x(i)} y={drawTop} width={barWidth} height={drawHeight} fill={p.color} opacity={hover === null || hover === i ? 1 : 0.6} />
                })}
                {s.marker > 0 && (
                  <line x1={x(i) - 6} x2={x(i) + barWidth + 6} y1={y(s.marker)} y2={y(s.marker)} stroke="#6b7280" strokeWidth="1.5" />
                )}
                {s.total > 0 && (
                  <text x={x(i) + barWidth / 2} y={y(s.total) - 6} textAnchor="middle" fontSize="11" fill="#374151">
                    {spec.axis(s.total)}
                  </text>
                )}
                <text x={margin.left + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>
                  {formatShortDay(dayDate(s.day.date))}
                </text>
                <rect x={margin.left + band * i} y={margin.top} width={band} height={plotHeight} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            )
          })}
          <line x1={margin.left} x2={margin.left + plotWidth} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeWidth="1" />
        </svg>
      )}

      {hovered && (
        <div
          className="absolute z-10 pointer-events-none bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2 text-xs whitespace-nowrap"
          style={{ top: margin.top, left: flip ? undefined : tooltipLeft + 16, right: flip ? width - tooltipLeft + 16 : undefined }}
        >
          <div className="font-medium text-gray-900">{formatDay(dayDate(hovered.day.date))}</div>
          <div className="text-gray-500 mb-1">{hovered.day.screenings} screenings</div>
          {spec.series.map(s => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="inline-block w-3 h-0.5" style={{ background: s.color }} />
              <span className="text-gray-600">{s.label}</span>
              <span className="ml-auto pl-3 font-medium text-gray-900 tabular-nums">{spec.format(s.value(hovered.day) || 0)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-gray-100 mt-1 pt-1">
            <span className="text-gray-600">Total</span>
            <span className="ml-auto pl-3 font-medium text-gray-900 tabular-nums">{spec.format(hovered.total)}</span>
          </div>
          {metric === 'tickets' && hovered.day.capacity > 0 && (
            <div className="text-gray-500">{formatPercent(hovered.day.sold / hovered.day.capacity)} of {formatNumber(hovered.day.capacity)} seats</div>
          )}
          {metric === 'attendance' && hovered.day.sold > 0 && (
            <div className="text-gray-500">{formatNumber(hovered.day.sold)} tickets sold</div>
          )}
        </div>
      )}
    </div>
  )
}

// Tickets sold against the capacity: GoOut, then box office
function SoldBar({ row }) {
  const total = Math.max(row.capacity || row.sold, 1)
  const goout = row.goout?.sold || 0
  return (
    <div className="flex h-2 w-full bg-gray-100 rounded-r overflow-hidden" title={`${goout} GoOut, ${row.boxOffice.sold} box office`}>
      <div style={{ width: `${Math.min(goout / total, 1) * 100}%`, background: CHANNEL.goout.color }} />
      {row.boxOffice.sold > 0 && (
        <div className="border-l-2 border-white" style={{ width: `${Math.min(row.boxOffice.sold / total, 1) * 100}%`, background: CHANNEL.boxOffice.color }} />
      )}
    </div>
  )
}

const SORTS = {
  time: { label: 'Programme order', compare: null },
  revenue: { label: 'Revenue', compare: (a, b) => b.revenueCents - a.revenueCents },
  sold: { label: 'Tickets sold', compare: (a, b) => b.sold - a.sold },
  occupancy: { label: 'Occupancy', compare: (a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1) },
  attendance: { label: 'Attendance', compare: (a, b) => b.scans.total - a.scans.total }
}

function ScreeningsTable({ screenings, sort }) {
  const compare = SORTS[sort].compare
  const groups = []
  if (compare) {
    groups.push({ key: 'all', rows: [...screenings].sort(compare) })
  } else {
    for (const row of screenings) {
      if (groups[groups.length - 1]?.key !== row.date) groups.push({ key: row.date, date: row.date, rows: [] })
      groups[groups.length - 1].rows.push(row)
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
            <th className="px-4 py-2 text-left font-medium">{compare ? 'When' : 'Time'}</th>
            <th className="px-4 py-2 text-left font-medium">Screening</th>
            <th className="px-4 py-2 text-left font-medium w-44">Sold / seats</th>
            <th className="px-4 py-2 text-right font-medium" title="Tickets bought online">GoOut</th>
            <th className="px-4 py-2 text-right font-medium" title="Tickets sold at the venue">Box office</th>
            <th className="px-4 py-2 text-right font-medium">Occupancy</th>
            <th className="px-4 py-2 text-right font-medium" title="GoOut and box office, without GoOut fees">Revenue</th>
            <th className="px-4 py-2 text-right font-medium" title="Admissions at the door; show-up = ticket holders scanned of tickets sold">Attended</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <Fragment key={group.key}>
              {group.date && (
                <tr className="bg-gray-50">
                  <td colSpan={8} className="px-4 py-1.5 text-xs font-semibold text-gray-700">{formatDay(dayDate(group.date))}</td>
                </tr>
              )}
              {group.rows.map(row => (
                <tr key={row.programmingId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700 tabular-nums whitespace-nowrap">
                    {compare ? `${formatShortDay(dayDate(row.date))} ${row.time}` : row.time}
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">
                      {row.title}
                      {row.goout?.saleState === 'sold_out' && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">● Sold out</span>
                      )}
                      {row.freeEntry && <span className="ml-2 text-xs text-gray-400">free entry</span>}
                    </div>
                    <div className="text-xs text-gray-500">{row.venue}</div>
                  </td>
                  <td className="px-4 py-2">
                    {row.freeEntry ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><SoldBar row={row} /></div>
                        <span className="text-xs text-gray-700 tabular-nums whitespace-nowrap">
                          {row.sold}{row.capacity ? ` / ${row.capacity}` : ''}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {row.goout ? row.goout.sold : <span className="text-gray-400" title={row.gooutLinked ? 'GoOut data not loaded' : 'Not sold on GoOut'}>—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.boxOffice.sold || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.occupancy !== null ? formatPercent(row.occupancy) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{row.revenueCents ? formatCzk(row.revenueCents) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap"
                    title={ENTRY_TYPES.map(t => `${row.scans[t.key]} ${t.label.toLowerCase()}`).join(', ')}>
                    {row.scans.total || '—'}
                    {row.showUp !== null && (
                      <span className="ml-1 text-xs text-gray-500">({formatPercent(row.showUp)})</span>
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Dashboard = () => {
  const { selectedEdition } = useEdition()
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState('attendance')
  const [sort, setSort] = useState('time')
  const [now, setNow] = useState(Date.now())

  // Only the latest request may update the page (an older edition's load can finish later)
  const requestRef = useRef(0)
  const load = useCallback(async (refresh = false) => {
    if (!selectedEdition) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const response = await axios.get(`/api/dashboard/${selectedEdition.id}`, { params: refresh ? { refresh: 1 } : {} })
      // An unknown /api path is answered with index.html (e.g. an older server during a deploy)
      if (!response.data?.edition) {
        throw new Error('Unexpected response from the server, try reloading the page in a minute')
      }
      if (requestId === requestRef.current) setDashboard(response.data)
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err.response?.data?.error || err.message || 'Failed to load the dashboard')
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [selectedEdition])

  useEffect(() => {
    setDashboard(null)
    load()
  }, [load])

  // Box office and the door change by the minute: reload while the page is visible
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') load()
    }, 60000)
    return () => clearInterval(timer)
  }, [load])

  if (!selectedEdition) {
    return <div className="text-center py-12 text-gray-500">Please select an edition to see the dashboard.</div>
  }

  if (!dashboard) {
    return (
      <div className="text-center py-12 text-gray-500">
        {error ? <p className="text-red-600">{error}</p> : <p>Loading the dashboard… GoOut takes a few seconds.</p>}
      </div>
    )
  }

  const { edition, totals, goout, previous, activity } = dashboard
  const { revenue, tickets, passes, attendance } = totals
  const comparison = goout?.comparison
  const status = dashboard.today === null
    ? (dashboard.festivalLength === null ? 'No festival dates' : 'Festival is over')
    : dashboard.today < 0
      ? `${-dashboard.today} ${dashboard.today === -1 ? 'day' : 'days'} to the festival`
      : `Festival day ${dashboard.today + 1} of ${dashboard.festivalLength + 1}`
  const previousRevenue = previous && comparison
    ? comparison.final.revenueCents + previous.boxOffice.revenueCents
    : null

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard {edition.year}</h1>
          <p className="text-sm text-gray-500 mt-1">{status} · online presale, box office and the door</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>Updated {timeAgo(dashboard.updatedAt, now)}</span>
          <button onClick={() => load(true)} disabled={loading}
            className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {loading ? 'Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {(error || dashboard.errors.length > 0) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
          {error && <div>⚠ {error}</div>}
          {dashboard.errors.length > 0 && (
            <div>
              ⚠ Some data is missing, numbers may be incomplete:
              <ul className="list-disc ml-5 mt-1">
                {dashboard.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile label="Revenue" value={formatCzk(revenue.totalCents)}>
          <div>online {goout ? formatCzk(revenue.gooutTicketsCents + revenue.gooutPassesCents) : 'unavailable'} · door {formatCzk(revenue.boxOfficeCashCents + revenue.boxOfficeCardCents)}</div>
          {comparison && <div><Delta current={revenue.gooutTicketsCents + revenue.gooutPassesCents} previous={comparison.atSamePoint.revenueCents} year={comparison.year} suffix="online at this point" /></div>}
          {previousRevenue !== null && <div>{previous.year} final: {formatCzk(previousRevenue)}</div>}
        </StatTile>
        <StatTile label="Tickets sold" value={formatNumber(tickets.paid)}>
          <div>GoOut {goout ? formatNumber(tickets.goout.paid) : 'unavailable'} · box office {formatNumber(tickets.boxOffice.paid)}</div>
          {comparison && <div><Delta current={tickets.goout.paid} previous={comparison.atSamePoint.tickets} year={comparison.year} suffix="online at this point" /></div>}
          {tickets.free > 0 && <div>+ {formatNumber(tickets.free)} free / partner</div>}
        </StatTile>
        <StatTile label="Festival passes" value={formatNumber(passes.paid)}>
          <div>{formatNumber(passes.converted)} picked up as badges</div>
          {comparison && <div><Delta current={passes.paid} previous={comparison.atSamePoint.passes} year={comparison.year} /></div>}
          {passes.free > 0 && <div>+ {formatNumber(passes.free)} free</div>}
        </StatTile>
        <StatTile label="Box office" value={formatCzk(revenue.boxOfficeCashCents + revenue.boxOfficeCardCents)}>
          <div>cash {formatCzk(revenue.boxOfficeCashCents)} · card {formatCzk(revenue.boxOfficeCardCents)}</div>
          <div>today {formatNumber(tickets.boxOffice.today.tickets)} tickets, {formatCzk(tickets.boxOffice.today.revenueCents)}</div>
          {activity.lastSaleAt && <div>last sale {timeAgo(activity.lastSaleAt, now)}</div>}
        </StatTile>
        <StatTile label="Attendance" value={formatNumber(attendance.total)}>
          <div>admissions at the door</div>
          {attendance.showUp !== null && (
            <div title="Ticket holders scanned of tickets sold, screenings that have started">show-up {formatPercent(attendance.showUp)} of tickets sold</div>
          )}
          {activity.lastScanAt
            ? <div>last scan {timeAgo(activity.lastScanAt, now)}</div>
            : previous && <div>{previous.year} final: {formatNumber(previous.admissions)}</div>}
        </StatTile>
        <StatTile label="Occupancy" value={totals.occupancy !== null ? formatPercent(totals.occupancy) : '—'}>
          <div>of {formatNumber(totals.capacity)} seats for sale, {totals.screenings} screenings</div>
          {totals.soldOut > 0 && <div>{totals.soldOut} sold out</div>}
        </StatTile>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900">Revenue by channel</h2>
          <p className="text-xs text-gray-500 mb-3">GoOut prices without GoOut fees; box office without cancelled tickets</p>
          <RevenueMix revenue={revenue} />
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900">How people came in</h2>
          <p className="text-xs text-gray-500 mb-3">
            {formatNumber(attendance.total)} admissions
            {attendance.showUp !== null && ` · show-up ${formatPercent(attendance.showUp)} at ${attendance.startedScreenings} screenings that have started`}
          </p>
          <EntryTypes attendance={attendance} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Festival days</h2>
            <p className="text-xs text-gray-500">{DAY_METRICS[metric].description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Legend items={[
              ...DAY_METRICS[metric].series,
              ...(DAY_METRICS[metric].marker ? [{ label: DAY_METRICS[metric].marker.label, color: '#6b7280', line: true }] : [])
            ].map(s => ({ label: s.label, color: s.color, line: s.line }))} />
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
              {Object.entries(DAY_METRICS).map(([key, m]) => (
                <button key={key} onClick={() => setMetric(key)}
                  className={`px-2.5 py-1 ${metric === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DayChart days={dashboard.days} metric={metric} today={dashboard.today} />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap justify-between items-center gap-3 px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Screenings</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Legend items={[CHANNEL.goout, CHANNEL.boxOffice]} />
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Sort by
              <select value={sort} onChange={e => setSort(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white">
                {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <ScreeningsTable screenings={dashboard.screenings} sort={sort} />
      </div>
    </div>
  )
}

export default Dashboard
