require('dotenv').config();
const axios = require('axios');
const goOutAPI = require('../services/goout-api');

const PROD_API_URL = 'https://my.irmf.cz/api';
const EDITION_ID = '71eb30da-0c1d-4201-806d-672ed676ff2a'; // IRMF 2025
const COOKIE = 'connect.sid=s%3Ah2DF292P4rdkrTkLSTRmlGVSDMiD3Dc2.2hT%2BNbrbvePlGbkcRLt8wSfsBv78bO4J17p40aqEQ2c';

// GoOut sale ID to schedule ID mapping
const GOOUT_MAPPING = {
  512393: { name: 'International Road Movie Festival 2025', date: '2025-10-16', time: '12:00', checkin: '515766' },
  519227: { name: 'Karavan', date: '2025-10-16', time: '18:30', checkin: '522609' },
  519228: { name: 'Když se ztrácí slova', date: '2025-10-16', time: '21:00', checkin: '522610' },
  519229: { name: 'Cyklooptimisti', date: '2025-10-17', time: '10:45', checkin: '522611' },
  519230: { name: 'Na cestě se ZČU', date: '2025-10-17', time: '14:00', checkin: '522612' },
  519231: { name: 'Be Equal – blok lidskoprávních filmů', date: '2025-10-17', time: '16:00', checkin: '522613' },
  519232: { name: 'Ještě nejsem, kým chci být', date: '2025-10-17', time: '18:00', checkin: '522614' },
  519233: { name: 'Král králů s živou hudbou', date: '2025-10-17', time: '20:00', checkin: '522615' },
  519234: { name: 'Cesta do pravěku', date: '2025-10-18', time: '10:00', checkin: '522616' },
  519235: { name: 'Šlápnout vedle', date: '2025-10-18', time: '12:00', checkin: '522617' },
  519236: { name: 'Sušenkové blues', date: '2025-10-18', time: '14:00', checkin: '522618' },
  519237: { name: 'Neobyčejné výpravy ke štěstí', date: '2025-10-18', time: '16:00', checkin: '522619' },
  519238: { name: 'Sirat', date: '2025-10-18', time: '20:00', checkin: '522620' },
  519239: { name: 'Auta', date: '2025-10-19', time: '10:00', checkin: '522621' },
  519240: { name: 'Ukradená vzducholoď', date: '2025-10-19', time: '14:00', checkin: '522622' },
  519241: { name: 'Kilometry války', date: '2025-10-19', time: '16:30', checkin: '522623' },
  519242: { name: 'Bláznivý Petříček', date: '2025-10-19', time: '19:00', checkin: '522624' }
};

async function getScheduleIds() {
  console.log('📡 Fetching schedule IDs from GoOut API...\n');

  const saleIds = Object.keys(GOOUT_MAPPING).map(id => parseInt(id));
  const scheduleMap = {};

  for (const saleId of saleIds) {
    try {
      const sales = await goOutAPI.getSales([saleId], 'schedules', 0, 50);
      const sale = sales.data[0];

      if (sale && sale.relationships?.schedule?.data?.id) {
        scheduleMap[saleId] = sale.relationships.schedule.data.id;
        console.log(`✓ Sale ${saleId}: schedule_id = ${scheduleMap[saleId]}`);
      } else {
        console.log(`✗ Sale ${saleId}: No schedule ID found`);
      }
    } catch (error) {
      console.error(`✗ Sale ${saleId}: Error - ${error.message}`);
    }
  }

  return scheduleMap;
}

async function updateProdScreenings(scheduleMap) {
  console.log('\n📡 Fetching production screenings...\n');

  try {
    const response = await axios.get(`${PROD_API_URL}/programming/edition/${EDITION_ID}`, {
      headers: { Cookie: COOKIE }
    });

    const screenings = response.data;
    console.log(`Found ${screenings.length} screenings in production\n`);

    const updates = [];

    // Match screenings with GoOut sales
    for (const [saleId, gooutData] of Object.entries(GOOUT_MAPPING)) {
      const scheduleId = scheduleMap[saleId];
      if (!scheduleId) continue;

      // Find matching screening by date and time
      const matching = screenings.find(s => {
        const sDate = s.scheduled_date.split('T')[0];
        const sTime = s.scheduled_time.slice(0, 5);
        return sDate === gooutData.date && sTime === gooutData.time;
      });

      if (matching) {
        updates.push({
          screening_id: matching.id,
          movie_name: matching.movie_name_cs || matching.block_name_cs,
          sale_id: saleId,
          schedule_id: scheduleId,
          checkin_id: gooutData.checkin,
          date: gooutData.date,
          time: gooutData.time
        });
      } else {
        console.log(`⚠️  No matching screening for: ${gooutData.name} (${gooutData.date} ${gooutData.time})`);
      }
    }

    console.log(`\n📋 Found ${updates.length} screenings to update:\n`);
    updates.forEach(u => {
      console.log(`   ${u.date} ${u.time} - ${u.movie_name}`);
      console.log(`   → Sale: ${u.sale_id}, Schedule: ${u.schedule_id}, Check-in: ${u.checkin_id}\n`);
    });

    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\n🔄 Proceed with updates? (yes/no): ', async (answer) => {
        rl.close();

        if (answer.toLowerCase() !== 'yes') {
          console.log('❌ Update cancelled');
          resolve();
          return;
        }

        console.log('\n🚀 Updating screenings...\n');

        for (const update of updates) {
          try {
            await axios.put(
              `${PROD_API_URL}/programming/${update.screening_id}`,
              {
                goout_schedule_id: update.schedule_id,
                goout_checkin_id: update.checkin_id
              },
              { headers: { 'Cookie': COOKIE, 'Content-Type': 'application/json' } }
            );

            console.log(`✓ Updated: ${update.movie_name}`);
          } catch (error) {
            console.error(`✗ Failed: ${update.movie_name} - ${error.message}`);
          }
        }

        console.log('\n✅ Update complete!');
        resolve();
      });
    });

  } catch (error) {
    console.error('Error fetching screenings:', error.message);
    if (error.response?.status === 401) {
      console.error('⚠️  Authentication failed. Please update the COOKIE in the script.');
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  GoOut Screenings Mapper - Production Update');
  console.log('═══════════════════════════════════════════════════════════\n');

  const scheduleMap = await getScheduleIds();
  await updateProdScreenings(scheduleMap);

  process.exit(0);
}

main();
