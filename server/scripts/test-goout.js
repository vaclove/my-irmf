require('dotenv').config();
const goOutAPI = require('../services/goout-api');

async function testGoOutAPI() {
  try {
    console.log('=== Testing GoOut API Integration ===\n');

    // Test 1: Load tokens from database
    console.log('1. Loading tokens from database...');
    await goOutAPI.loadTokens();
    console.log('✓ Tokens loaded successfully');
    console.log(`   Access token: ${goOutAPI.accessToken.substring(0, 50)}...`);
    console.log(`   Expires at: ${goOutAPI.expiresAt}`);
    console.log(`   Refresh expires at: ${goOutAPI.refreshExpiresAt}\n`);

    // Test 2: Test token refresh
    console.log('2. Testing token refresh...');
    try {
      await goOutAPI.refreshAccessToken();
      console.log('✓ Token refresh successful');
      console.log(`   New access token: ${goOutAPI.accessToken.substring(0, 50)}...`);
      console.log(`   New expires at: ${goOutAPI.expiresAt}\n`);
    } catch (error) {
      console.error('✗ Token refresh failed:', error.response?.data || error.message);
      console.log('   Continuing with existing token...\n');
    }

    // Test 3: Search for a test purchase (using a sample barcode)
    // Note: We need a real barcode from GoOut to test this
    console.log('3. Testing purchase search (will fail without real barcode)...');
    console.log('   Skipping for now - need real barcode to test\n');

    // Test 4: Get MY sales with event details
    console.log('4. Testing retrieval of MY sales with event details...');
    try {
      // First, get schedules with my sales
      console.log('   Fetching schedules with my sales...');
      const schedulesResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
        'languages[]': ['cs'],
        'mySales': true,
        'hasSale': true
      });

      console.log(`✓ Found ${schedulesResponse.schedules?.length || 0} schedules with my sales\n`);

      // Extract sale IDs from schedules
      const saleIds = [];
      schedulesResponse.schedules?.forEach(schedule => {
        schedule.relationships?.sales?.data?.forEach(sale => {
          saleIds.push(sale.id);
        });
      });

      if (saleIds.length === 0) {
        console.log('⚠ No sales found for this user. This could mean:');
        console.log('   - The user does not have organizer rights');
        console.log('   - There are no active sales for this organizer');
        console.log('   - The token may not have the correct permissions\n');
      } else {

      // Now fetch the actual sales details
      console.log(`   Fetching details for ${saleIds.length} sales...\n`);
      const sales = await goOutAPI.getSales(saleIds, 'deals');

      // Create maps from schedules response
      const schedulesMap = {};
      const eventsMap = {};

      if (schedulesResponse.schedules) {
        schedulesResponse.schedules.forEach(schedule => {
          schedulesMap[schedule.id] = schedule;
        });
      }

      if (schedulesResponse.included?.events) {
        schedulesResponse.included.events.forEach(event => {
          eventsMap[event.id] = event;
        });
      }

      // Print table header
      console.log('═'.repeat(160));
      console.log('Sale ID'.padEnd(10) +
                  'Schedule ID'.padEnd(15) +
                  'Event Name (CS)'.padEnd(60) +
                  'State'.padEnd(12) +
                  'Check-in ID'.padEnd(15) +
                  'Deals');
      console.log('═'.repeat(160));

      // Print each sale
      sales.data.forEach(sale => {
        const scheduleId = sale.relationships?.schedule?.data?.id || 'N/A';
        const schedule = schedulesMap[scheduleId];

        // Try to get event name from schedule
        let eventName = 'Unknown Event';
        if (schedule) {
          // Check schedule locales first
          eventName = schedule.locales?.cs?.name || schedule.locales?.en?.name;

          // If not found, try to get from related event
          if (!eventName) {
            const eventId = schedule.relationships?.event?.data?.id;
            const event = eventsMap[eventId];
            eventName = event?.locales?.cs?.name || event?.locales?.en?.name || 'Unknown Event';
          }
        }

        const state = sale.attributes.state;
        const checkInId = sale.relationships?.checkIns?.data?.[0]?.id || 'N/A';
        const dealsCount = sale.relationships?.deals?.data?.length || 0;

        console.log(
          sale.id.padEnd(10) +
          scheduleId.padEnd(15) +
          (eventName.length > 57 ? eventName.substring(0, 57) + '...' : eventName.padEnd(60)) +
          state.padEnd(12) +
          checkInId.padEnd(15) +
          `${dealsCount} deals`
        );
      });

      console.log('═'.repeat(160));
      console.log(`\nTotal MY sales: ${sales.data.length}`);
      console.log(`Total schedules: ${Object.keys(schedulesMap).length}`);
      console.log(`Total events: ${Object.keys(eventsMap).length}\n`);
      }

    } catch (error) {
      console.error('✗ Sales retrieval failed:', error.response?.status, error.response?.data || error.message);
      console.log('');
    }

    // Test 5: Get ACTIVE sales for organizer 8736 (with pagination)
    console.log('5. Getting ACTIVE sales for Organizer ID: 8736 (with pagination)...');
    try {
      // Get all sales with pagination
      console.log('   Fetching all sales (with pagination)...');
      const allSalesResponse = await goOutAPI.getAllSales('deals', 10);

      console.log(`✓ Fetched ${allSalesResponse.totalSales} total sales across ${allSalesResponse.totalPages} pages\n`);

      // Filter by organizer 8736 AND active state
      const activeSales = allSalesResponse.data.filter(sale =>
        sale.relationships?.organizer?.data?.id === '8736' &&
        sale.attributes.state === 'active'
      );

      console.log(`✓ Found ${activeSales.length} ACTIVE sales for organizer 8736 (out of ${allSalesResponse.totalSales} total)\n`);

      if (activeSales.length === 0) {
        console.log('⚠ No active sales found for this organizer\n');
      } else {
        // Get schedule IDs
        const scheduleIds = activeSales
          .map(sale => sale.relationships?.schedule?.data?.id)
          .filter(id => id)
          .slice(0, 48); // API limit

        console.log(`   Fetching ${scheduleIds.length} schedules...\n`);

        // Fetch schedules
        const schedulesResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
          'ids[]': scheduleIds,
          'languages[]': ['cs']
        });

        // Create schedule map
        const schedMap = {};
        schedulesResponse.schedules?.forEach(schedule => {
          schedMap[schedule.id] = schedule;
        });

        // Print table
        console.log('═'.repeat(160));
        console.log('Sale ID'.padEnd(10) +
                    'Schedule ID'.padEnd(15) +
                    'Event Name (CS)'.padEnd(60) +
                    'State'.padEnd(12) +
                    'Check-in ID'.padEnd(15) +
                    'Deals');
        console.log('═'.repeat(160));

        activeSales.forEach(sale => {
          const scheduleId = sale.relationships?.schedule?.data?.id || 'N/A';
          const schedule = schedMap[scheduleId];
          const eventName = schedule?.locales?.cs?.name || schedule?.locales?.en?.name || 'Unknown Event';
          const state = sale.attributes.state;
          const checkInId = sale.relationships?.checkIns?.data?.[0]?.id || 'N/A';
          const dealsCount = sale.relationships?.deals?.data?.length || 0;

          console.log(
            sale.id.padEnd(10) +
            scheduleId.padEnd(15) +
            (eventName.length > 57 ? eventName.substring(0, 57) + '...' : eventName.padEnd(60)) +
            state.padEnd(12) +
            checkInId.padEnd(15) +
            `${dealsCount} deals`
          );
        });

        console.log('═'.repeat(160));
        console.log(`\nTotal ACTIVE sales for organizer 8736: ${activeSales.length}\n`);
      }
    } catch (error) {
      console.error('✗ Failed to get organizer sales:', error.response?.status, error.response?.data || error.message);
      console.log('');
    }

    // Test 6: Get sale details with name and URL
    console.log('6. Getting sale 512393 with name and URL...');
    try {
      const saleDetails = await goOutAPI.getSales([512393], 'deals,discounts,schedules,events');

      if (saleDetails.data.length === 0) {
        console.log('✗ Sale not found\n');
      } else {
        const sale = saleDetails.data[0];
        console.log('✓ Sale found\n');

        // Get schedule name
        const scheduleId = sale.relationships?.schedule?.data?.id;
        let scheduleName = 'Unknown';

        if (scheduleId) {
          console.log(`   Fetching schedule ${scheduleId} for name...\n`);
          try {
            const scheduleResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
              'ids[]': [scheduleId],
              'languages[]': ['cs']
            });

            if (scheduleResponse.schedules && scheduleResponse.schedules.length > 0) {
              const schedule = scheduleResponse.schedules[0];
              scheduleName = schedule.locales?.cs?.name || schedule.locales?.en?.name || 'Unknown';
            }
          } catch (err) {
            console.log('   Could not fetch schedule name');
          }
        }

        console.log('═'.repeat(120));
        console.log('SALE SUMMARY:');
        console.log('═'.repeat(120));
        console.log(`Sale ID:        ${sale.id}`);
        console.log(`Sale Name:      ${scheduleName}`);
        console.log(`Sale URL:       ${sale.attributes.saleUrl || 'Not set (null)'}`);
        console.log(`State:          ${sale.attributes.state}`);
        console.log(`Schedule ID:    ${scheduleId || 'N/A'}`);
        console.log(`Check-in ID:    ${sale.relationships?.checkIns?.data?.[0]?.id || 'N/A'}`);
        console.log(`Organizer ID:   ${sale.relationships?.organizer?.data?.id || 'N/A'}`);
        console.log(`Currency:       ${sale.attributes.currency.toUpperCase()}`);
        console.log(`Inner Sales:    ${sale.relationships?.innerSales?.data?.length || 0} child sales`);
        console.log('');

        // List deals with names
        console.log('DEALS (Ticket Types):');
        console.log('─'.repeat(120));
        if (saleDetails.included) {
          saleDetails.included.forEach((deal, index) => {
            if (deal.type === 'deals') {
              const dealName = deal.attributes?.locales?.cs?.name || deal.attributes?.locales?.en?.name || 'Unnamed';
              const price = deal.attributes.priceCents / 100;
              const capacity = deal.attributes.ticketCounts?.count || 'Unlimited';
              const hasNames = deal.attributes.hasNamedTickets ? 'Named' : 'Anonymous';
              console.log(`${index + 1}. ${dealName} (ID: ${deal.id})`);
              console.log(`   Price: ${price} ${sale.attributes.currency.toUpperCase()} | Capacity: ${capacity} | Type: ${hasNames}`);
              console.log(`   Valid: ${deal.attributes.startAt} → ${deal.attributes.endAt}`);
              console.log('');
            }
          });
        }

        console.log('═'.repeat(120));
        console.log('');
      }
    } catch (error) {
      console.error('✗ Failed to get sale details:', error.response?.status, error.response?.data || error.message);
      console.log('');
    }

    // Test 7: Get all events with ticket sales count
    console.log('7. Getting all events with ticket sales count...');
    try {
      console.log('   Fetching all sales with pagination...');
      const allSalesResponse = await goOutAPI.getAllSales('deals', 10);

      // Filter by organizer 8736
      const mySales = allSalesResponse.data.filter(sale =>
        sale.relationships?.organizer?.data?.id === '8736'
      );

      console.log(`✓ Found ${mySales.length} sales for organizer 8736\n`);

      // Get schedule IDs
      const scheduleIds = mySales
        .map(sale => sale.relationships?.schedule?.data?.id)
        .filter(id => id)
        .slice(0, 48);

      console.log(`   Fetching ${scheduleIds.length} schedules...\n`);

      // Fetch schedules
      const schedulesResponse = await goOutAPI.apiRequest('GET', '/services/entities/v2/schedules', null, {
        'ids[]': scheduleIds,
        'languages[]': ['cs']
      });

      const schedMap = {};
      schedulesResponse.schedules?.forEach(schedule => {
        schedMap[schedule.id] = schedule;
      });

      console.log('   Fetching ticket counts for each sale...\n');

      // For each sale, get purchase count
      const salesWithCounts = [];
      for (const sale of mySales) {
        try {
          const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
            'saleIds[]': [sale.id],
            'languages[]': ['cs'],
            'include': ''
          });

          const ticketCount = purchases.purchases?.length || 0;
          const scheduleId = sale.relationships?.schedule?.data?.id;
          const schedule = schedMap[scheduleId];
          const eventName = schedule?.locales?.cs?.name || schedule?.locales?.en?.name || 'Unknown Event';

          salesWithCounts.push({
            saleId: sale.id,
            eventName,
            state: sale.attributes.state,
            scheduleId,
            checkInId: sale.relationships?.checkIns?.data?.[0]?.id,
            ticketsSold: ticketCount
          });
        } catch (err) {
          console.log(`   Error fetching tickets for sale ${sale.id}`);
        }
      }

      // Print results
      console.log('═'.repeat(160));
      console.log('Sale ID'.padEnd(10) +
                  'Event Name'.padEnd(60) +
                  'State'.padEnd(12) +
                  'Check-in ID'.padEnd(15) +
                  'Tickets Sold'.padEnd(15));
      console.log('═'.repeat(160));

      salesWithCounts.forEach(sale => {
        console.log(
          sale.saleId.padEnd(10) +
          (sale.eventName.length > 57 ? sale.eventName.substring(0, 57) + '...' : sale.eventName.padEnd(60)) +
          sale.state.padEnd(12) +
          (sale.checkInId || 'N/A').padEnd(15) +
          sale.ticketsSold.toString().padEnd(15)
        );
      });

      console.log('═'.repeat(160));
      console.log(`\nTotal events: ${salesWithCounts.length}`);
      console.log(`Total tickets sold: ${salesWithCounts.reduce((sum, s) => sum + s.ticketsSold, 0)}\n`);

    } catch (error) {
      console.error('✗ Failed to get events with ticket counts:', error.response?.status, error.response?.data || error.message);
      console.log('');
    }

    console.log('=== Test Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during testing:', error);
    process.exit(1);
  }
}

testGoOutAPI();