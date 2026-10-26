import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'
import { formatNumber, formatPercent, timeAgo } from '../utils/format'
import { SERIES, StatTile, Legend } from '../components/charts/primitives'

/**
 * Tickets → Badges: how often badge holders came to screenings, by category and
 * person by person. Data: GET /api/dashboard/:edition_id/badges
 * (server/services/badge-attendance.js).
 */

const CATEGORY = {
  filmmaker: { label: 'Filmmakers' },
  press: { label: 'Press' },
  guest: { label: 'Guests' },
  staff: { label: 'Staff' },
  public: { label: 'Sold accreditations' }
}

// Screenings attended, as ordered buckets on a sequential ramp of the blue; none is neutral
const BUCKETS = [
  { key: 'none', label: '0', color: '#e5e7eb', test: v => v === 0 },
  { key: 'one', label: '1', color: '#9ec5f4', test: v => v === 1 },
  { key: 'few', label: '2–3', color: '#5598e7', test: v => v >= 2 && v <= 3 },
  { key: 'some', label: '4–6', color: '#256abf', test: v => v >= 4 && v <= 6 },
  { key: 'many', label: '7+', color: '#0d366b', test: v => v >= 7 }
]

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const formatAverage = (v) => (v === null ? '—' : (Math.round(v * 10) / 10).toLocaleString('cs-CZ'))
const formatScanTime = (iso) => (iso ? new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

function summarize(people, visitsOf) {
  const visits = people.map(visitsOf)
  const active = visits.filter(v => v > 0)
  const total = active.reduce((s, v) => s + v, 0)
  return {
    people: people.length,
    badges: people.filter(p => p.badgeNumber !== null).length,
    active: active.length,
    visits: total,
    average: active.length ? total / active.length : null,
    median: median(active),
    buckets: BUCKETS.map(b => ({ ...b, count: visits.filter(b.test).length }))
  }
}

// Proportional stacked bar of the visit buckets
function BucketBar({ buckets, total }) {
  if (!total) return <div className="h-3 bg-gray-100 rounded" />
  return (
    <div className="flex h-3 rounded overflow-hidden" role="img"
      aria-label={buckets.map(b => `${b.label} screenings: ${b.count}`).join(', ')}>
      {buckets.filter(b => b.count > 0).map(b => (
        <div key={b.key} title={`${b.label} screenings: ${b.count} (${formatPercent(b.count / total)})`}
          style={{ width: `${(b.count / total) * 100}%`, background: b.color }} className="border-r border-white last:border-r-0" />
      ))}
    </div>
  )
}

function SummaryTable({ categories, people, visitsOf, filter, onFilter }) {
  const rows = [
    ...categories.map(c => ({ key: c, label: CATEGORY[c]?.label || c, summary: summarize(people.filter(p => p.category === c), visitsOf) })),
    { key: 'all', label: 'All badge holders', summary: summarize(people, visitsOf), total: true }
  ]
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
            <th className="px-4 py-2 text-left font-medium">Category</th>
            <th className="px-4 py-2 text-right font-medium" title="People with a badge number for this edition">Badges</th>
            <th className="px-4 py-2 text-right font-medium" title="Scanned at least once">Came</th>
            <th className="px-4 py-2 text-right font-medium" title="Screenings attended, all people together">Visits</th>
            <th className="px-4 py-2 text-right font-medium" title="Screenings per person who came at least once">Avg</th>
            <th className="px-4 py-2 text-right font-medium" title="Half of the people who came saw this many or more">Median</th>
            <th className="px-4 py-2 text-left font-medium w-56" title="Share of people by screenings attended">Screenings per person</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, summary, total }) => (
            <tr key={key}
              onClick={() => onFilter(key)}
              className={`border-b border-gray-100 cursor-pointer ${filter === key ? 'bg-blue-50' : 'hover:bg-gray-50'} ${total ? 'font-semibold' : ''}`}>
              <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{label}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{summary.badges || '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                {summary.active || '—'}
                {summary.people > 0 && summary.active > 0 && (
                  <span className="ml-1 text-xs text-gray-500 font-normal">({formatPercent(summary.active / summary.people)})</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{summary.visits || '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatAverage(summary.average)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatAverage(summary.median)}</td>
              <td className="px-4 py-2"><BucketBar buckets={summary.buckets} total={summary.people} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SORTS = {
  visits: { label: 'Screenings', compare: (a, b, v) => v(b) - v(a) || a.name.localeCompare(b.name, 'cs') },
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name, 'cs') },
  badge: { label: 'Badge number', compare: (a, b) => (a.badgeNumber ?? Infinity) - (b.badgeNumber ?? Infinity) },
  last: { label: 'Last visit', compare: (a, b) => (b.lastScan || '').localeCompare(a.lastScan || '') }
}

// CSV for Excel in Czech locale: BOM, semicolons, quoted text
function downloadCsv(people, year) {
  const header = ['Name', 'Company', 'Category', 'Badge', 'Screenings', 'Ticketed screenings', 'Days', 'First visit', 'Last visit']
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = people.map(p => [
    p.name, p.company, CATEGORY[p.category]?.label || p.category, p.badgeNumber, p.visits, p.ticketedVisits, p.days,
    p.firstScan ? new Date(p.firstScan).toLocaleString('cs-CZ') : '', p.lastScan ? new Date(p.lastScan).toLocaleString('cs-CZ') : ''
  ].map(quote).join(';'))
  const blob = new Blob(['﻿' + [header.map(quote).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `badges-${year}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const BadgeAttendance = () => {
  const { selectedEdition } = useEdition()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [onlyTicketed, setOnlyTicketed] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('visits')
  const [now, setNow] = useState(Date.now())

  const requestRef = useRef(0)
  const load = useCallback(async () => {
    if (!selectedEdition) return
    const requestId = ++requestRef.current
    setError('')
    try {
      const response = await axios.get(`/api/dashboard/${selectedEdition.id}/badges`)
      if (!response.data?.people) throw new Error('Unexpected response from the server, try reloading the page in a minute')
      if (requestId === requestRef.current) setData(response.data)
    } catch (err) {
      if (requestId === requestRef.current) setError(err.response?.data?.error || err.message || 'Failed to load badge attendance')
    }
  }, [selectedEdition])

  useEffect(() => {
    setData(null)
    setFilter('all')
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') load()
    }, 60000)
    return () => clearInterval(timer)
  }, [load])

  const visitsOf = useCallback(p => (onlyTicketed ? p.ticketedVisits : p.visits), [onlyTicketed])

  const people = data?.people || []
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return people
      .filter(p => filter === 'all' || p.category === filter)
      .filter(p => !needle || p.name.toLowerCase().includes(needle) || (p.company || '').toLowerCase().includes(needle) || String(p.badgeNumber || '') === needle)
      .sort((a, b) => SORTS[sort].compare(a, b, visitsOf))
  }, [people, filter, search, sort, visitsOf])

  if (!selectedEdition) {
    return <div className="text-center py-12 text-gray-500">Please select an edition to see badge attendance.</div>
  }
  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        {error ? <p className="text-red-600">{error}</p> : <p>Loading badge attendance…</p>}
      </div>
    )
  }

  const total = summarize(people, visitsOf)
  const { edition, screenings } = data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Badges {edition.year}</h1>
          <p className="text-sm text-gray-500">
            Who came to how many screenings · {formatNumber(screenings.total)} screenings in the programme
            {screenings.free_entry > 0 && `, ${formatNumber(screenings.free_entry)} with free entry`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={onlyTicketed} onChange={e => setOnlyTicketed(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Ticketed screenings only
          </label>
          <span className="text-gray-400">Updated {timeAgo(data.updatedAt, now)}</span>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Badge holders" value={formatNumber(total.people)}>
          <div>{formatNumber(total.badges)} with a badge number</div>
        </StatTile>
        <StatTile label="Came at least once" value={total.people ? formatPercent(total.active / total.people) : '—'}>
          <div>{formatNumber(total.active)} of {formatNumber(total.people)} people</div>
        </StatTile>
        <StatTile label="Screening visits" value={formatNumber(total.visits)}>
          <div>{onlyTicketed ? 'ticketed screenings only' : 'free-entry events included'}</div>
        </StatTile>
        <StatTile label="Per visitor" value={formatAverage(total.average)}>
          <div>screenings on average · median {formatAverage(total.median)}</div>
        </StatTile>
      </div>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">By category</h2>
            <p className="text-xs text-gray-500">Click a row to list its people. Category comes from the guest's tags.</p>
          </div>
          <Legend items={BUCKETS.map(b => ({ label: `${b.label} screenings`, color: b.color }))} />
        </div>
        <SummaryTable categories={data.categories} people={people} visitsOf={visitsOf} filter={filter} onFilter={key => setFilter(f => (f === key ? 'all' : key))} />
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-2">
          <h2 className="text-lg font-semibold text-gray-900 mr-auto">
            People
            <span className="ml-2 text-sm font-normal text-gray-500">
              {formatNumber(listed.length)}{filter !== 'all' && ` · ${CATEGORY[filter]?.label || filter}`}
            </span>
          </h2>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, company or badge number"
            className="rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 w-56" />
          <label className="text-sm text-gray-600">
            Sort by{' '}
            <select value={sort} onChange={e => setSort(e.target.value)} className="rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => downloadCsv(listed, edition.year)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
            ⤓ CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Badge</th>
                <th className="px-4 py-2 text-right font-medium">Screenings</th>
                <th className="px-4 py-2 text-right font-medium" title="Festival days with at least one scan">Days</th>
                <th className="px-4 py-2 text-right font-medium">First visit</th>
                <th className="px-4 py-2 text-right font-medium">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Nobody matches</td></tr>
              )}
              {listed.map(p => (
                <tr key={p.guestId} className={`border-b border-gray-100 hover:bg-gray-50 ${visitsOf(p) === 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                  <td className="px-4 py-2">
                    <div className={`font-medium ${visitsOf(p) === 0 ? 'text-gray-500' : 'text-gray-900'}`}>{p.name || '—'}</div>
                    {p.company && <div className="text-xs text-gray-500">{p.company}</div>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">{CATEGORY[p.category]?.label || p.category}</span>
                    {p.convertedPass && p.category !== 'public' && <span className="ml-1 text-xs text-gray-400" title="Has a converted GoOut pass">pass</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.badgeNumber ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{visitsOf(p) || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.days || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatScanTime(p.firstScan)}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatScanTime(p.lastScan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default BadgeAttendance
