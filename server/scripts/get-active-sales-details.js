require('dotenv').config();
const goOutAPI = require('../services/goout-api');

async function getActiveSalesDetails() {
  try {
    console.log('=== Fetching Active Sales Details ===\n');

    // Get all sales with pagination
    console.log('1. Fetching all sales...');
    const allSalesResponse = await goOutAPI.getAllSales('deals', 10);

    // Filter by organizer 8736 AND active state
    const activeSales = allSalesResponse.data.filter(sale =>
      sale.relationships?.organizer?.data?.id === '8736' &&
      sale.attributes.state === 'active'
    );

    console.log(`✓ Found ${activeSales.length} active sales\n`);

    // Get all schedule IDs
    const scheduleIds = activeSales
      .map(sale => sale.relationships?.schedule?.data?.id)
      .filter(id => id);

    console.log(`2. Fetching ${scheduleIds.length} schedules...\n`);

    // Fetch schedules in batches (max 48 per request)
    const allSchedules = [];
    for (let i = 0; i < scheduleIds.length; i += 48) {
      const batch = scheduleIds.slice(i, i + 48);
      const schedulesResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
        'ids[]': batch,
        'languages[]': ['cs']
      });
      if (schedulesResponse.data) {
        allSchedules.push(...schedulesResponse.data);
      }
    }

    // Create schedule map
    const scheduleMap = {};
    allSchedules.forEach(schedule => {
      scheduleMap[schedule.id] = schedule;
    });

    // Get unique event IDs
    const eventIds = [...new Set(allSchedules
      .map(schedule => schedule.relationships?.event?.data?.id)
      .filter(id => id)
    )];

    console.log(`3. Fetching ${eventIds.length} events...\n`);

    // Fetch events in batches (max 48 per request)
    const allEvents = [];
    for (let i = 0; i < eventIds.length; i += 48) {
      const batch = eventIds.slice(i, i + 48);
      const eventsResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/events', null, {
        'ids[]': batch,
        'languages[]': ['cs']
      });
      if (eventsResponse.data) {
        allEvents.push(...eventsResponse.data);
      }
    }

    // Create event map
    const eventMap = {};
    allEvents.forEach(event => {
      eventMap[event.id] = event;
    });

    console.log('4. Building detailed list...\n');

    // Build detailed list
    const salesDetails = [];
    activeSales.forEach(sale => {
      const scheduleId = sale.relationships?.schedule?.data?.id;
      const schedule = scheduleMap[scheduleId];

      if (schedule) {
        const eventId = schedule.relationships?.event?.data?.id;
        const event = eventMap[eventId];

        const eventName = event?.attributes?.locales?.cs?.name || event?.attributes?.locales?.en?.name || 'Unknown';
        const startAt = schedule.attributes?.startAt;
        const gooutUrl = schedule.attributes?.locales?.cs?.siteUrl || schedule.attributes?.locales?.en?.siteUrl || '';
        const sourceUrl = schedule.attributes?.sourceUrls?.[0] || '';

        salesDetails.push({
          saleId: sale.id,
          scheduleId: scheduleId,
          eventId: eventId || 'N/A',
          eventName: eventName,
          startAt: startAt || 'N/A',
          gooutUrl: gooutUrl,
          sourceUrl: sourceUrl,
          checkInId: sale.relationships?.checkIns?.data?.[0]?.id || 'N/A'
        });
      }
    });

    // Sort by date
    salesDetails.sort((a, b) => {
      if (a.startAt === 'N/A') return 1;
      if (b.startAt === 'N/A') return -1;
      return new Date(a.startAt) - new Date(b.startAt);
    });

    // Print table
    console.log('═'.repeat(200));
    console.log(
      'Sale ID'.padEnd(10) +
      'Event ID'.padEnd(12) +
      'Event Name'.padEnd(60) +
      'Date & Time'.padEnd(25) +
      'Check-in ID'.padEnd(15) +
      'GoOut URL'
    );
    console.log('═'.repeat(200));

    salesDetails.forEach(detail => {
      const dateTime = detail.startAt !== 'N/A'
        ? new Date(detail.startAt).toLocaleString('cs-CZ', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'N/A';

      console.log(
        detail.saleId.padEnd(10) +
        detail.eventId.padEnd(12) +
        (detail.eventName.length > 57 ? detail.eventName.substring(0, 57) + '...' : detail.eventName.padEnd(60)) +
        dateTime.padEnd(25) +
        detail.checkInId.padEnd(15) +
        detail.gooutUrl
      );
    });

    console.log('═'.repeat(200));
    console.log(`\nTotal active sales: ${salesDetails.length}\n`);

    // Also print source URLs separately (they're often long)
    console.log('\nSOURCE URLs (IRMF links):');
    console.log('─'.repeat(150));
    salesDetails.forEach(detail => {
      if (detail.sourceUrl) {
        console.log(`Sale ${detail.saleId} (${detail.eventName.substring(0, 40)}): ${detail.sourceUrl}`);
      }
    });
    console.log('─'.repeat(150));

    console.log('\n=== Complete ===');
    process.exit(0);

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

getActiveSalesDetails();