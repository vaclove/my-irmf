import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'
import { useToast } from '../contexts/ToastContext'
import Modal from '../components/Modal'
import { badgeApi } from '../utils/api'
import { printBadge } from '../utils/badgePrinter'

// Festival passes bought on GoOut, converted to our badges (category 'public').
// One pass gives one badge; the scanner then rejects the GoOut pass itself.

const numberFormat = new Intl.NumberFormat('cs-CZ')
const formatCzk = (cents) => `${numberFormat.format(Math.round(cents / 100))} Kč`
const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
const errorMessage = (err, fallback) => err.response?.data?.error || err.message || fallback
const isTicketCode = (text) => /^\d{13}$/.test(text)

const normalize = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = (ticket, query) => {
  const q = normalize(query.trim())
  if (!q) return true
  return [`${ticket.firstName} ${ticket.lastName}`, `${ticket.lastName} ${ticket.firstName}`, ticket.email, ticket.ticketId,
    ticket.conversion && `${ticket.conversion.firstName} ${ticket.conversion.lastName}`, ticket.conversion?.badgeNumber]
    .some(value => normalize(value).includes(q))
}

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500'

function ConvertModal({ ticket, editionId, onClose, onConverted }) {
  const [form, setForm] = useState({
    first_name: ticket.firstName,
    last_name: ticket.lastName,
    email: ticket.email,
    phone: ticket.phone,
    language: ticket.language || 'czech'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [emailTaken, setEmailTaken] = useState(null)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const submit = async (extra = {}) => {
    setSaving(true)
    setError('')
    try {
      const body = { ticket_id: ticket.ticketId, ...form, ...extra }
      const response = await axios.post(`/api/goout/accreditations/${editionId}/convert`, body)
      onConverted(response.data)
    } catch (err) {
      const data = err.response?.data
      if (data?.emailTaken) {
        setEmailTaken(data.emailTaken)
      } else {
        setError(errorMessage(err, 'Failed to convert the pass'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={saving ? () => {} : onClose} title="Convert GoOut pass to badge" size="small">
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); setEmailTaken(null); submit() }}
      >
        <div className="text-sm text-gray-600">
          GoOut pass <span className="font-mono">{ticket.ticketId}</span>
          {ticket.dealName && <> · {ticket.dealName}</>}
          {ticket.priceCents != null && <> · {formatCzk(ticket.priceCents)}</>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-gray-700">First name</span>
            <input className={inputClass} value={form.first_name} onChange={set('first_name')} required autoFocus />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Last name</span>
            <input className={inputClass} value={form.last_name} onChange={set('last_name')} required />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Email</span>
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
          <span className="text-xs text-gray-500">The buyer&apos;s email. Leave it empty when the pass belongs to someone else.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-gray-700">Phone</span>
            <input className={inputClass} value={form.phone} onChange={set('phone')} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Language</span>
            <select className={inputClass} value={form.language} onChange={set('language')}>
              <option value="czech">Czech</option>
              <option value="english">English</option>
            </select>
          </label>
        </div>

        {emailTaken && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
            <p className="text-amber-800">
              <strong>{emailTaken.name}</strong> already has this email.
              {emailTaken.hasPass && ' They already hold a converted GoOut pass in this edition.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {!emailTaken.hasPass && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => submit({ guest_id: emailTaken.id })}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Use {emailTaken.name}
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => { setForm(f => ({ ...f, email: '' })); setEmailTaken(null); submit({ email: '' }) }}
                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Create a new guest without email
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Converting…' : 'Create guest & print badge'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function StatusCell({ ticket, onConvert, onPrint, printing }) {
  const c = ticket.conversion
  if (c) {
    return (
      <div className="flex items-center justify-end gap-3">
        <div className="text-right text-xs text-gray-600">
          <div className="font-medium text-green-700">Badge {c.badgeNumber || '—'}</div>
          {(c.firstName !== ticket.firstName || c.lastName !== ticket.lastName) && <div>{c.firstName} {c.lastName}</div>}
          <div>{c.badgePrintedAt ? `printed ${formatDateTime(c.badgePrintedAt)}` : 'not printed'}</div>
        </div>
        <button
          onClick={() => onPrint(ticket)}
          disabled={printing}
          className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {c.badgePrintedAt ? 'Reprint' : 'Print'}
        </button>
      </div>
    )
  }
  if (!ticket.valid) {
    return <span className="text-sm text-red-700">{ticket.state || 'not valid'}</span>
  }
  return (
    <div className="flex justify-end">
      <button onClick={() => onConvert(ticket)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">
        Convert
      </button>
    </div>
  )
}

const Accreditations = () => {
  const { selectedEdition } = useEdition()
  const { success, error: showError } = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [hideConverted, setHideConverted] = useState(false)
  const [converting, setConverting] = useState(null)
  const [printing, setPrinting] = useState(false)
  const searchRef = useRef(null)

  const editionId = selectedEdition?.id

  const load = useCallback(async () => {
    if (!editionId) return null
    setLoading(true)
    try {
      const response = await axios.get(`/api/goout/accreditations/${editionId}`)
      if (!Array.isArray(response.data?.tickets)) {
        throw new Error('Unexpected response from the server, try reloading the page in a minute')
      }
      setData(response.data)
      setError('')
      return response.data
    } catch (err) {
      setError(errorMessage(err, 'Failed to load GoOut passes'))
      return null
    } finally {
      setLoading(false)
    }
  }, [editionId])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  const print = async (guestId, printedAt) => {
    if (printedAt && !confirm(`This badge was already printed on ${formatDateTime(printedAt)}. Print it again?`)) return
    setPrinting(true)
    try {
      const response = await badgeApi.getPrintData(guestId, editionId)
      const { layout, guest } = response.data
      await printBadge(layout, guest, selectedEdition.year)
      success('Badge PDF generated')
    } catch (err) {
      showError(`Badge not printed: ${errorMessage(err, 'unknown error')}`)
    } finally {
      setPrinting(false)
      load()
    }
  }

  const handleConverted = async (result) => {
    setConverting(null)
    setQuery('')
    success(`Guest created with badge ${result.badgeNumber}`)
    await print(result.guestId, null)
    searchRef.current?.focus()
  }

  // Enter in the search box: a scanned GoOut code opens its pass right away
  const handleSearchKey = async (e) => {
    if (e.key !== 'Enter') return
    const code = query.trim()
    if (!isTicketCode(code)) return
    e.preventDefault()
    const fresh = (await load()) || data
    const ticket = fresh?.tickets.find(t => t.ticketId === code)
    if (!ticket) {
      showError(`${code} is not an IRMF ${selectedEdition.year} festival pass on GoOut`)
    } else if (ticket.conversion) {
      showError(`Pass ${code} was already converted to badge ${ticket.conversion.badgeNumber || ''} (${ticket.conversion.firstName} ${ticket.conversion.lastName})`)
    } else if (!ticket.valid) {
      showError(`Pass ${code} is ${ticket.state || 'not valid'} on GoOut`)
    } else {
      setConverting(ticket)
    }
  }

  if (!selectedEdition) {
    return <div className="text-center py-12 text-gray-500">Please select an edition to convert accreditations.</div>
  }

  const tickets = data?.tickets || []
  const passes = tickets.filter(t => t.valid)
  const converted = tickets.filter(t => t.conversion)
  const visible = tickets.filter(t => matches(t, query) && !(hideConverted && t.conversion))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1 min-w-[16rem] max-w-xl">
          <input
            ref={searchRef}
            className={inputClass}
            placeholder="Scan the GoOut pass QR code, or search by name, email or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            autoFocus
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={hideConverted} onChange={e => setHideConverted(e.target.checked)} />
            Hide converted
          </label>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-50">
            ↻ Refresh
          </button>
        </div>
      </div>

      {data && (
        <p className="text-sm text-gray-600">
          <span className="font-semibold tabular-nums">{passes.length}</span> valid passes on GoOut ·{' '}
          <span className="font-semibold tabular-nums">{converted.length}</span> converted to badges
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data?.gooutError && <p className="text-sm text-amber-700">{data.gooutError}. Converted passes are shown, new ones can&apos;t be converted now.</p>}
      {data && !data.hasPassSale && !data.gooutError && (
        <p className="text-sm text-amber-700">No GoOut festival pass is linked to this edition (run goout-sync-edition).</p>
      )}
      {!data && !error && <p className="text-gray-500">Loading GoOut passes…</p>}

      {data && visible.length === 0 && tickets.length > 0 && <p className="text-gray-500 text-sm">No pass matches.</p>}

      {visible.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2">Name on pass</th>
                <th className="px-4 py-2">Buyer email</th>
                <th className="px-4 py-2">Pass</th>
                <th className="px-4 py-2">Bought</th>
                <th className="px-4 py-2 text-right">Badge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(ticket => (
                <tr key={ticket.ticketId} className={ticket.valid === false && !ticket.conversion ? 'opacity-60' : ''}>
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                    {ticket.firstName} {ticket.lastName}
                    {ticket.conversion && ticket.valid === false && (
                      <div className="text-xs font-normal text-red-700">Pass is {ticket.state} on GoOut</div>
                    )}
                    {ticket.notOnGoOut && <div className="text-xs font-normal text-amber-700">Not found on GoOut any more</div>}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{ticket.email}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    <div className="font-mono text-xs">{ticket.ticketId}</div>
                    {ticket.dealName && <div className="text-xs">{ticket.dealName}</div>}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600 tabular-nums">{ticket.paidAt ? formatDateTime(ticket.paidAt) : ''}</td>
                  <td className="px-4 py-2">
                    <StatusCell
                      ticket={ticket}
                      printing={printing}
                      onConvert={setConverting}
                      onPrint={(t) => print(t.conversion.guestId, t.conversion.badgePrintedAt)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {converting && (
        <ConvertModal
          ticket={converting}
          editionId={editionId}
          onClose={() => { setConverting(null); load() }}
          onConverted={handleConverted}
        />
      )}
    </div>
  )
}

export default Accreditations
