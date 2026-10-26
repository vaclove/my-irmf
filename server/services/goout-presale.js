const goOutAPI = require('./goout-api');
const { pool } = require('../models/database');

/**
 * GoOut presale overview of an edition.
 *
 * Every GoOut sale of an edition is linked to a programming entry through
 * goout_schedule_id (see server/scripts/goout-sync-edition.js); the festival pass
 * is the sale whose schedule has no start time. Ticket numbers come from the
 * purchases of each sale:
 * - a ticket counts when its state is paid/prepaid (cancelled and unpaid ones don't);
 * - revenue is the ticket price after discounts, without the GoOut service fee
 *   (the purchase total includes the fee, so it isn't used);
 * - a ticket's time is its purchase's payment time.
 *
 * GoOut answers one sale in 0.2-1 s, so results are cached: sales of a running
 * presale for 5 minutes, ended sales for 12 hours.
 */

const GOOUT_ORGANIZER_ID = '8736'; // International Road Movie Festival
const LIVE_TTL = 5 * 60 * 1000;
const ENDED_TTL = 12 * 60 * 60 * 1000;
const VALID_TICKET_STATES = new Set(['paid', 'prepaid']);
const DAY_MS = 24 * 60 * 60 * 1000;

const cache = new Map(); // key -> { loadedAt, expiresAt, live, promise }

function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const promise = load();
  cache.set(key, { loadedAt: Date.now(), expiresAt: Date.now() + ttl, live: ttl === LIVE_TTL, promise });
  // A failed load must not stay cached
  promise.catch(() => cache.delete(key));
  return promise;
}

// Relationships are { data: { id } } in entitystore and { id } in reporting responses
const relId = (rel) => {
  const id = rel?.data?.id ?? rel?.id;
  return id == null ? null : String(id);
};

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// All IRMF sales with their deals, as a list per schedule id (a schedule may have several sales)
function loadSalesBySchedule() {
  return cached('sales', LIVE_TTL, async () => {
    const sales = [];
    const deals = {};
    for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
      const response = await goOutAPI.getSales([], 'deals', pageIndex, 50);
      sales.push(...(response.data || []));
      for (const item of response.included || []) {
        if (String(item.type).startsWith('deal')) deals[item.id] = item;
      }
      if (!response.meta?.hasNext) break;
    }

    const bySchedule = {};
    for (const sale of sales) {
      const scheduleId = relId(sale.relationships?.schedule);
      if (relId(sale.relationships?.organizer) !== GOOUT_ORGANIZER_ID || !scheduleId) continue;
      if (sale.attributes?.state === 'cancelled') continue;
      bySchedule[scheduleId] = bySchedule[scheduleId] || [];
      bySchedule[scheduleId].push({
        saleId: String(sale.id),
        state: sale.attributes?.state,
        deals: (sale.relationships?.deals?.data || []).map(d => {
          const deal = deals[d.id];
          return {
            id: String(d.id),
            name: deal?.attributes?.locales?.cs?.name || deal?.attributes?.locales?.en?.name || `Deal ${d.id}`,
            priceCents: deal?.attributes?.priceCents ?? null,
            isHidden: !!deal?.attributes?.isHidden
          };
        })
      });
    }
    return bySchedule;
  });
}

// GoOut schedules (start time, public URL); they rarely change
const scheduleCache = new Map(); // schedule id -> { expiresAt, value }

async function loadSchedules(scheduleIds) {
  const result = {};
  const missing = [];
  for (const id of scheduleIds) {
    const hit = scheduleCache.get(id);
    if (hit && hit.expiresAt > Date.now()) result[id] = hit.value;
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 48) {
    const response = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
      'ids[]': missing.slice(i, i + 48),
      'languages[]': ['cs']
    });
    for (const schedule of response.data || []) {
      const value = {
        hasTime: schedule.attributes?.hasTime !== false,
        url: schedule.attributes?.locales?.cs?.siteUrl || schedule.attributes?.locales?.en?.siteUrl || null
      };
      scheduleCache.set(String(schedule.id), { expiresAt: Date.now() + ENDED_TTL, value });
      result[schedule.id] = value;
    }
  }
  return result;
}

