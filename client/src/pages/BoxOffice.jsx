import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'
import { useToast } from '../contexts/ToastContext'
import Modal from '../components/Modal'
import { printTickets } from '../utils/ticketPrinter'

// Capacity bar colours: GoOut is the presale blue, box office the comparison orange
const GOOUT_COLOR = '#2a78d6'
const BOX_OFFICE_COLOR = '#eb6834'

const numberFormat = new Intl.NumberFormat('cs-CZ')
const formatCzk = (cents) => `${numberFormat.format(Math.round(cents / 100))} Kč`
const formatDay = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' })
const errorMessage = (err, fallback) => err.response?.data?.error || err.message || fallback

const PAYMENT_LABELS = { cash: '💵 Cash', card: '💳 Card', free: '🎁 Free' }
// One button per payment method, so every sale asks how it was paid (no default)
const PAYMENT_BUTTONS = [
  { method: 'cash', className: 'bg-green-600 hover:bg-green-700' },
  { method: 'card', className: 'bg-blue-600 hover:bg-blue-700' }
]

function CapacityBar({ screening }) {
  const { capacity, gooutSold, boxOfficeSold } = screening
  if (!capacity) return <div className="h-2 rounded bg-gray-100" />
  const pct = (n) => `${Math.min(((n || 0) / capacity) * 100, 100)}%`
  return (
    <div className="h-2 rounded bg-gray-100 flex overflow-hidden">
      <div style={{ width: pct(gooutSold), background: GOOUT_COLOR }} />
      <div style={{ width: pct(boxOfficeSold), background: BOX_OFFICE_COLOR }} />
    </div>
  )
}

function Availability({ screening, large = false }) {
  if (screening.capacity == null) {
    return <span className="text-amber-700">No capacity set</span>
  }
  if (screening.available == null) {
    return <span className="text-amber-700">GoOut count unavailable</span>
  }
  const color = screening.available === 0 ? 'text-red-700' : screening.available <= 10 ? 'text-amber-700' : 'text-green-700'
  return (
    <span className={`${color} font-semibold tabular-nums ${large ? 'text-2xl' : ''}`}>
      {screening.available === 0 ? 'Sold out' : `${screening.available} left`}
    </span>
  )
}

