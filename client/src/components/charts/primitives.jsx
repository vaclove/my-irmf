import React, { useState, useEffect } from 'react'
import { formatPercent } from '../../utils/format'

// Data-viz palette (categorical slots 1-4, validated as a set in this order,
// plus a lighter step of the blue ramp and a neutral for "other").
// A series keeps its colour on every chart: GoOut is blue, box office orange,
// festival passes aqua, badges yellow, head counts magenta.
export const SERIES = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  lightBlue: '#86b6ef',
  gray: '#c3c2b7'
}
export const GRID_COLOR = '#e5e7eb'
export const AXIS_TEXT = '#6b7280'

// Change against the previous edition, as an arrow + percentage
export function Delta({ current, previous, year, suffix = 'at this point' }) {
  if (!previous) {
    return <span className="text-gray-500">{year}: none {suffix}</span>
  }
  const change = (current - previous) / previous
  if (Math.round(change * 100) === 0) {
    return <span className="text-gray-500">same as {year} {suffix}</span>
  }
  const up = change > 0
  return (
    <span className={up ? 'text-green-700' : 'text-red-700'}>
      {up ? '▲' : '▼'} {formatPercent(Math.abs(change))}
      <span className="text-gray-500"> vs {year} {suffix}</span>
    </span>
  )
}

export function StatTile({ label, value, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-500 space-y-0.5">{children}</div>
    </div>
  )
}

// Swatches with labels, for charts with two or more series
export function Legend({ items, shape = 'rect' }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
      {items.map(item => (
        <span key={item.label} className="flex items-center gap-1">
          <span
            className={(item.line || shape === 'line') ? 'inline-block w-4 h-0.5' : 'inline-block w-3 h-2 rounded-sm'}
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

// Callback ref + width of the element it is attached to
export function useElementWidth() {
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
export function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

// SVG path of a rectangle with rounded top corners (a column's data end)
export function topRoundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height)
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z'
  ].join('')
}
