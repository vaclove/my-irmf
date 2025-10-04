require('dotenv').config();
const goOutAPI = require('../services/goout-api');

const saleId = process.argv[2] || 519227;

(async () => {
  try {
    // Get purchases with full details
    const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      'saleIds[]': [parseInt(saleId)],
      'languages[]': ['cs'],
      'include': 'tickets,items'
    });

    console.log('Total purchases:', purchases.purchases?.length || 0);
    console.log('\n=== First Purchase Structure ===');
    if (purchases.purchases && purchases.purchases.length > 0) {
      console.log(JSON.stringify(purchases.purchases[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
})();