function ScreeningList({ screenings, selectedId, onSelect }) {
  const days = []
  for (const s of screenings) {
    if (days[days.length - 1]?.date !== s.date) days.push({ date: s.date, screenings: [] })
    days[days.length - 1].screenings.push(s)
  }
  return (
    <div className="space-y-4">
      {days.map(day => (
        <div key={day.date}>
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{formatDay(day.date)}</h3>
          <ul className="space-y-2">
            {day.screenings.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={`w-full text-left bg-white rounded-lg border p-3 hover:border-blue-400 ${
                    selectedId === s.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
                  } ${s.ended ? 'opacity-60' : ''}`}
                >
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        <span className="tabular-nums">{s.time}</span> · {s.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        {s.venue}
                        {s.customPrices && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">own prices</span>}
                      </div>
                    </div>
                    <div className="text-sm whitespace-nowrap"><Availability screening={s} /></div>
                  </div>
                  <div className="mt-2"><CapacityBar screening={s} /></div>
                  <div className="mt-1 text-xs text-gray-500 tabular-nums">
                    GoOut {s.gooutSold ?? '?'} · Box office {s.boxOfficeSold} · Capacity {s.capacity ?? '—'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function CapacityEditor({ screening, onSaved }) {
  const { error: showError } = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await axios.put(`/api/box-office/screenings/${screening.id}/capacity`, { ticket_capacity: value })
      onSaved(response.data.screening)
      setEditing(false)
    } catch (err) {
      showError(errorMessage(err, 'Failed to save capacity'))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <span>
        Capacity <span className="font-medium text-gray-900 tabular-nums">{screening.capacity ?? '—'}</span>
        {screening.ticketCapacity != null && <span> (venue {screening.venueCapacity ?? '—'})</span>}
        <button
          onClick={() => { setValue(screening.ticketCapacity ?? ''); setEditing(true) }}
          className="ml-2 text-blue-600 hover:text-blue-800"
        >
          Edit
        </button>
      </span>
    )
  }
  return (
    <form onSubmit={save} className="inline-flex items-center gap-2">
      <input
        type="number" min="0" value={value} autoFocus
        onChange={e => setValue(e.target.value)}
        placeholder={`Venue: ${screening.venueCapacity ?? '—'}`}
        className="w-32 border border-gray-300 rounded px-2 py-1 text-sm"
      />
      <button type="submit" disabled={saving} className="text-blue-600 hover:text-blue-800 disabled:opacity-50">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-700">Cancel</button>
      <span className="text-xs text-gray-500">Empty = venue capacity</span>
    </form>
  )
}

function SellPanel({ detail, editionId, festival, onChanged }) {
  const { success, error: showError } = useToast()
  const [editingPrices, setEditingPrices] = useState(false)
  const [issuingFree, setIssuingFree] = useState(false)
  const [quantities, setQuantities] = useState({})
  const [selling, setSelling] = useState(null) // payment method of the sale in progress
  const [lastSale, setLastSale] = useState(null)
  const { screening, tickets, categories } = detail

  useEffect(() => {
    setQuantities({})
    setLastSale(null)
  }, [screening.id])

  const activeCategories = categories.filter(c => c.active)
  const count = activeCategories.reduce((sum, c) => sum + (quantities[c.id] || 0), 0)
  const total = activeCategories.reduce((sum, c) => sum + (quantities[c.id] || 0) * c.price_cents, 0)
  const canSell = !screening.ended && screening.available != null && count > 0 && count <= screening.available

  const change = (categoryId, delta) => {
    setQuantities(q => ({ ...q, [categoryId]: Math.max((q[categoryId] || 0) + delta, 0) }))
  }

  const sell = async (paymentMethod) => {
    setSelling(paymentMethod)
    try {
      const response = await axios.post('/api/box-office/sales', {
        programming_id: screening.id,
        payment_method: paymentMethod,
        items: activeCategories.filter(c => quantities[c.id] > 0).map(c => ({ category_id: c.id, quantity: quantities[c.id] }))
      })
      const sale = response.data
      printTickets(sale.tickets, { festival })
      setLastSale(sale)
      setQuantities({})
      success(`Sold ${sale.tickets.length} ${sale.tickets.length === 1 ? 'ticket' : 'tickets'} · ${formatCzk(sale.totalCents)} · ${PAYMENT_LABELS[paymentMethod]}`)
      onChanged()
    } catch (err) {
      showError(errorMessage(err, 'Sale failed'))
      onChanged()
    } finally {
      setSelling(null)
    }
  }

  const reprint = async (ticket) => {
    try {
      const response = await axios.post(`/api/box-office/tickets/${ticket.id}/reprint`)
      printTickets([response.data.ticket], { festival })
      onChanged()
    } catch (err) {
      showError(errorMessage(err, 'Reprint failed'))
    }
  }

  // Own price list for this screening, starting as a copy of the defaults
  const customizePrices = async () => {
    try {
      await axios.post(`/api/box-office/screenings/${screening.id}/prices`)
      onChanged()
      setEditingPrices(true)
    } catch (err) {
      showError(errorMessage(err, 'Failed to create the price list'))
    }
  }

  const switchToDefaultPrices = async () => {
    if (!window.confirm('Sell this screening at the default prices again? Its own price list is removed.')) return
    try {
      await axios.delete(`/api/box-office/screenings/${screening.id}/prices`)
      setQuantities({})
      onChanged()
    } catch (err) {
      showError(errorMessage(err, 'Failed to switch to default prices'))
    }
  }

  const cancel = async (ticket) => {
    if (!window.confirm(`Cancel ticket ${ticket.code} (${ticket.category_name}, ${formatCzk(ticket.price_cents)})? Refund the customer separately.`)) return
    try {
      await axios.post(`/api/box-office/tickets/${ticket.id}/cancel`)
      success(`Ticket ${ticket.code} cancelled`)
      onChanged()
    } catch (err) {
      showError(errorMessage(err, 'Cancel failed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{screening.title}</h2>
            <div className="text-sm text-gray-500">{formatDay(screening.date)} · {screening.time} · {screening.venue}</div>
          </div>
          <div className="text-right whitespace-nowrap"><Availability screening={screening} large /></div>
        </div>
        <div className="mt-3"><CapacityBar screening={screening} /></div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: GOOUT_COLOR }} />GoOut <span className="font-medium text-gray-900 tabular-nums">{screening.gooutSold ?? '?'}</span></span>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: BOX_OFFICE_COLOR }} />Box office <span className="font-medium text-gray-900 tabular-nums">{screening.boxOfficeSold}</span> ({formatCzk(screening.boxOfficeRevenueCents)})</span>
          <CapacityEditor screening={screening} onSaved={onChanged} />
        </div>
        {!screening.gooutLinked && (
          <p className="mt-2 text-xs text-amber-700">Not linked to GoOut: only box-office tickets count into the capacity.</p>
        )}
        {screening.gooutStale && (
          <p className="mt-2 text-xs text-amber-700">GoOut didn't answer; the GoOut count is from the last load (at most 15 minutes old).</p>
        )}
        {screening.gooutError && (
          <p className="mt-2 text-xs text-red-700">GoOut: {screening.gooutError}</p>
        )}
        {screening.gooutSoldOut && (
          <p className="mt-2 text-xs text-gray-600">Sold out on GoOut.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm mb-2 pb-2 border-b border-gray-100">
          {screening.customPrices ? (
            <>
              <span className="text-amber-800">Own prices for this screening</span>
              <span className="flex gap-3">
                <button onClick={() => setEditingPrices(true)} className="text-blue-600 hover:text-blue-800">Edit prices</button>
                <button onClick={switchToDefaultPrices} className="text-gray-600 hover:text-gray-800">Use default prices</button>
              </span>
            </>
          ) : (
            <>
              <span className="text-gray-500">Default prices</span>
              <button onClick={customizePrices} className="text-blue-600 hover:text-blue-800">Own prices for this screening</button>
            </>
          )}
        </div>
        {screening.ended ? (
          <p className="text-sm text-gray-500">This screening has ended.</p>
        ) : activeCategories.length === 0 ? (
          <p className="text-sm text-gray-500">No ticket categories yet: add them under Default prices above.</p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {activeCategories.map(c => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-sm text-gray-500">{formatCzk(c.price_cents)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => change(c.id, -1)} disabled={!quantities[c.id]}
                      className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none disabled:opacity-30">−</button>
                    <span className="w-6 text-center text-lg font-semibold tabular-nums">{quantities[c.id] || 0}</span>
                    <button onClick={() => change(c.id, 1)}
                      className="w-10 h-10 rounded-full border border-gray-300 text-xl leading-none">+</button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-baseline justify-between gap-3">
              <div className="text-sm text-gray-500">
                {count ? `${count} ${count === 1 ? 'ticket' : 'tickets'}` : 'Choose tickets'}
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-2xl font-semibold text-gray-900 tabular-nums">{formatCzk(total)}</div>
              </div>
            </div>

            {screening.available != null && count > screening.available && (
              <p className="mt-2 text-sm text-red-700">Only {screening.available} left.</p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {PAYMENT_BUTTONS.map(({ method, className }) => (
                <button key={method} onClick={() => sell(method)} disabled={!canSell || !!selling}
                  className={`py-3 px-2 rounded-md text-white disabled:opacity-40 ${className}`}>
                  <div className="text-lg font-semibold">{PAYMENT_LABELS[method]}</div>
                  <div className="text-xs opacity-90">
                    {selling === method ? 'Selling…' : `Sell & print · ${formatCzk(total)}`}
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setIssuingFree(true)} disabled={screening.available == null || screening.available === 0}
              className="mt-3 w-full py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              🎁 Free ticket…
            </button>
            {lastSale && (
              <div className="mt-2 text-sm text-gray-600 flex justify-between">
                <span>Last sale: {lastSale.tickets.length} × · {formatCzk(lastSale.totalCents)} · {PAYMENT_LABELS[lastSale.tickets[0].paymentMethod]}</span>
                <button onClick={() => printTickets(lastSale.tickets, { festival })} className="text-blue-600 hover:text-blue-800">Print again</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Box-office tickets ({tickets.length})</h3>
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-500">None sold yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Code</th>
                  <th className="py-1 pr-3 font-medium">Category</th>
                  <th className="py-1 pr-3 font-medium text-right">Price</th>
                  <th className="py-1 pr-3 font-medium">Paid</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map(t => (
                  <tr key={t.id} className={t.cancelled_at ? 'text-gray-400 line-through' : 'text-gray-800'} title={`Sold by ${t.sold_by || '—'}, printed ${t.printed_count}×`}>
                    <td className="py-1.5 pr-3 tabular-nums">{formatTime(t.sold_at)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.code}</td>
                    <td className="py-1.5 pr-3">
                      {t.category_name}
                      {(t.holder_name || t.note) && (
                        <div className="text-xs text-gray-500">{[t.holder_name, t.note].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCzk(t.price_cents)}</td>
                    <td className="py-1.5 pr-3">{t.payment_method}</td>
                    <td className="py-1.5 pr-3">
                      {t.cancelled_at ? 'Cancelled' : t.scanned ? <span className="text-green-700">Scanned</span> : 'Valid'}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {!t.cancelled_at && (
                        <>
                          <button onClick={() => reprint(t)} className="text-blue-600 hover:text-blue-800">Reprint</button>
                          {!t.scanned && (
                            <button onClick={() => cancel(t)} className="ml-3 text-red-600 hover:text-red-800">Cancel</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {issuingFree && (
        <FreeTicketModal screening={screening} festival={festival}
          onClose={() => setIssuingFree(false)}
          onIssued={(sale) => { setIssuingFree(false); setLastSale(sale); onChanged() }} />
      )}
      {editingPrices && (
        <CategoriesModal editionId={editionId} screening={screening}
          onClose={() => setEditingPrices(false)} onChanged={onChanged} />
      )}
    </div>
  )
}

/**
 * Free tickets, printed now. Optionally issued to an existing guest: the scan
 * at the door is then recorded for them, so their history shows what they saw.
 */
function FreeTicketModal({ screening, festival, onClose, onIssued }) {
  const { success, error: showError } = useToast()
  const [quantity, setQuantity] = useState(1)
  const [query, setQuery] = useState('')
  const [guests, setGuests] = useState([])
  const [guest, setGuest] = useState(null)
  const [note, setNote] = useState('')
  const [issuing, setIssuing] = useState(false)

  // Search guests as the name is typed (latest answer wins)
  const searchRequest = useRef(0)
  useEffect(() => {
    if (guest || query.trim().length < 2) { setGuests([]); return }
    const requestId = ++searchRequest.current
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get('/api/box-office/guests', { params: { q: query } })
        if (requestId === searchRequest.current) setGuests(response.data.guests)
      } catch (err) {
        if (requestId === searchRequest.current) showError(errorMessage(err, 'Guest search failed'))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, guest, showError])

  const issue = async (e) => {
    e.preventDefault()
    setIssuing(true)
    try {
      const response = await axios.post('/api/box-office/free-tickets', {
        programming_id: screening.id, quantity, guest_id: guest?.id, note
      })
      printTickets(response.data.tickets, { festival })
      success(`${quantity} free ${quantity === 1 ? 'ticket' : 'tickets'}${guest ? ` for ${guest.first_name} ${guest.last_name}` : ''}`)
      onIssued(response.data)
    } catch (err) {
      showError(errorMessage(err, 'Failed to issue free tickets'))
    } finally {
      setIssuing(false)
    }
  }

  const max = Math.min(screening.available ?? 0, 20)
  return (
    <Modal isOpen onClose={onClose} title={`Free ticket: ${screening.title} (${screening.time})`} size="small">
      <form onSubmit={issue} className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">Tickets</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setQuantity(q => Math.max(q - 1, 1))} disabled={quantity <= 1}
              className="w-9 h-9 rounded-full border border-gray-300 text-lg leading-none disabled:opacity-30">−</button>
            <span className="w-6 text-center font-semibold tabular-nums">{quantity}</span>
            <button type="button" onClick={() => setQuantity(q => Math.min(q + 1, max))} disabled={quantity >= max}
              className="w-9 h-9 rounded-full border border-gray-300 text-lg leading-none disabled:opacity-30">+</button>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Guest <span className="text-gray-400">(optional)</span></label>
          {guest ? (
            <div className="flex items-center justify-between border border-gray-300 rounded px-2 py-1.5 text-sm">
              <span>{guest.first_name} {guest.last_name}{guest.email && <span className="text-gray-500"> · {guest.email}</span>}</span>
              <button type="button" onClick={() => { setGuest(null); setQuery('') }} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
          ) : (
            <div className="relative">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              {guests.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg text-sm">
                  {guests.map(g => (
                    <li key={g.id}>
                      <button type="button" onClick={() => setGuest(g)} className="w-full text-left px-2 py-1.5 hover:bg-gray-50">
                        {g.first_name} {g.last_name}{g.email && <span className="text-gray-500"> · {g.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">The guest's name is printed on the ticket and the scan shows in their history.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Note <span className="text-gray-400">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="e.g. partner, jury, volunteer"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>

        <button type="submit" disabled={issuing || max < 1}
          className="w-full py-2.5 rounded-md bg-gray-800 text-white font-semibold hover:bg-gray-900 disabled:opacity-40">
          {issuing ? 'Issuing…' : `🎁 Print ${quantity} free ${quantity === 1 ? 'ticket' : 'tickets'}`}
        </button>
      </form>
    </Modal>
  )
}

/**
 * Price list: the edition's defaults, or a screening's own list (screening given).
 */
function CategoriesModal({ editionId, screening = null, onClose, onChanged }) {
  const { error: showError } = useToast()
  const [categories, setCategories] = useState([])
  const [drafts, setDrafts] = useState({})
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')

  const draft = (c) => drafts[c.id] || { name: c.name, price: String(c.price_cents / 100) }
  const setDraft = (c, field, value) => setDrafts(d => ({ ...d, [c.id]: { ...draft(c), [field]: value } }))
  const toCents = (price) => Math.round(Number(String(price).replace(',', '.')) * 100)

  // The screening object is replaced on every panel refresh; only its id matters here
  const screeningId = screening?.id
  const load = useCallback(async () => {
    try {
      const params = screeningId ? { programming_id: screeningId } : { edition_id: editionId }
      const response = await axios.get('/api/box-office/categories', { params })
      setCategories(response.data.categories)
    } catch (err) {
      showError(errorMessage(err, 'Failed to load prices'))
    }
  }, [editionId, screeningId, showError])

  useEffect(() => { load() }, [load])

  const run = async (request, fallback) => {
    try {
      await request()
      await load()
      onChanged()
      return true
    } catch (err) {
      showError(errorMessage(err, fallback))
      return false
    }
  }

  const add = async (e) => {
    e.preventDefault()
    const ok = await run(() => axios.post('/api/box-office/categories', {
      edition_id: editionId, programming_id: screening?.id, name: newName, price_cents: toCents(newPrice)
    }), 'Failed to add category')
    if (ok) { setNewName(''); setNewPrice('') }
  }

  const save = (c, extra = {}) => {
    const d = draft(c)
    return run(() => axios.put(`/api/box-office/categories/${c.id}`, { name: d.name, price_cents: toCents(d.price), ...extra }), 'Failed to save category')
      .then(ok => ok && setDrafts(ds => { const { [c.id]: _, ...rest } = ds; return rest }))
  }

  const remove = (c) => {
    if (!window.confirm(c.has_tickets ? `Deactivate "${c.name}"? Its sold tickets stay.` : `Delete "${c.name}"?`)) return
    run(() => axios.delete(`/api/box-office/categories/${c.id}`), 'Failed to delete category')
  }

  return (
    <Modal isOpen onClose={onClose} size="medium"
      title={screening ? `Prices: ${screening.title} (${screening.time})` : 'Default prices'}>
      <p className="text-sm text-gray-500 mb-3">
        {screening
          ? 'This screening sells only these categories instead of the default prices.'
          : 'Every screening sells these categories unless it has its own prices.'}
        {' '}Changing a price doesn't change tickets already sold.
      </p>
      <ul className="divide-y divide-gray-100">
        {categories.map(c => {
          const d = draft(c)
          const dirty = !!drafts[c.id]
          return (
            <li key={c.id} className={`flex items-center gap-2 py-2 ${c.active ? '' : 'opacity-50'}`}>
              <input value={d.name} onChange={e => setDraft(c, 'name', e.target.value)}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
              <input value={d.price} onChange={e => setDraft(c, 'price', e.target.value)} inputMode="decimal"
                className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right" />
              <span className="text-sm text-gray-500">Kč</span>
              {dirty && <button onClick={() => save(c)} className="text-sm text-blue-600 hover:text-blue-800">Save</button>}
              {c.active
                ? <button onClick={() => remove(c)} className="text-sm text-red-600 hover:text-red-800">{c.has_tickets ? 'Deactivate' : 'Delete'}</button>
                : <button onClick={() => save(c, { active: true })} className="text-sm text-blue-600 hover:text-blue-800">Activate</button>}
            </li>
          )
        })}
      </ul>
      <form onSubmit={add} className="mt-4 flex items-center gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category, e.g. Základní"
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
        <input value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Price" inputMode="decimal"
          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right" />
        <span className="text-sm text-gray-500">Kč</span>
        <button type="submit" disabled={!newName.trim() || newPrice === ''}
          className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-40">Add</button>
      </form>
    </Modal>
  )
}

function SummaryModal({ editionId, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    axios.get('/api/box-office/summary', { params: { edition_id: editionId } })
      .then(response => setRows(response.data.rows))
      .catch(err => setError(errorMessage(err, 'Failed to load summary')))
  }, [editionId])

  const days = []
  for (const row of rows || []) {
    let day = days.find(d => d.day === row.day)
    if (!day) {
      day = { day: row.day, cash: 0, card: 0, free: 0, tickets: 0, categories: new Map() }
      days.push(day)
    }
    if (row.payment_method === 'free') day.free += row.tickets
    else day[row.payment_method] += row.revenue_cents
    day.tickets += row.tickets
    const category = day.categories.get(row.category_name) || { tickets: 0, revenueCents: 0 }
    category.tickets += row.tickets
    category.revenueCents += row.revenue_cents
    day.categories.set(row.category_name, category)
  }
  const sum = (key) => days.reduce((s, d) => s + d[key], 0)

  return (
    <Modal isOpen onClose={onClose} title="Box-office cash-up" size="medium">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!rows && !error && <p className="text-gray-500 text-sm">Loading…</p>}
      {rows && days.length === 0 && <p className="text-gray-500 text-sm">No tickets sold yet.</p>}
      {days.length > 0 && (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-3 font-medium">Day (sold)</th>
              <th className="py-1 pr-3 font-medium text-right">Tickets</th>
              <th className="py-1 pr-3 font-medium text-right">Cash</th>
              <th className="py-1 pr-3 font-medium text-right">Card</th>
              <th className="py-1 pr-3 font-medium text-right">Free</th>
              <th className="py-1 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {days.map(d => (
              <tr key={d.day} className="align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900">{formatDay(d.day)}</div>
                  {[...d.categories].map(([name, c]) => (
                    <div key={name} className="text-xs text-gray-500">{name}: {c.tickets} × · {formatCzk(c.revenueCents)}</div>
                  ))}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.tickets}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCzk(d.cash)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCzk(d.card)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.free}</td>
                <td className="py-2 text-right tabular-nums font-medium">{formatCzk(d.cash + d.card)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right tabular-nums">{sum('tickets')}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCzk(sum('cash'))}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCzk(sum('card'))}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{sum('free')}</td>
              <td className="py-2 text-right tabular-nums">{formatCzk(sum('cash') + sum('card'))}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </Modal>
  )
}

const BoxOffice = () => {
  const { selectedEdition } = useEdition()
  const [screenings, setScreenings] = useState(null)
  const [error, setError] = useState('')
  const [showEnded, setShowEnded] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')
  const [modal, setModal] = useState(null) // 'prices' | 'summary'

  const editionId = selectedEdition?.id
  const festival = selectedEdition ? `IRMF ${selectedEdition.year}` : 'IRMF'

  const loadList = useCallback(async () => {
    if (!editionId) return
    try {
      const list = await axios.get('/api/box-office/screenings', { params: { edition_id: editionId } })
      if (!Array.isArray(list.data?.screenings)) {
        throw new Error('Unexpected response from the server, try reloading the page in a minute')
      }
      setScreenings(list.data.screenings)
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Failed to load screenings'))
    }
  }, [editionId])

  // Only the latest request may update the panel (the user may click through screenings)
  const detailRequest = useRef(0)
  const loadDetail = useCallback(async (id) => {
    const requestId = ++detailRequest.current
    try {
      const response = await axios.get(`/api/box-office/screenings/${id}`)
      if (requestId !== detailRequest.current) return
      setDetail(response.data)
      setDetailError('')
      // Keep the list in step with the fresh GoOut count
      setScreenings(list => list?.map(s => (s.id === id ? response.data.screening : s)))
    } catch (err) {
      if (requestId === detailRequest.current) setDetailError(errorMessage(err, 'Failed to load screening'))
    }
  }, [])

  useEffect(() => {
    setScreenings(null)
    setSelectedId(null)
    setDetail(null)
    loadList()
  }, [loadList])

  useEffect(() => {
    if (!selectedId) return
    setDetail(d => (d?.screening.id === selectedId ? d : null))
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const refresh = useCallback(() => {
    loadList()
    if (selectedId) loadDetail(selectedId)
  }, [loadList, loadDetail, selectedId])

  if (!selectedEdition) {
    return <div className="text-center py-12 text-gray-500">Please select an edition to sell tickets.</div>
  }

  const visible = (screenings || []).filter(s => showEnded || !s.ended)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} />
          Show ended screenings
        </label>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50">↻ Refresh</button>
          <button onClick={() => setModal('prices')} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50">Default prices</button>
          <button onClick={() => setModal('summary')} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50">Cash-up</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!screenings && !error && <p className="text-gray-500">Loading screenings…</p>}
      {screenings && visible.length === 0 && (
        <p className="text-gray-500">No {showEnded ? '' : 'upcoming '}screenings with tickets in this edition.</p>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-2">
            <ScreeningList screenings={visible} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="lg:col-span-3 lg:sticky lg:top-4">
            {!selectedId && <p className="text-gray-500 text-sm">Choose a screening to sell tickets.</p>}
            {selectedId && detailError && <p className="text-sm text-red-600">{detailError}</p>}
            {selectedId && !detail && !detailError && <p className="text-gray-500 text-sm">Loading current GoOut sales…</p>}
            {detail && (
              <SellPanel detail={detail} editionId={editionId} festival={festival} onChanged={refresh} />
            )}
          </div>
        </div>
      )}

      {modal === 'prices' && (
        <CategoriesModal editionId={editionId} onClose={() => setModal(null)} onChanged={refresh} />
      )}
      {modal === 'summary' && <SummaryModal editionId={editionId} onClose={() => setModal(null)} />}
    </div>
  )
}

export default BoxOffice
