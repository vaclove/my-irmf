/**
 * Generate PDF tickets with unique barcodes
 * Layout: 3 rows × 4 columns = 12 tickets per page
 *
 * Usage: node server/scripts/generate-ticket-pdfs.js [startSequence] [pageCount] [outputDir]
 * Output defaults to tmp/ in the repo root (gitignored).
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const bwipjs = require('bwip-js');
const { generateTicketCode } = require('../utils/luhn');

const TEMPLATE_PATH = path.join(__dirname, '../data/ticket-template.pdf');

const TICKETS_PER_PAGE = 12;
const MM = 72 / 25.4; // points per millimetre

// Code128 with 0.45 mm bars keeps the 10-module quiet zone on each side of the
// 52.5 mm wide ticket; 14 mm tall bars fill most of the gap between the texts.
// Bigger bars can be read from further away, beyond the minimum focus
// distance of phones without good autofocus.
const BAR_SCALE = 4;          // PNG pixels per module
const MODULE_MM = 0.45;
const BARCODE_HEIGHT_MM = 14;

async function generateBarcode(text) {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',       // Barcode type
      text: text,            // Text to encode
      scale: BAR_SCALE,
      height: 4,             // Only sets the PNG aspect; drawn size is set below
      includetext: false,    // Hide human-readable text
    });
    return png;
  } catch (err) {
    console.error('Error generating barcode:', err);
    throw err;
  }
}

async function drawTicketPage(pdfDoc, page, startSequence) {
  const { width, height } = page.getSize();

  // A4 template, 4 columns × 3 rows of tickets
  const cols = 4;
  const ticketWidth = width / cols;

  // Measured from the template text positions (points from the page top):
  // "jízdenka" ends at 74.6 and "VSTUPENKA" starts at 135.6 in the first row,
  // rows repeat every 235.9
  const rowPitch = 235.9;
  const gapCenterFromTop = (74.6 + 135.6) / 2;

  const barcodeHeight = BARCODE_HEIGHT_MM * MM;

  const codes = [];
  for (let i = 0; i < TICKETS_PER_PAGE; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const code = generateTicketCode(startSequence + i);

    const barcodeImage = await pdfDoc.embedPng(await generateBarcode(code));
    const modules = barcodeImage.width / BAR_SCALE;
    const barcodeWidth = modules * MODULE_MM * MM;

    // Center in the ticket cell (origin is bottom-left)
    const x = col * ticketWidth + (ticketWidth - barcodeWidth) / 2;
    const y = height - (row * rowPitch + gapCenterFromTop + barcodeHeight / 2);

    page.drawImage(barcodeImage, {
      x: x,
      y: y,
      width: barcodeWidth,
      height: barcodeHeight,
    });

    codes.push(code);
  }

  return codes;
}

async function generateTicketPdf(outputDir, startSequence = 0, pageCount = 1) {
  const endSequence = startSequence + pageCount * TICKETS_PER_PAGE - 1;
  if (endSequence > 9999) {
    throw new Error(`Sequence ${endSequence} is out of range (max 9999)`);
  }

  console.log(`Generating ${pageCount} page(s), tickets ${startSequence}-${endSequence}...`);

  const templateDoc = await PDFDocument.load(fs.readFileSync(TEMPLATE_PATH));
  const pdfDoc = await PDFDocument.create();

  for (let p = 0; p < pageCount; p++) {
    const [page] = await pdfDoc.copyPages(templateDoc, [0]);
    pdfDoc.addPage(page);

    const pageStart = startSequence + p * TICKETS_PER_PAGE;
    const codes = await drawTicketPage(pdfDoc, page, pageStart);
    console.log(`  Page ${p + 1}/${pageCount}: ${codes[0]} - ${codes[codes.length - 1]}`);
  }

  const outputPath = path.join(outputDir, `tickets-${startSequence}-${endSequence}.pdf`);
  fs.writeFileSync(outputPath, await pdfDoc.save());

  console.log(`\n✓ Generated ${pageCount * TICKETS_PER_PAGE} tickets`);
  return outputPath;
}

// Main execution
(async () => {
  const [start = '0', pages = '1', outputDir = path.join(__dirname, '../../tmp')] = process.argv.slice(2);

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = await generateTicketPdf(outputDir, parseInt(start, 10), parseInt(pages, 10));
    console.log(`Done! Please check: ${outputPath}`);
  } catch (error) {
    console.error('Error generating tickets:', error);
    process.exit(1);
  }
})();
