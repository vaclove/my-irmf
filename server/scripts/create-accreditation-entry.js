require('dotenv').config();
const axios = require('axios');
const goOutAPI = require('../services/goout-api');

const PROD_API_URL = 'https://my.irmf.cz/api';
const EDITION_ID = '71eb30da-0c1d-4201-806d-672ed676ff2a'; // IRMF 2025
const COOKIE = 'connect.sid=s%3Ah2DF292P4rdkrTkLSTRmlGVSDMiD3Dc2.2hT%2BNbrbvePlGbkcRLt8wSfsBv78bO4J17p40aqEQ2c';

async function createAccreditationEntry() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Creating Festival Accreditation Entry');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Get schedule ID for GoOut sale 512393
    console.log('🔍 Getting GoOut schedule ID for sale 512393...\n');
    const sales = await goOutAPI.getSales([512393], 'schedules', 0, 50);
    const sale = sales.data[0];

    if (!sale || !sale.relationships?.schedule?.data?.id) {
      console.log('❌ Could not get schedule ID from GoOut');
      return;
    }

    const scheduleId = sale.relationships.schedule.data.id;
    const checkinId = '515766';

    console.log(`✓ GoOut Schedule ID: ${scheduleId}`);
    console.log(`✓ GoOut Check-in ID: ${checkinId}\n`);

    // Step 2: Get venues to find the main entrance/info desk
    console.log('🔍 Fetching venues...\n');
    const venuesResponse = await axios.get(`${PROD_API_URL}/venues`, {
      headers: { Cookie: COOKIE }
    });

    const venues = venuesResponse.data;
    console.log('Available venues:');
    venues.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.name_cs} (${v.name_en}) - ID: ${v.id}`);
    });

    // Use the first venue or you can specify a specific one
    const venue = venues[0];
    console.log(`\n✓ Using venue: ${venue.name_cs}\n`);

    // Step 3: Create a dummy "Accreditation" movie entry
    console.log('🎬 Creating Accreditation movie entry...\n');

    const movieData = {
      edition_id: EDITION_ID,
      name_cs: 'Akreditace festivalu',
      name_en: 'Festival Accreditation',
      synopsis_cs: 'Vyzvednutí akreditací a festivalových materiálů',
      synopsis_en: 'Accreditation and festival materials pickup',
      runtime: '0',
      director: 'IRMF',
      year: 2025,
      country: 'Česká republika',
      is_public: false
    };

    const movieResponse = await axios.post(`${PROD_API_URL}/movies`, movieData, {
      headers: { Cookie: COOKIE, 'Content-Type': 'application/json' }
    });

    const movie = movieResponse.data;
    console.log(`✓ Movie created: ${movie.name_cs} (ID: ${movie.id})\n`);

    // Step 4: Create programming entry
    console.log('📅 Creating programming schedule entry...\n');

    const programmingData = {
      edition_id: EDITION_ID,
      venue_id: venue.id,
      movie_id: movie.id,
      scheduled_date: '2025-10-16',
      scheduled_time: '12:00',
      discussion_time: 0,
      title_override_cs: 'Akreditace festivalu',
      title_override_en: 'Festival Accreditation',
      notes: 'Vyzvednutí festivalových akreditací a materiálů / Festival accreditation and materials pickup',
      ticket_link: 'https://goout.net/cs/international-road-movie-festival-2025/szxybby/',
      highlighted: false,
      hidden_from_public: true,
      goout_schedule_id: scheduleId,
      goout_checkin_id: checkinId
    };

    const programmingResponse = await axios.post(
      `${PROD_API_URL}/programming`,
      programmingData,
      {
        headers: { Cookie: COOKIE, 'Content-Type': 'application/json' }
      }
    );

    const programming = programmingResponse.data;

    console.log('✅ Successfully created accreditation entry!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Entry Details:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Title (CS): ${programmingData.title_override_cs}`);
    console.log(`Title (EN): ${programmingData.title_override_en}`);
    console.log(`Date: ${programmingData.scheduled_date}`);
    console.log(`Time: ${programmingData.scheduled_time}`);
    console.log(`Venue: ${venue.name_cs}`);
    console.log(`Hidden from public: ${programmingData.hidden_from_public ? 'YES ✓' : 'NO'}`);
    console.log(`GoOut Schedule ID: ${scheduleId}`);
    console.log(`GoOut Check-in ID: ${checkinId}`);
    console.log(`Programming ID: ${programming.id}`);
    console.log(`Movie ID: ${movie.id}`);
    console.log('═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

createAccreditationEntry().then(() => process.exit(0));
