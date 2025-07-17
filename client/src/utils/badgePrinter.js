import '../assets/fonts/roboto-normal.js';
import '../assets/fonts/roboto-bold.js';

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';

const ELEMENT_TYPES = {
  GUEST_PHOTO: 'guest_photo',
  GUEST_NAME: 'guest_name',
  GUEST_CATEGORY: 'guest_category',
  BADGE_NUMBER: 'badge_number',
  BARCODE: 'barcode',
  STATIC_TEXT: 'static_text',
  LOGO: 'logo'
};

// Convert mm to PDF points (1 mm = 2.834645669 points)
const mmToPt = (mm) => mm * 2.834645669;

// Convert pixels to mm (BadgeDesigner uses 2 pixels per mm)
const pxToMm = (px) => px / 2;

// Generate barcode as data URL
const generateBarcode = (text, width = 100, height = 40) => {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, text, {
      format: 'CODE128',
      width: 2,
      height: height,
      displayValue: false,
      margin: 0,
      background: 'transparent'  // Make barcode background transparent
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error generating barcode:', error);
    return null;
  }
};

// Get guest photo as data URL (placeholder for now)
const getGuestPhoto = async (photoUrl) => {
  if (!photoUrl) return null;
  
  try {
    const response = await fetch(photoUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error loading photo:', error);
    return null;
  }
};

// Render text element on PDF
const renderTextElement = (pdf, element, guestData, editionYear) => {
  const x = mmToPt(pxToMm(element.x));
  const y = mmToPt(pxToMm(element.y));
  const fontSize = element.fontSize || 14;

  // Set custom Roboto font with UTF-8 support
  const fontStyle = element.fontWeight === 'bold' ? 'bold' : 'normal';
  pdf.setFont('Roboto', fontStyle);
  pdf.setFontSize(fontSize);
  pdf.setTextColor(element.color || '#000000');
  
  let text = '';
  
  switch (element.type) {
    case ELEMENT_TYPES.GUEST_NAME:
      text = `${guestData.first_name || ''} ${guestData.last_name || ''}`.trim();
      break;
    case ELEMENT_TYPES.GUEST_CATEGORY:
      text = (guestData.category || 'guest').toUpperCase();
      break;
    case ELEMENT_TYPES.BADGE_NUMBER:
      text = guestData.formatted_badge_number || '';
      break;
    case ELEMENT_TYPES.STATIC_TEXT:
      text = element.text || '';
      break;
    default:
      text = 'Text';
  }
  
  // Handle text alignment
  const align = element.textAlign || 'left';
  const elementWidth = mmToPt(pxToMm(element.width));
  
  if (align === 'center') {
    pdf.text(text, x + elementWidth / 2, y + fontSize * 0.7, { align: 'center' });
  } else if (align === 'right') {
    pdf.text(text, x + elementWidth, y + fontSize * 0.7, { align: 'right' });
  } else {
    pdf.text(text, x, y + fontSize * 0.7);
  }
};

// Render barcode element on PDF
const renderBarcodeElement = (pdf, element, guestData) => {
  const x = mmToPt(pxToMm(element.x));
  const y = mmToPt(pxToMm(element.y));
  const width = mmToPt(pxToMm(element.width));
  const height = mmToPt(pxToMm(element.height));
  
  const barcodeText = guestData.formatted_badge_number || '2024001';
  const barcodeDataUrl = generateBarcode(barcodeText, pxToMm(element.width), pxToMm(element.height));
  
  if (barcodeDataUrl) {
    pdf.addImage(barcodeDataUrl, 'PNG', x, y, width, height);
  } else {
    // Fallback: render as text
    pdf.setFontSize(10);
    pdf.text(barcodeText, x, y + height / 2);
  }
};

// Render photo element on PDF
const renderPhotoElement = async (pdf, element, guestData) => {
  const x = mmToPt(pxToMm(element.x));
  const y = mmToPt(pxToMm(element.y));
  const width = mmToPt(pxToMm(element.width));
  const height = mmToPt(pxToMm(element.height));
  
  const photoDataUrl = await getGuestPhoto(guestData.photo);
  
  if (photoDataUrl) {
    pdf.addImage(photoDataUrl, 'JPEG', x, y, width, height);
  } else {
    // Placeholder rectangle
    pdf.setDrawColor(200, 200, 200);
    pdf.setFillColor(240, 240, 240);
    pdf.rect(x, y, width, height, 'FD');
    
    // Add placeholder text
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text('No Photo', x + width / 2, y + height / 2, { align: 'center' });
  }
};

// Generate PDF badge
export const generateBadgePDF = async (layout, guestData, editionYear) => {
  const pdf = new jsPDF({
    orientation: layout.canvas_width_mm > layout.canvas_height_mm ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [mmToPt(layout.canvas_width_mm), mmToPt(layout.canvas_height_mm)]
  });
  
  
  // Set background color if specified
  if (layout.background_color && layout.background_color !== '#ffffff') {
    pdf.setFillColor(layout.background_color);
    pdf.rect(0, 0, mmToPt(layout.canvas_width_mm), mmToPt(layout.canvas_height_mm), 'F');
  }
  
  // Sort elements by z-index to render in correct order
  const sortedElements = [...(layout.layout_data?.elements || [])].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));
  
  // Render each element
  for (const element of sortedElements) {
    try {
      switch (element.type) {
        case ELEMENT_TYPES.GUEST_PHOTO:
          await renderPhotoElement(pdf, element, guestData);
          break;
        case ELEMENT_TYPES.BARCODE:
          renderBarcodeElement(pdf, element, guestData);
          break;
        case ELEMENT_TYPES.GUEST_NAME:
        case ELEMENT_TYPES.GUEST_CATEGORY:
        case ELEMENT_TYPES.BADGE_NUMBER:
        case ELEMENT_TYPES.STATIC_TEXT:
          renderTextElement(pdf, element, guestData, editionYear);
          break;
        default:
          console.warn(`Unknown element type: ${element.type}`);
      }
    } catch (error) {
      console.error(`Error rendering element ${element.id}:`, error);
    }
  }
  
  return pdf;
};

// Print badge - generate PDF and display in browser
export const printBadge = async (layout, guestData, editionYear) => {
  try {
    const pdf = await generateBadgePDF(layout, guestData, editionYear);
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    
    // Open PDF in new browser tab
    const newWindow = window.open(url, '_blank');
    if (newWindow) {
      newWindow.focus();
    } else {
      // Fallback if popup blocked - create download link
      const link = document.createElement('a');
      link.href = url;
      link.download = `badge_${guestData.formatted_badge_number || guestData.id}.pdf`;
      link.click();
    }
    
    // Clean up the URL object after a delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    return true;
  } catch (error) {
    console.error('Error printing badge:', error);
    throw error;
  }
};

// Preview badge - generate PDF blob URL for preview
export const previewBadge = async (layout, guestData, editionYear) => {
  try {
    const pdf = await generateBadgePDF(layout, guestData, editionYear);
    const blob = pdf.output('blob');
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Error generating badge preview:', error);
    throw error;
  }
};