/**
 * Tickets of one sale, from all pages of its purchases.
 * @returns {Promise<{tickets: Array<{valid, priceCents, dealId, discountId, at}>, discounts: Object}>}
 */
function loadSaleTickets(saleId, saleState) {
  const ttl = saleState === 'ended' ? ENDED_TTL : LIVE_TTL;
  return cached(`sale:${saleId}`, ttl, async () => {
    const purchases = {};
    const tickets = [];
    const discounts = {};
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const response = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
        'saleIds[]': [saleId],
        'languages[]': ['cs'],
        include: 'tickets,discounts',
        pageIndex
      });
      for (const purchase of response.purchases || []) purchases[purchase.id] = purchase;
      tickets.push(...(response.included?.tickets || []));
      for (const discount of response.included?.discounts || []) {
        const a = discount.attributes || {};
        discounts[discount.id] = a.locales?.cs?.name || a.locales?.en?.name || a.name || a.code || `Discount ${discount.id}`;
      }
      if (!response.meta?.hasNext) break;
    }

    return {
      discounts,
      tickets: tickets.map(ticket => {
        const purchase = purchases[relId(ticket.relationships?.purchase)];
        return {
          valid: VALID_TICKET_STATES.has(String(ticket.attributes?.state).toLowerCase()),
          priceCents: ticket.attributes?.priceCents || 0,
          dealId: relId(ticket.relationships?.deal),
          discountId: relId(ticket.relationships?.discount) || relId(purchase?.relationships?.discount),
          at: purchase?.attributes?.paidAt || purchase?.attributes?.createdAt || null
        };
      })
    };
  });
}

// Tickets of all sales of a schedule, with their deals and discount codes merged
async function loadScheduleTickets(sales) {
  const results = await Promise.all(sales.map(sale => loadSaleTickets(sale.saleId, sale.state)));
  return {
    tickets: results.flatMap(r => r.tickets),
    discounts: Object.assign({}, ...results.map(r => r.discounts))
  };
}

// 'YYYY-MM-DD' of an instant in Prague
function pragueDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
}

// Whole days from the festival start to a date (negative before the festival)
function dayOffset(date, startDate) {
  const toUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((toUtc(date) - toUtc(startDate)) / DAY_MS);
}

async function loadEdition(editionId) {
  const { rows } = await pool.query(`
    SELECT e.id, e.year, e.start_date::text AS start_date, e.end_date::text AS end_date,
           (SELECT MIN(ps.scheduled_date)::text FROM programming_schedule ps WHERE ps.edition_id = e.id) AS first_day,
           (SELECT MAX(ps.scheduled_date)::text FROM programming_schedule ps WHERE ps.edition_id = e.id) AS last_day
    FROM editions e WHERE e.id = $1
  `, [editionId]);
  const edition = rows[0];
  if (!edition) return null;
  return {
    id: edition.id,
    year: edition.year,
    startDate: edition.start_date || edition.first_day,
    endDate: edition.end_date || edition.last_day
  };
}

async function loadProgramme(editionId) {
  const { rows } = await pool.query(`
    SELECT ps.id, ps.scheduled_date::text AS date, to_char(ps.scheduled_time, 'HH24:MI') AS time,
           ps.hidden_from_public, ps.goout_schedule_id,
           COALESCE(NULLIF(ps.title_override_cs, ''), m.name_cs, mb.name_cs) AS title,
           v.name_cs AS venue, v.capacity,
           COUNT(bs.id) FILTER (WHERE bs.guest_id IS NOT NULL AND bs.goout_status IS NULL)::int AS scans_badges,
           COUNT(bs.id) FILTER (WHERE bs.goout_status IN ('checked_in', 'unverified'))::int AS scans_tickets,
           COUNT(bs.id) FILTER (WHERE bs.goout_status = 'pass')::int AS scans_passes,
           COUNT(bs.id)::int AS scans_total
    FROM programming_schedule ps
    JOIN venues v ON v.id = ps.venue_id
    LEFT JOIN movies m ON m.id = ps.movie_id
    LEFT JOIN movie_blocks mb ON mb.id = ps.block_id
    LEFT JOIN badge_scans bs ON bs.programming_id = ps.id
    WHERE ps.edition_id = $1 AND ps.goout_schedule_id IS NOT NULL
    GROUP BY ps.id, m.name_cs, mb.name_cs, v.name_cs, v.capacity
    ORDER BY ps.scheduled_date, ps.scheduled_time
  `, [editionId]);
  return rows;
}

