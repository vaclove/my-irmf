require('dotenv').config();
const goOutAPI = require('../services/goout-api');

const saleId = process.argv[2] || 519227;

(async () => {
  try {
    // Get purchases with tickets included
    const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      'saleIds[]': [parseInt(saleId)],
      'languages[]': ['cs'],
      'include': 'tickets'
    });

    console.log('Total purchases:', purchases.purchases?.length || 0);

    // Count total tickets across all purchases
    let totalTickets = 0;
    if (purchases.purchases) {
      purchases.purchases.forEach(purchase => {
        const ticketCount = purchase.tickets?.length || 0;
        totalTickets += ticketCount;
        console.log(`Purchase ${purchase.id}: ${ticketCount} ticket(s)`);
      });
    }

    console.log('\nTotal tickets:', totalTickets);

  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
})();
