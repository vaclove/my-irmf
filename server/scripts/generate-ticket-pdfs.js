/**
 * Generate PDF tickets with unique barcodes
 * Layout: 3 rows × 4 columns = 12 tickets per page
 */

const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const bwipjs = require('bwip-js');
const { generateTicketCode } = require('../utils/luhn');

async function generateBarcode(text) {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',       // Barcode type
      text: text,            // Text to encode
      scale: 2,              // 2x scaling factor (smaller)
      height: 6,             // Bar height, in millimeters (shorter)
      includetext: false,    // Hide human-readable text
    });
    return png;
  } catch (err) {
    console.error('Error generating barcode:', err);
    throw err;
  }
}

async function generateTicketPage(startSequence = 0, count = 12) {
  console.log(`\nGenerating ticket page with ${count} tickets starting from sequence ${startSequence}...`);

  // Load the template PDF
  const templatePath = '/Users/vaclav.martinovsky/GitHub/my-irmf/tmp/a4-vstupenka-2025-prazdna.pdf';
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const { width, height } = firstPage.getSize();

  console.log(`PDF page size: ${width} x ${height} points`);

  // A4 size: 595 x 842 points
  // Layout: 4 columns × 3 rows
  // NOTE: User provided exact measurements from template:
  // - First row ends at 1966.8 px out of 7016 px total height
  // - This gives us exact ticket height
  const cols = 4;
  const rows = 3;
  const ticketWidth = width / cols;

  // Calculate exact ticket height from pixel measurements
  // First ticket: 1966.8 / 7016 = 0.28036 of page height
  const firstTicketHeightRatio = 1966.8 / 7016;
  const ticketHeight = firstTicketHeightRatio * height; // = 236.35 points

  console.log(`Calculated ticket height: ${ticketHeight.toFixed(2)} points`);

  // Barcode offset from top of each ticket (row 0 works at 721.9)
  // Top of page (841.89) - barcode Y (721.9) = 119.99 from top
  const barcodeOffsetFromTicketTop = 120;

  // Calculate Y position for each row's barcode
  const barcodeYPositions = [
    height - barcodeOffsetFromTicketTop,                    // Row 0
    height - ticketHeight - barcodeOffsetFromTicketTop,     // Row 1
    height - (2 * ticketHeight) - barcodeOffsetFromTicketTop // Row 2
  ];

  console.log(`Barcode Y positions: ${barcodeYPositions.map(y => y.toFixed(1)).join(', ')}`);

  // Generate barcodes for each ticket
  const tickets = [];
  for (let i = 0; i < count && i < 12; i++) {
    const sequence = startSequence + i;
    const code = generateTicketCode(sequence);
    const barcodePng = await generateBarcode(code);
    tickets.push({ sequence, code, barcodePng });
    console.log(`  Generated barcode for ticket #${sequence}: ${code}`);
  }

  // Position barcodes on the page
  // Place barcode between "Jednorázová jízdenka" and "VSTUPENKA NA JEDNU FILMOVOU PROJEKCI"
  for (let i = 0; i < tickets.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;

    // Calculate position (origin is bottom-left)
    // We want to place the barcode centered horizontally in each ticket cell

    const barcodeImage = await pdfDoc.embedPng(tickets[i].barcodePng);
    const barcodeDims = barcodeImage.scale(0.6); // Scale to fit nicely

    // Position: Between "Jednorázová jízdenka" (top) and "VSTUPENKA NA JEDNU FILMOVOU PROJEKCI" (bottom)
    const x = col * ticketWidth + (ticketWidth / 2) - (barcodeDims.width / 2); // Center horizontally

    // Use pre-calculated Y positions for each row
    const y = barcodeYPositions[row];

    firstPage.drawImage(barcodeImage, {
      x: x,
      y: y,
      width: barcodeDims.width,
      height: barcodeDims.height,
    });

    console.log(`  Placed barcode at row ${row}, col ${col}: (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = `/Users/vaclav.martinovsky/GitHub/my-irmf/tmp/tickets-page-${startSequence}-${startSequence + count - 1}.pdf`;
  fs.writeFileSync(outputPath, pdfBytes);

  console.log(`\n✓ Successfully generated PDF with ${tickets.length} tickets`);
  console.log(`✓ Saved to: ${outputPath}`);
  console.log(`\nTicket codes on this page:`);
  for (let i = 0; i < tickets.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    console.log(`  Row ${row + 1}, Col ${col + 1}: ${tickets[i].code} (sequence ${tickets[i].sequence})`);
  }

  return outputPath;
}

// Main execution
(async () => {
  try {
    // Generate first page (tickets 0-11)
    const outputPath = await generateTicketPage(0, 12);
    console.log(`\nDone! Please check: ${outputPath}`);
  } catch (error) {
    console.error('Error generating tickets:', error);
    process.exit(1);
  }
})();