/**
 * Tickets of an edition: every linked sale with its tickets.
 */
async function loadEditionSales(editionId) {
  const programme = await loadProgramme(editionId);
  const salesBySchedule = await loadSalesBySchedule();
  const schedules = await loadSchedules([...new Set(programme.map(p => p.goout_schedule_id))]);

  const errors = [];
  const entries = await mapLimit(programme, 4, async (entry) => {
    const sales = salesBySchedule[entry.goout_schedule_id];
    if (!sales) {
      errors.push({ programmingId: entry.id, error: `No GoOut sale for schedule ${entry.goout_schedule_id}` });
      return null;
    }
    try {
      const { tickets, discounts } = await loadScheduleTickets(sales);
      return { entry, sales, schedule: schedules[entry.goout_schedule_id], tickets, discounts };
    } catch (error) {
      errors.push({ programmingId: entry.id, error: error.message });
      return null;
    }
  });
  return { entries: entries.filter(Boolean), errors };
}

const isPass = (s) => s.schedule && !s.schedule.hasTime;

// Cumulative tickets/revenue per day relative to the festival start
function buildTimeline(sales, startDate, untilOffset) {
  const perDay = new Map();
  let first = null;
  for (const s of sales) {
    for (const t of s.tickets) {
      if (!t.valid || !t.at) continue;
      const day = dayOffset(pragueDate(t.at), startDate);
      const bucket = perDay.get(day) || { tickets: 0, passes: 0, revenueCents: 0 };
      if (isPass(s)) bucket.passes++;
      else if (t.priceCents > 0) bucket.tickets++;
      bucket.revenueCents += t.priceCents;
      perDay.set(day, bucket);
      if (first === null || day < first) first = day;
    }
  }
  if (first === null) return [];

  const last = Math.max(untilOffset, ...perDay.keys());
  const timeline = [];
  const total = { tickets: 0, passes: 0, revenueCents: 0 };
  for (let day = first; day <= last; day++) {
    const bucket = perDay.get(day);
    if (bucket) {
      total.tickets += bucket.tickets;
      total.passes += bucket.passes;
      total.revenueCents += bucket.revenueCents;
    }
    timeline.push({ day, ...total });
  }
  return timeline;
}

// Count a ticket into a breakdown row, created from `values` on first use
function countInto(map, key, values, priceCents) {
  if (!map.has(key)) map.set(key, { ...values, tickets: 0, revenueCents: 0 });
  const row = map.get(key);
  row.tickets++;
  row.revenueCents += priceCents;
  return row;
}

