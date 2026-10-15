import React, { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'

// Chart colours: categorical slots 1 and 2 of the data-viz palette (validated as a pair)
const CURRENT_COLOR = '#2a78d6'
const PREVIOUS_COLOR = '#eb6834'
const FREE_COLOR = '#86b6ef' // lighter step of the same blue ramp
const GRID_COLOR = '#e5e7eb'

const numberFormat = new Intl.NumberFormat('cs-CZ')
const formatNumber = (n) => numberFormat.format(Math.round(n))
const formatCzk = (cents) => `${numberFormat.format(Math.round(cents / 100))} Kč`
const formatPercent = (ratio) => `${Math.round(ratio * 100)} %`

const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d
}
const formatDay = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const relativeDay = (day) => {
  if (day < 0) return `${-day} ${day === -1 ? 'day' : 'days'} before`
  return `Festival day ${day + 1}`
}

const timeAgo = (iso, now) => {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

// Change against the previous edition, as an arrow + percentage
function Delta({ current, previous, year }) {
  if (!previous) {
    return <span className="text-gray-500">{year}: none at this point</span>
  }
  const change = (current - previous) / previous
  if (Math.round(change * 100) === 0) {
    return <span className="text-gray-500">same as {year} at this point</span>
  }
  const up = change > 0
  return (
    <span className={up ? 'text-green-700' : 'text-red-700'}>
      {up ? '▲' : '▼'} {formatPercent(Math.abs(change))}
      <span className="text-gray-500"> vs {year} at this point</span>
    </span>
  )
}

function StatTile({ label, value, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-gray-500 space-y-0.5">{children}</div>
    </div>
  )
}

// Callback ref + width of the element it is attached to
function useElementWidth() {
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}

// Round axis maximum to 1, 2 or 5 × 10^n per step
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

/**
 * Cumulative sales by day relative to the festival start, this edition vs the previous one.
 */
function SalesChart({ presale, metric }) {
  const [containerRef, width] = useElementWidth()
  const [hoverDay, setHoverDay] = useState(null)
  const height = 300
  const margin = { top: 12, right: 44, bottom: 28, left: 56 }

  const value = metric === 'revenue' ? (p) => p.revenueCents / 100 : (p) => p.tickets
  const series = [
    { key: 'current', year: presale.edition.year, color: CURRENT_COLOR, points: presale.timeline },
    presale.comparison && {
      key: 'previous', year: presale.comparison.year, color: PREVIOUS_COLOR, points: presale.comparison.timeline
    }
  ].filter(s => s && s.points.length)

  if (!series.length) {
    return (
      <div ref={containerRef} className="h-72 flex items-center justify-center text-sm text-gray-500">
        No tickets sold yet
      </div>
    )
  }

  const allPoints = series.flatMap(s => s.points)
  const minDay = Math.min(...allPoints.map(p => p.day))
  const maxDay = Math.max(presale.festivalLength, ...allPoints.map(p => p.day))
  const ticks = niceTicks(Math.max(...allPoints.map(value)))
  const yMax = ticks[ticks.length - 1]

  const plotWidth = Math.max(width - margin.left - margin.right, 1)
  const plotHeight = height - margin.top - margin.bottom
  const x = (day) => margin.left + ((day - minDay) / Math.max(maxDay - minDay, 1)) * plotWidth
  const y = (v) => margin.top + plotHeight - (v / yMax) * plotHeight
  const formatValue = metric === 'revenue' ? (v) => `${formatNumber(v)} Kč` : (v) => formatNumber(v)
  const formatAxis = metric === 'revenue'
    ? (v) => (v >= 1000 ? `${formatNumber(v / 1000)}k` : formatNumber(v))
    : formatNumber

  // A tick every week, counted back from the festival start
  const xTicks = []
  for (let day = 0; day >= minDay; day -= 7) xTicks.unshift(day)

  const pointAt = (s, day) => {
    if (day < s.points[0].day || day > s.points[s.points.length - 1].day) return null
    return s.points.find(p => p.day === day)
  }

  const handleMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const day = Math.round(minDay + ((event.clientX - rect.left - margin.left) / plotWidth) * (maxDay - minDay))
    setHoverDay(Math.min(Math.max(day, minDay), maxDay))
  }

  const tooltipLeft = hoverDay !== null ? x(hoverDay) : 0
  const flip = tooltipLeft > margin.left + plotWidth / 2

  return (
    <div ref={containerRef} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" role="img"
          aria-label={`Cumulative ${metric} by days before the festival`}>
          {/* Festival days */}
          <rect x={x(0)} y={margin.top} width={Math.max(x(presale.festivalLength) - x(0), 0)}
            height={plotHeight} fill="#f3f4f6" />
          <text x={x(0) + 4} y={margin.top + 12} fontSize="11" fill="#6b7280">Festival</text>

          {ticks.map(t => (
            <g key={t}>
              <line x1={margin.left} x2={margin.left + plotWidth} y1={y(t)} y2={y(t)} stroke={GRID_COLOR} strokeWidth="1" />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#6b7280">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {xTicks.map(day => (
            <text key={day} x={x(day)} y={height - 8} textAnchor="middle" fontSize="11" fill="#6b7280">
              {day === 0 ? 'Start' : `${day} d`}
            </text>
          ))}

          {series.map(s => {
            const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(value(p))}`).join('')
            const last = s.points[s.points.length - 1]
            return (
              <g key={s.key}>
                <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <text x={x(last.day) + 6} y={y(value(last))} dy="0.32em" fontSize="11" fill="#374151">
                  {s.year}
                </text>
              </g>
            )
          })}

          {hoverDay !== null && (
            <g pointerEvents="none">
              <line x1={x(hoverDay)} x2={x(hoverDay)} y1={margin.top} y2={margin.top + plotHeight} stroke="#9ca3af" strokeWidth="1" />
              {series.map(s => {
                const p = pointAt(s, hoverDay)
                return p && (
                  <circle key={s.key} cx={x(p.day)} cy={y(value(p))} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />
                )
              })}
            </g>
          )}

          <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="transparent"
            onMouseMove={handleMove} onMouseLeave={() => setHoverDay(null)} />
        </svg>
      )}

      {hoverDay !== null && (
        <div
          className="absolute z-10 pointer-events-none bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2 text-xs whitespace-nowrap"
          style={{
            top: margin.top,
            left: flip ? undefined : tooltipLeft + 12,
            right: flip ? width - tooltipLeft + 12 : undefined
          }}
        >
          <div className="font-medium text-gray-900">{relativeDay(hoverDay)}</div>
          <div className="text-gray-500 mb-1">{formatDay(addDays(presale.edition.startDate, hoverDay))}</div>
          {series.map(s => {
            const p = pointAt(s, hoverDay)
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-gray-600">{s.year}</span>
                <span className="ml-auto pl-3 font-medium text-gray-900 tabular-nums">
                  {p ? formatValue(value(p)) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Breakdown({ title, rows, label }) {
  if (!rows.length) return null
  const max = Math.max(...rows.map(r => r.tickets))
  return (
    <div>
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{title}</h3>
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={label(row)} className="text-sm" title={`${formatNumber(row.tickets)} tickets · ${formatCzk(row.revenueCents)}`}>
            <div className="flex justify-between gap-2">
              <span className="text-gray-700 truncate">
                {label(row)}
                {row.free && <span className="ml-1 text-xs text-gray-500">(free)</span>}
              </span>
              <span className="text-gray-900 font-medium tabular-nums">{formatNumber(row.tickets)}</span>
            </div>
            <div className="mt-1 h-2 bg-gray-100 rounded-r">
              <div className="h-2 rounded-r" style={{ width: `${(row.tickets / max) * 100}%`, background: row.free ? FREE_COLOR : CURRENT_COLOR }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Sold tickets against the venue capacity: paid, then free (partner) tickets
function OccupancyBar({ row }) {
  const total = Math.max(row.capacity || row.sold, 1)
  return (
    <div className="flex h-2 w-full bg-gray-100 rounded-r overflow-hidden" title={`${row.paid} paid, ${row.free} free`}>
      <div style={{ width: `${Math.min(row.paid / total, 1) * 100}%`, background: CURRENT_COLOR }} />
      {row.free > 0 && (
        <div className="border-l-2 border-white"
          style={{ width: `${Math.min(row.free / total, 1) * 100}%`, background: FREE_COLOR }} />
      )}
    </div>
  )
}

function ScreeningsTable({ screenings }) {
  const [expanded, setExpanded] = useState(null)
  const showScans = screenings.some(r => r.scans.total > 0)
  const columns = showScans ? 8 : 7

  const days = []
  for (const row of screenings) {
    if (days[days.length - 1]?.date !== row.date) days.push({ date: row.date, rows: [] })
    days[days.length - 1].rows.push(row)
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
            <th className="px-4 py-2 text-left font-medium">Time</th>
            <th className="px-4 py-2 text-left font-medium">Screening</th>
            <th className="px-4 py-2 text-left font-medium w-48">Sold / capacity</th>
            <th className="px-4 py-2 text-right font-medium">Occupancy</th>
            <th className="px-4 py-2 text-right font-medium">Revenue</th>
            <th className="px-4 py-2 text-right font-medium" title="Paid tickets in the last 24 hours">24 h</th>
            {showScans && <th className="px-4 py-2 text-right font-medium" title="All scans: tickets, passes and badges">Scanned</th>}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {days.map(day => (
            <Fragment key={day.date}>
              <tr className="bg-gray-50">
                <td colSpan={columns} className="px-4 py-1.5 text-xs font-semibold text-gray-700">
                  {formatDay(new Date(`${day.date}T12:00:00`))}
                </td>
              </tr>
              {day.rows.map(row => (
                <Fragment key={row.programmingId}>
                  <tr
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === row.programmingId ? null : row.programmingId)}
                  >
                    <td className="px-4 py-2 text-gray-700 tabular-nums">{row.time}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">
                        {row.title}
                        {row.saleState === 'sold_out' && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            ● Sold out
                          </span>
                        )}
                        {row.hidden && <span className="ml-2 text-xs text-gray-400">hidden</span>}
                      </div>
                      <div className="text-xs text-gray-500">{row.venue}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><OccupancyBar row={row} /></div>
                        <span className="text-xs text-gray-700 tabular-nums whitespace-nowrap">
                          {row.sold}{row.capacity ? ` / ${row.capacity}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {row.occupancy !== null ? formatPercent(row.occupancy) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{formatCzk(row.revenueCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.last24h ? `+${row.last24h}` : '—'}</td>
                    {showScans && (
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700"
                        title={`${row.scans.tickets} tickets, ${row.scans.passes} passes, ${row.scans.badges} badges`}>
                        {row.scans.total || '—'}
                      </td>
                    )}
                    <td className="px-2 py-2 text-gray-400">{expanded === row.programmingId ? '▾' : '▸'}</td>
                  </tr>
                  {expanded === row.programmingId && (
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <td />
                      <td colSpan={columns - 1} className="px-4 py-3">
                        <ScreeningDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScreeningDetail({ row }) {
  return (
    <div className="flex flex-wrap gap-8 text-sm">
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Categories</div>
        {row.deals.length === 0 && <div className="text-gray-500">No tickets yet</div>}
        {row.deals.map(d => (
          <div key={d.name} className="flex gap-4 justify-between">
            <span className="text-gray-700">{d.name}</span>
            <span className="tabular-nums text-gray-900">{d.tickets} · {formatCzk(d.revenueCents)}</span>
          </div>
        ))}
      </div>
      {row.discounts.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Promo codes</div>
          {row.discounts.map(d => (
            <div key={d.code} className="flex gap-4 justify-between">
              <span className="text-gray-700">{d.code}</span>
              <span className="tabular-nums text-gray-900">{d.tickets}</span>
            </div>
          ))}
        </div>
      )}
      {row.scans.total > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Scanned</div>
          <div className="text-gray-700">{row.scans.tickets} tickets · {row.scans.passes} passes · {row.scans.badges} badges</div>
        </div>
      )}
      <div className="space-y-1">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">GoOut</div>
        {row.saleIds.map(saleId => (
          <div key={saleId}>
            <a href={`https://admin.goout.net/en/ticketing/sale/${saleId}/`} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800">Sale {saleId} in admin ↗</a>
          </div>
        ))}
        {row.gooutUrl && (
          <div>
            <a href={row.gooutUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
              Public page ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

const Presale = () => {
  const { selectedEdition } = useEdition()
  const [presale, setPresale] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState('tickets')
  const [now, setNow] = useState(Date.now())

  // Only the latest request may update the page (an older edition's load can finish later)
  const requestRef = useRef(0)
  const load = useCallback(async (refresh = false) => {
    if (!selectedEdition) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const response = await axios.get(`/api/goout/presale/${selectedEdition.id}`, {
        params: refresh ? { refresh: 1 } : {}
      })
      // An unknown /api path is answered with index.html (e.g. an older server during a deploy)
      if (!response.data?.edition) {
        throw new Error('Unexpected response from the server, try reloading the page in a minute')
      }
      if (requestId === requestRef.current) setPresale(response.data)
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err.response?.data?.error || err.message || 'Failed to load presale data')
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [selectedEdition])

  useEffect(() => {
    setPresale(null)
    load()
  }, [load])

  // Keeps "updated … ago" current
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select an edition to see the presale.</p>
      </div>
    )
  }

  if (!presale) {
    return (
      <div className="text-center py-12 text-gray-500">
        {error
          ? <p className="text-red-600">{error}</p>
          : <p>Loading presale from GoOut… this takes a few seconds.</p>}
      </div>
    )
  }

  if (presale.empty) {
    return <div className="text-center py-12 text-gray-500">{presale.reason}</div>
  }

  const { totals, comparison, edition } = presale
  const compareYear = comparison?.year
  const status = presale.today === null
    ? 'Festival is over'
    : presale.today < 0
      ? `${-presale.today} ${presale.today === -1 ? 'day' : 'days'} to the festival`
      : `Festival day ${presale.today + 1}`

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Presale {edition.year}</h1>
          <p className="text-sm text-gray-500 mt-1">{status} · GoOut tickets, prices without GoOut fees</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>Updated {timeAgo(presale.updatedAt, now)}</span>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {(error || presale.errors.length > 0) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
          {error && <div>⚠ {error}</div>}
          {presale.errors.length > 0 && (
            <div>
              ⚠ Some GoOut data is missing, numbers may be incomplete:
              <ul className="list-disc ml-5 mt-1">
                {presale.errors.map((e, i) => <li key={i}>{e.error}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatTile label="Tickets sold" value={formatNumber(totals.paidTickets)}>
          {comparison && <div><Delta current={totals.paidTickets} previous={comparison.atSamePoint.tickets} year={compareYear} /></div>}
          {totals.freeTickets > 0 && <div>+ {formatNumber(totals.freeTickets)} free / partner</div>}
        </StatTile>
        <StatTile label="Revenue" value={formatCzk(totals.totalRevenueCents)}>
          {comparison && <div><Delta current={totals.totalRevenueCents} previous={comparison.atSamePoint.revenueCents} year={compareYear} /></div>}
          <div>{formatCzk(totals.passRevenueCents)} from passes</div>
        </StatTile>
        <StatTile label="Festival passes" value={formatNumber(totals.passes)}>
          {comparison && <div><Delta current={totals.passes} previous={comparison.atSamePoint.passes} year={compareYear} /></div>}
          {totals.freePasses > 0 && <div>+ {formatNumber(totals.freePasses)} free</div>}
        </StatTile>
        <StatTile label="Occupancy" value={totals.occupancy !== null ? formatPercent(totals.occupancy) : '—'}>
          <div>of venue capacity, {totals.screenings} screenings</div>
          {totals.soldOut > 0 && <div>{totals.soldOut} sold out</div>}
        </StatTile>
        <StatTile label="Last 24 hours" value={`+${formatNumber(totals.last24h)}`}>
          <div>paid tickets and passes</div>
          <div>+{formatNumber(totals.last7d)} in the last 7 days</div>
        </StatTile>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Sales over time</h2>
              <p className="text-xs text-gray-500">
                {metric === 'tickets' ? 'Paid screening tickets' : 'Revenue incl. passes'}, cumulative, by days before the festival
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 h-0.5" style={{ background: CURRENT_COLOR }} />{edition.year}
                </span>
                {comparison && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-4 h-0.5" style={{ background: PREVIOUS_COLOR }} />{comparison.year}
                  </span>
                )}
              </div>
              <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
                {[['tickets', 'Tickets'], ['revenue', 'Revenue']].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMetric(key)}
                    className={`px-2.5 py-1 ${metric === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SalesChart presale={presale} metric={metric} />
          {comparison && (
            <p className="mt-2 text-xs text-gray-500">
              {comparison.year} final: {formatNumber(comparison.final.tickets)} tickets,{' '}
              {formatNumber(comparison.final.passes)} passes, {formatCzk(comparison.final.revenueCents)}
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">By category</h2>
          <Breakdown title="Screenings" rows={presale.categories.filter(c => !c.isPass)} label={c => c.name} />
          <Breakdown title="Festival passes" rows={presale.categories.filter(c => c.isPass)} label={c => c.name} />
          <Breakdown title="Promo codes" rows={presale.discounts} label={d => d.code} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap justify-between items-center gap-3 px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Screenings</h2>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: CURRENT_COLOR }} />paid
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: FREE_COLOR }} />free / partner
            </span>
          </div>
        </div>
        <ScreeningsTable screenings={presale.screenings} />
      </div>
    </div>
  )
}

export default Presale
