// Box-office tickets for the 58 mm thermal printer (Xprinter XP58-IIN), printed
// through the browser's print dialog from a hidden iframe, one ticket per page.
//
// The printer is set up as a normal printer: on Windows with the Xprinter driver,
// on macOS in System Settings → Printers. Chrome started with --kiosk-printing
// prints straight to the default printer without the dialog.
//
// The paper is 58 mm wide with about 48 mm printable. The QR code holds the
// 10-digit ticket code; at 26 mm a module is about 1.2 mm (10 printer dots),
// plenty for phone cameras even on faded thermal paper.
//
// The page is the driver's 58 × 210 mm paper, which must be the printer's
// default paper: browsers print on the default paper and shrink a page that
// doesn't fit it. The driver drops the blank rest of the page, so a ticket uses
// only as much paper as its content. FEED_MM of blank paper after the content
// brings the last line past the tear bar; a single dot at its end keeps the
// driver from dropping that blank paper too.

export const TICKET_WIDTH_MM = 58
export const TICKET_HEIGHT_MM = 210
const FEED_MM = 16

// Official black vertical logo, pure black and white (public/ticket-logo.png)
const LOGO_URL = '/ticket-logo.png'

const escapeHtml = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const formatPrice = (cents) => `${new Intl.NumberFormat('cs-CZ').format(Math.round(cents / 100))} Kč`

const formatDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })

const formatSoldAt = (iso) =>
  new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

// 4123456782 → 4123 4567 82, easier to read out or type
const groupCode = (code) => String(code).replace(/(\d{4})(?=\d)/g, '$1 ')

function ticketHtml(ticket, festival, logoUrl) {
  const { screening } = ticket
  return `
    <section class="ticket">
      <div class="content">
      <img class="logo" src="${escapeHtml(logoUrl)}" alt="IRMF">
      <div class="title">${escapeHtml(screening.title)}</div>
      <div class="when">${escapeHtml(formatDate(screening.date))}</div>
      <div class="time">${escapeHtml(screening.time)}</div>
      <div class="venue">${escapeHtml(screening.venue)}</div>
      <div class="qr">${ticket.qrSvg}</div>
      <div class="code">${escapeHtml(groupCode(ticket.code))}</div>
      ${ticket.holderName ? `<div class="holder">${escapeHtml(ticket.holderName)}</div>` : ''}
      <div class="category">${escapeHtml(ticket.categoryName)} · ${escapeHtml(ticket.priceCents ? formatPrice(ticket.priceCents) : 'zdarma')}</div>
      <div class="footer">
        Vstupenka platí pro jeden vstup · Valid for one admission<br>
        ${escapeHtml(festival)} · Prodáno ${escapeHtml(formatSoldAt(ticket.soldAt))}
      </div>
      <div class="feed"></div>
      </div>
    </section>`
}

// Pure black on white: thermal printers dither greys into noise
const STYLES = `
  @page { size: ${TICKET_WIDTH_MM}mm ${TICKET_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${TICKET_WIDTH_MM}mm; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ticket {
    width: ${TICKET_WIDTH_MM}mm; height: ${TICKET_HEIGHT_MM}mm; padding: 3mm 5mm 0;
    overflow: hidden; text-align: center; page-break-after: always; break-after: page;
  }
  .ticket:last-child { page-break-after: auto; break-after: auto; }
  .logo { display: block; width: 40mm; margin: 0 auto 8mm; }
  .feed { position: relative; height: ${FEED_MM}mm; }
  .feed::after { content: ''; position: absolute; right: 0; bottom: 0; width: 0.3mm; height: 0.3mm; background: #000; }
  .title { font-size: 13pt; font-weight: bold; line-height: 1.3; max-height: 3.9em; overflow: hidden; }
  .when { font-size: 9.5pt; margin-top: 6mm; }
  .time { font-size: 20pt; font-weight: bold; line-height: 1.2; margin-top: 1mm; }
  .venue { font-size: 10pt; font-weight: bold; margin-top: 1.5mm; }
  .qr { margin: 8mm auto 3mm; width: 26mm; height: 26mm; }
  .qr svg { display: block; width: 26mm; height: 26mm; shape-rendering: crispEdges; }
  .code { font-family: 'Courier New', monospace; font-size: 10pt; font-weight: bold; letter-spacing: 0.5pt; }
  .holder { font-size: 10pt; margin-top: 4mm; }
  .category { font-size: 10pt; font-weight: bold; margin-top: 4mm; }
  .holder + .category { margin-top: 1mm; }
  .footer { font-size: 6.5pt; line-height: 1.6; margin-top: 8mm; border-top: 0.3mm solid #000; padding-top: 2mm; }
`

/** Full HTML document of the tickets, one per page. */
export function ticketsDocument(tickets, festival, logoUrl = LOGO_URL) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>IRMF tickets</title>
    <style>${STYLES}</style></head><body>${tickets.map(t => ticketHtml(t, festival, logoUrl)).join('')}</body></html>`
}

let activeFrame = null

/**
 * Print tickets returned by the box-office API.
 * @param {Array} tickets - { code, qrSvg, categoryName, priceCents, soldAt, screening }
 * @param {object} options
 * @param {string} options.festival - header line, e.g. "IRMF 2026"
 */
export function printTickets(tickets, { festival = 'IRMF' } = {}) {
  if (!tickets?.length) return
  // A frame left from the previous print (its dialog has closed by now)
  activeFrame?.remove()

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  activeFrame = iframe

  const doc = iframe.contentDocument
  doc.open()
  // The frame is about:blank, so the logo needs an absolute URL
  doc.write(ticketsDocument(tickets, festival, new URL(LOGO_URL, window.location.origin).href))
  doc.close()

  const frameWindow = iframe.contentWindow
  frameWindow.onafterprint = () => {
    setTimeout(() => {
      if (activeFrame === iframe) activeFrame = null
      iframe.remove()
    }, 500)
  }
  // Print once the logos have loaded (a failed logo must not block the ticket)
  const logosLoaded = Promise.all([...doc.images].map(img => img.decode().catch(() => {})))
  const timeout = new Promise(resolve => setTimeout(resolve, 3000))
  Promise.race([logosLoaded, timeout]).then(() => {
    frameWindow.focus()
    frameWindow.print()
  })
}