async function buildPresale(editionId) {
  const edition = await loadEdition(editionId);
  if (!edition) return null;
  if (!edition.startDate) {
    return { edition, empty: true, reason: 'The edition has no dates and no programme', errors: [] };
  }

  const now = Date.now();
  const todayOffset = dayOffset(pragueDate(new Date(now).toISOString()), edition.startDate);
  const festivalLength = dayOffset(edition.endDate || edition.startDate, edition.startDate);
  const { entries, errors } = await loadEditionSales(editionId);

  const totals = {
    paidTickets: 0, freeTickets: 0, revenueCents: 0,
    passes: 0, freePasses: 0, passRevenueCents: 0,
    last24h: 0, last7d: 0
  };
  const categories = new Map();
  const discounts = new Map();
  const screenings = [];
  let pass = null;

  for (const s of entries) {
    const deals = Object.fromEntries(s.sales.flatMap(sale => sale.deals).map(d => [d.id, d]));
    const row = {
      programmingId: s.entry.id,
      saleIds: s.sales.map(sale => sale.saleId),
      // Sold out only when no sale of the screening has tickets left
      saleState: s.sales.find(sale => sale.state !== 'sold_out')?.state || 'sold_out',
      title: s.entry.title,
      date: s.entry.date,
      time: s.entry.time,
      venue: s.entry.venue,
      capacity: s.entry.capacity,
      hidden: s.entry.hidden_from_public,
      gooutUrl: s.schedule?.url || null,
      sold: 0, paid: 0, free: 0, revenueCents: 0, last24h: 0,
      scans: {
        total: s.entry.scans_total,
        tickets: s.entry.scans_tickets,
        passes: s.entry.scans_passes,
        badges: s.entry.scans_badges
      }
    };
    const rowDeals = new Map();
    const rowDiscounts = new Map();

    for (const t of s.tickets) {
      if (!t.valid) continue;
      const age = t.at ? now - new Date(t.at).getTime() : Infinity;
      const free = t.priceCents === 0;
      row.sold++;
      row.revenueCents += t.priceCents;
      if (free) {
        row.free++;
      } else {
        row.paid++;
        // Recent sales count paid tickets only; partner tickets are issued in batches
        if (age <= DAY_MS) { row.last24h++; totals.last24h++; }
        if (age <= 7 * DAY_MS) totals.last7d++;
      }

      const dealName = deals[t.dealId]?.name || 'Unknown category';
      countInto(rowDeals, dealName, { name: dealName }, t.priceCents);
      const category = countInto(categories, `${isPass(s) ? 'pass' : 'ticket'}:${dealName}`, {
        name: dealName,
        isPass: isPass(s),
        free
      }, t.priceCents);
      if (!free) category.free = false;

      if (t.discountId) {
        const code = s.discounts[t.discountId] || `Discount ${t.discountId}`;
        countInto(rowDiscounts, code, { code }, t.priceCents);
        countInto(discounts, code, { code }, t.priceCents);
      }
    }

    row.deals = [...rowDeals.values()].sort((a, b) => b.tickets - a.tickets);
    row.discounts = [...rowDiscounts.values()].sort((a, b) => b.tickets - a.tickets);

    if (isPass(s)) {
      totals.passes += row.paid;
      totals.freePasses += row.free;
      totals.passRevenueCents += row.revenueCents;
      pass = row;
    } else {
      totals.paidTickets += row.paid;
      totals.freeTickets += row.free;
      totals.revenueCents += row.revenueCents;
      row.occupancy = row.capacity ? row.sold / row.capacity : null;
      screenings.push(row);
    }
  }

  const withCapacity = screenings.filter(r => r.capacity);
  const capacity = withCapacity.reduce((sum, r) => sum + r.capacity, 0);
  totals.occupancy = capacity ? withCapacity.reduce((sum, r) => sum + r.sold, 0) / capacity : null;
  totals.soldOut = screenings.filter(r => r.saleState === 'sold_out').length;
  totals.screenings = screenings.length;
  totals.totalRevenueCents = totals.revenueCents + totals.passRevenueCents;

  const festivalOver = todayOffset > festivalLength;
  const timeline = buildTimeline(entries, edition.startDate, festivalOver ? festivalLength : todayOffset);

  return {
    edition,
    today: festivalOver ? null : todayOffset,
    festivalLength,
    totals,
    pass,
    screenings,
    categories: [...categories.values()].sort((a, b) => (a.isPass - b.isPass) || (b.tickets - a.tickets)),
    discounts: [...discounts.values()].sort((a, b) => b.tickets - a.tickets),
    timeline,
    errors
  };
}

// The edition a year earlier, if it sold tickets on GoOut
async function buildComparison(edition, today) {
  const { rows } = await pool.query(`
    SELECT e.id FROM editions e
    WHERE e.year = $1
      AND EXISTS (SELECT 1 FROM programming_schedule ps WHERE ps.edition_id = e.id AND ps.goout_schedule_id IS NOT NULL)
  `, [edition.year - 1]);
  if (!rows[0]) return null;

  const previous = await buildPresale(rows[0].id);
  if (!previous || previous.empty || !previous.timeline.length) return null;

  // Where the previous edition was at the same number of days before its festival
  const atSamePoint = today === null
    ? previous.timeline[previous.timeline.length - 1]
    : [...previous.timeline].reverse().find(p => p.day <= today) || { tickets: 0, passes: 0, revenueCents: 0 };

  return {
    year: previous.edition.year,
    atSamePoint,
    final: previous.timeline[previous.timeline.length - 1],
    timeline: previous.timeline
  };
}

