/**
 * Generate one-time ticket codes (0000-9999)
 * Format: 30XXXXC where XXXX is sequence and C is Luhn check digit
 *
 * This script generates all 10,000 possible ticket codes and saves them to a JSON file.
 * These codes can later be used to generate PDFs with barcodes.
 */

const fs = require('fs');
const path = require('path');
const { generateTicketCode } = require('../utils/luhn');

// Generate all ticket codes
const tickets = [];
const totalTickets = 10000;

console.log(`Generating ${totalTickets} ticket codes...`);

for (let i = 0; i < totalTickets; i++) {
  const code = generateTicketCode(i);
  tickets.push({
    sequence: i,
    code: code
  });

  if ((i + 1) % 1000 === 0) {
    console.log(`Generated ${i + 1}/${totalTickets} tickets...`);
  }
}

// Save to JSON file
const outputPath = path.join(__dirname, '../data/ticket-codes.json');
const outputDir = path.dirname(outputPath);

// Create data directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(tickets, null, 2));

console.log(`\n✓ Successfully generated ${totalTickets} ticket codes`);
console.log(`✓ Saved to: ${outputPath}`);
console.log(`\nExample codes:`);
console.log(`  First: ${tickets[0].code} (sequence ${tickets[0].sequence})`);
console.log(`  Last:  ${tickets[tickets.length - 1].code} (sequence ${tickets[tickets.length - 1].sequence})`);
console.log(`\nSample codes:`);
for (let i = 0; i < 5; i++) {
  const randomIndex = Math.floor(Math.random() * tickets.length);
  console.log(`  ${tickets[randomIndex].code} (sequence ${tickets[randomIndex].sequence})`);
}
