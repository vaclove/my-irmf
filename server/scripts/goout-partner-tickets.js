require('dotenv').config();
const { pool } = require('../models/database');
const goOutAPI = require('../services/goout-api');

/**
 * Free partner tickets on GoOut. See AZURE_GOOUT_SETUP.md, "Free Partner Tickets".
 *
 *   node server/scripts/goout-partner-tickets.js list [--year 2026]
 *   node server/scripts/goout-partner-tickets.js create-deals --sales 616987,616988 [--count 2] [--apply]
 *   node server/scripts/goout-partner-tickets.js issue --sales 616987,616988 \
 *        --first-name Jan --last-name Novak --email partner@example.com [--per-sale 2] [--apply]
 *
 * - list: IRMF sales starting in the year, with their "Partner" category (id, price, places).
 * - create-deals: adds a hidden "Partner" category at 1 Kč to each sale that has none.
 *   The API refuses 0 Kč, so the price (and the parent category) must then be set in the GoOut admin.
 * - issue: creates separate one-ticket purchases in each sale's "Partner" category, topping up
 *   to --per-sale paid purchases for that e-mail. GoOut e-mails the tickets itself and only accepts
 *   0 Kč categories.
 * - Dry run by default; --apply writes to GoOut.
 */

const GOOUT_ORGANIZER_ID = '8736'; // International Road Movie Festival
const PARTNER_DEAL_NAME = 'Partner';
const LANGUAGES = ['cs', 'en', 'pl', 'uk', 'de', 'sk'];

const [command, ...args] = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const YEAR = parseInt(arg('year', new Date().getFullYear()), 10);
const SALES = (arg('sales', '') || '').split(',').map(s => s.trim()).filter(Boolean);

function pragueDateTime(iso) {
  return new Date(iso).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

async function fetchByIds(path, ids) {
  const items = [];
  for (let i = 0; i < ids.length; i += 48) {
    const response = await goOutAPI.apiRequest('GET', path, null, {
      'ids[]': ids.slice(i, i + 48),
      'languages[]': ['cs']
    });
    items.push(...(response.data || []));
  }
  return Object.fromEntries(items.map(item => [item.id, item]));
}

// One sale per request: with several ids[] the included deals can come back incomplete
async function loadSaleDeals(saleId) {
  const response = await goOutAPI.apiRequest('GET', '/services/entitystore/v2/sales', null, {
    'ids[]': [saleId],
    include: 'deals'
  });
  const sale = response.data?.[0];
  if (!sale) throw new Error(`Sale ${saleId} not found`);
  const deals = (response.included || []).filter(item => item.type === 'deals');
  return {
    sale,
    partner: deals.filter(deal => deal.attributes.locales?.cs?.name === PARTNER_DEAL_NAME),
    base: deals.find(deal => deal.attributes.locales?.cs?.name !== PARTNER_DEAL_NAME && deal.attributes.priceCents > 0)
  };
}

async function countPaidPurchases(saleId, email) {
  let count = 0;
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const response = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      'saleIds[]': [saleId],
      'languages[]': ['cs'],
      pageIndex
    });
    count += (response.purchases || []).filter(p =>
      p.attributes.email?.toLowerCase() === email.toLowerCase() && p.attributes.state === 'paid'
    ).length;
    if (!response.meta?.hasNext) break;
  }
  return count;
}

const describeDeal = deal =>
  `${deal.id} ${deal.attributes.priceCents / 100} Kč, ${deal.attributes.ticketCounts?.count} places`;

async function list() {
  const { data: sales } = await goOutAPI.getAllSales('', 20);
  const ourSales = sales.filter(sale =>
    sale.relationships?.organizer?.data?.id === GOOUT_ORGANIZER_ID &&
    sale.attributes?.state !== 'cancelled' &&
    sale.relationships?.schedule?.data?.id
  );
  const schedules = await fetchByIds('/services/entities/v2/schedules',
    [...new Set(ourSales.map(sale => sale.relationships.schedule.data.id))]);
  const events = await fetchByIds('/services/entities/v2/events',
    [...new Set(Object.values(schedules).map(s => s.relationships?.event?.data?.id).filter(Boolean))]);

  const rows = ourSales
    .map(sale => ({ sale, schedule: schedules[sale.relationships.schedule.data.id] }))
    .filter(({ schedule }) => schedule?.attributes?.startAt?.startsWith(`${YEAR}-`))
    .sort((a, b) => a.schedule.attributes.startAt.localeCompare(b.schedule.attributes.startAt));

  for (const { sale, schedule } of rows) {
    const event = events[schedule.relationships?.event?.data?.id];
    const name = event?.attributes?.locales?.cs?.name || '?';
    const when = schedule.attributes.hasTime === false ? 'festival pass' : pragueDateTime(schedule.attributes.startAt);
    const { partner } = await loadSaleDeals(sale.id);
    const partnerInfo = partner.length ? partner.map(describeDeal).join(' + ') : 'no Partner category';
    console.log(`${sale.id}  ${sale.attributes.state.padEnd(8)}  ${when.padEnd(20)}  ${name}  [${partnerInfo}]`);
  }
}