/**
 * Presale overview of an edition, with the previous edition for comparison.
 * @param {boolean} refresh - drop cached GoOut data of running sales first
 */
async function getEditionPresale(editionId, { refresh = false } = {}) {
  if (refresh) {
    // Ended sales don't change, keep them
    for (const [key, entry] of cache) {
      if (entry.live) cache.delete(key);
    }
  }

  const presale = await buildPresale(editionId);
  if (!presale || presale.empty) return presale;

  let comparison = null;
  try {
    comparison = await buildComparison(presale.edition, presale.today);
  } catch (error) {
    presale.errors.push({ error: `Comparison with ${presale.edition.year - 1}: ${error.message}` });
  }
  return { ...presale, comparison, updatedAt: new Date().toISOString() };
}

// Oldest GoOut tickets a box-office sale may rely on when GoOut doesn't answer
const STALE_LIMIT = 15 * 60 * 1000;

// Tickets of a sale, loaded again from GoOut. If GoOut fails, tickets loaded in
// the last STALE_LIMIT are used and marked stale; older ones are not trusted.
async function loadSaleTicketsFresh(sale) {
  const key = `sale:${sale.saleId}`;
  const previous = cache.get(key);
  cache.delete(key);
  try {
    return await loadSaleTickets(sale.saleId, sale.state);
  } catch (error) {
    if (!previous || Date.now() - previous.loadedAt > STALE_LIMIT) throw error;
    cache.set(key, previous);
    return { ...(await previous.promise), stale: true };
  }
}

/**
 * Valid GoOut tickets (paid and free) of screenings, for box-office capacity.
 * @param {string[]} scheduleIds - GoOut schedule ids of the screenings
 * @param {boolean} fresh - reload the tickets from GoOut instead of the 5-minute cache
 * @returns {Promise<Object>} schedule id -> { sold, soldOut, stale } or { error }
 */
async function getSoldBySchedule(scheduleIds, { fresh = false } = {}) {
  const salesBySchedule = await loadSalesBySchedule();
  const result = {};
  await mapLimit(scheduleIds, 4, async (scheduleId) => {
    const sales = salesBySchedule[scheduleId];
    if (!sales) {
      result[scheduleId] = { error: `No GoOut sale for schedule ${scheduleId}` };
      return;
    }
    try {
      const loaded = await Promise.all(sales.map(sale =>
        fresh ? loadSaleTicketsFresh(sale) : loadSaleTickets(sale.saleId, sale.state)
      ));
      result[scheduleId] = {
        sold: loaded.reduce((sum, r) => sum + r.tickets.filter(t => t.valid).length, 0),
        soldOut: sales.every(sale => sale.state === 'sold_out'),
        stale: loaded.some(r => r.stale)
      };
    } catch (error) {
      result[scheduleId] = { error: error.message };
    }
  });
  return result;
}

/**
 * GoOut sales of an edition's festival pass (schedules without a start time).
 * @returns {Promise<Array<{saleId, state, scheduleId, deals}>>}
 */
async function getEditionPassSales(editionId) {
  const { rows } = await pool.query(`
    SELECT DISTINCT goout_schedule_id AS id
    FROM programming_schedule
    WHERE edition_id = $1 AND goout_schedule_id IS NOT NULL
  `, [editionId]);
  const ids = rows.map(r => String(r.id));
  const [schedules, salesBySchedule] = await Promise.all([loadSchedules(ids), loadSalesBySchedule()]);
  return ids
    .filter(id => schedules[id] && !schedules[id].hasTime)
    .flatMap(id => (salesBySchedule[id] || []).map(sale => ({ ...sale, scheduleId: id })));
}

module.exports = { getEditionPresale, getSoldBySchedule, getEditionPassSales, VALID_TICKET_STATES, relId, pragueDate, dayOffset };
