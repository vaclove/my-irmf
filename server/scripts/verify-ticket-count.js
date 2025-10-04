require('dotenv').config();
const goOutAPI = require('../services/goout-api');

const saleId = process.argv[2] || 519227;

(async () => {
  try {
    const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      'saleIds[]': [parseInt(saleId)],
      'languages[]': ['cs'],
      'include': ''
    });

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║          GoOut Ticket Count Verification                 ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║ Sale ID: ${saleId}`.padEnd(60) + '║');
    console.log('╠═══════════════════════════════════════════════════════════╣');

    let totalTickets = 0;
    if (purchases.purchases) {
      purchases.purchases.forEach((purchase, index) => {
        const ticketCount = purchase.attributes?.ticketCount || 0;
        totalTickets += ticketCount;
        const name = `${purchase.attributes?.firstName} ${purchase.attributes?.lastName}`;
        console.log(`║ Purchase ${index + 1}: ${ticketCount} ticket(s) - ${name}`.padEnd(60) + '║');
      });
    }

    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║ Total Purchases: ${purchases.purchases?.length || 0}`.padEnd(60) + '║');
    console.log(`║ Total Tickets: ${totalTickets}`.padEnd(60) + '║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
})();