async function createDeals() {
  const count = parseInt(arg('count', '2'), 10);
  for (const saleId of SALES) {
    const { partner, base } = await loadSaleDeals(saleId);
    if (partner.length) {
      console.log(`= ${saleId}: Partner category exists (${partner.map(describeDeal).join(' + ')})`);
      continue;
    }
    if (!base) throw new Error(`Sale ${saleId} has no paid category to copy the sale end from`);

    const deal = {
      type: 'deal',
      locales: Object.fromEntries(LANGUAGES.map(lang => [lang, {
        name: PARTNER_DEAL_NAME, description: null, ticketMessage: null, ticketFullMessage: null
      }])),
      attributes: {
        startAt: new Date().toISOString(),
        endAt: base.attributes.endAt,
        priceCents: 100, // the API refuses 0; switch to 0 Kč in the GoOut admin
        isHidden: true,
        isHiddenDesk: false,
        hasNamedTickets: false,
        ignoreDiscounts: false,
        isSeatedDeal: false,
        onSoldOutDealsSize: 0,
        ticketSendDates: {},
        ticketCounts: { count, minSelect: 0, maxSelect: 10 }
      },
      relationships: { sale: { id: Number(saleId), type: 'sale' } }
    };

    if (!APPLY) {
      console.log(`+ ${saleId}: would create Partner category, 1 Kč, ${count} places, sale ends ${base.attributes.endAt}`);
      continue;
    }
    const created = await goOutAPI.apiRequest('POST', '/services/entitystore/v1/deals', deal);
    console.log(`+ ${saleId}: created Partner category ${(created.data || created).id}`);
  }
}

async function issue() {
  const perSale = parseInt(arg('per-sale', '2'), 10);
  const customer = { firstName: arg('first-name'), lastName: arg('last-name'), email: arg('email') };
  if (!customer.firstName || !customer.lastName || !customer.email) {
    throw new Error('--first-name, --last-name and --email are required');
  }

  for (const saleId of SALES) {
    const { partner } = await loadSaleDeals(saleId);
    if (partner.length !== 1) {
      console.log(`! ${saleId}: expected one Partner category, found ${partner.length}, skipped`);
      continue;
    }
    const deal = partner[0];
    const existing = await countPaidPurchases(saleId, customer.email);
    const missing = Math.max(perSale - existing, 0);
    if (!missing) {
      console.log(`= ${saleId}: ${customer.email} already has ${existing} purchases`);
      continue;
    }
    // The deal price read here can lag behind admin edits; create-purchase checks it itself
    if (!APPLY) {
      console.log(`+ ${saleId}: would issue ${missing} x 1 ticket in ${describeDeal(deal)} (has ${existing})`);
      continue;
    }

    const requests = Array.from({ length: missing }, (_, i) => ({
      ...customer,
      dealId: Number(deal.id),
      ticketCount: 1,
      field1: '', field2: '', field3: '', field4: '',
      customIdent: `irmf-partner-${saleId}-${existing + i + 1}`,
      language: 'cs'
    }));
    try {
      const response = await goOutAPI.apiRequest('POST', '/services/partners/v2/create-purchase', { requests });
      for (const result of response.result) {
        console.log(`+ ${saleId}: ${result.customIdent} ${result.message} (hash ${result.purchaseHash})`);
      }
    } catch (error) {
      console.log(`! ${saleId}: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }
}

async function main() {
  const commands = { list, 'create-deals': createDeals, issue };
  try {
    if (!commands[command]) throw new Error(`Unknown command "${command || ''}" (list, create-deals, issue)`);
    if (command !== 'list' && !SALES.length) throw new Error('--sales is required');
    console.log(`GoOut partner tickets: ${command}${command === 'list' ? ` ${YEAR}` : APPLY ? ' (APPLY)' : ' (dry run)'}\n`);
    await commands[command]();
    if (command !== 'list' && !APPLY) console.log('\nDry run. Re-run with --apply.');
  } catch (error) {
    console.error('GoOut partner tickets failed:', error.response?.data || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
