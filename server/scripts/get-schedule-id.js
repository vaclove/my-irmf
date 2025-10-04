require('dotenv').config();
const goOutAPI = require('../services/goout-api');

const saleId = process.argv[2] || 519227;

(async () => {
  try {
    const sales = await goOutAPI.getSales([parseInt(saleId)], 'schedules', 0, 50);
    const sale = sales.data[0];

    if (sale && sale.relationships?.schedule?.data?.id) {
      console.log(sale.relationships.schedule.data.id);
    } else {
      console.log('ERROR: Schedule ID not found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
})();
