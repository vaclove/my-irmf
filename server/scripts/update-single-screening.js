require('dotenv').config();
const axios = require('axios');
const goOutAPI = require('../services/goout-api');

const PROD_API_URL = 'https://my.irmf.cz/api';
const EDITION_ID = '71eb30da-0c1d-4201-806d-672ed676ff2a'; // IRMF 2025
const COOKIE = 'connect.sid=s%3Ah2DF292P4rdkrTkLSTRmlGVSDMiD3Dc2.2hT%2BNbrbvePlGbkcRLt8wSfsBv78bO4J17p40aqEQ2c';

async function updateScreening() {
  console.log('🔍 Finding screening at 2025-10-18 16:30...\n');

  try {
    // Fetch all screenings
    const response = await axios.get(`${PROD_API_URL}/programming/edition/${EDITION_ID}`, {
      headers: { Cookie: COOKIE }
    });

    const screenings = response.data;

    // Find the 16:30 screening (movie block)
    const screening = screenings.find(s => {
      const date = s.scheduled_date.split('T')[0];
      const time = s.scheduled_time.slice(0, 5);
      return date === '2025-10-18' && time === '16:30';
    });

    if (!screening) {
      console.log('❌ Screening not found at 2025-10-18 16:30');
      return;
    }

    const movieName = screening.block_name_cs || screening.movie_name_cs;
    console.log(`✓ Found: ${movieName}`);
    console.log(`  ID: ${screening.id}`);
    console.log(`  Type: ${screening.block_id ? 'Block' : 'Movie'}\n`);

    // Get schedule ID for sale 519237
    console.log('🔍 Getting schedule ID for GoOut sale 519237...\n');
    const sales = await goOutAPI.getSales([519237], 'schedules', 0, 50);
    const sale = sales.data[0];

    if (!sale || !sale.relationships?.schedule?.data?.id) {
      console.log('❌ Could not get schedule ID from GoOut');
      return;
    }

    const scheduleId = sale.relationships.schedule.data.id;
    const checkinId = '522619';

    console.log(`✓ Schedule ID: ${scheduleId}`);
    console.log(`✓ Check-in ID: ${checkinId}\n`);

    // Update the screening
    console.log('🚀 Updating screening...\n');

    await axios.put(
      `${PROD_API_URL}/programming/${screening.id}`,
      {
        goout_schedule_id: scheduleId,
        goout_checkin_id: checkinId
      },
      {
        headers: {
          'Cookie': COOKIE,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Successfully updated!');
    console.log(`\n${movieName} (2025-10-18 16:30)`);
    console.log(`  → GoOut Schedule ID: ${scheduleId}`);
    console.log(`  → GoOut Check-in ID: ${checkinId}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
  }
}

updateScreening().then(() => process.exit(0));
