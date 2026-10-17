const express = require('express');
const { auditMiddleware } = require('../utils/auditLogger');
const boxOffice = require('../services/box-office');

// Box office (Tickets → Box office): sell and print tickets at the venue,
// see server/services/box-office.js

const router = express.Router();
const audit = auditMiddleware('box_office');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wrap a handler: BoxOfficeError becomes its HTTP status, anything else a 500
const handle = (label, fn) => async (req, res) => {
  for (const value of Object.values(req.params)) {
    if (!UUID_RE.test(value)) return res.status(404).json({ error: 'Not found' });
  }
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof boxOffice.BoxOfficeError) {
      return res.status(error.status).json({ error: error.message, ...error.extra });
    }
    console.error(`Box office: ${label} failed:`, error);
    res.status(500).json({ error: `Failed to ${label}` });
  }
};

const requireEdition = (req, res) => {
  if (UUID_RE.test(req.query.edition_id || '')) return req.query.edition_id;
  res.status(400).json({ error: 'edition_id is required' });
  return null;
};

router.get('/screenings', handle('load screenings', async (req, res) => {
  const editionId = requireEdition(req, res);
  if (!editionId) return;
  res.json({ screenings: await boxOffice.listScreenings(editionId) });
}));

// One screening with GoOut tickets loaded fresh, the categories it sells and its box-office tickets
router.get('/screenings/:programming_id', handle('load screening', async (req, res) => {
  const screening = await boxOffice.getScreening(req.params.programming_id);
  if (!screening) return res.status(404).json({ error: 'Screening not found or has no tickets' });
  res.json({
    screening,
    categories: await boxOffice.listEffectiveCategories(req.params.programming_id),
    tickets: await boxOffice.listTickets(req.params.programming_id)
  });
}));

// Own price list for a screening, starting as a copy of the edition defaults
router.post('/screenings/:programming_id/prices', audit, handle('customize prices', async (req, res) => {
  res.json({ categories: await boxOffice.customizePrices(req.params.programming_id) });
}));

// Back to the edition's default price list
router.delete('/screenings/:programming_id/prices', audit, handle('reset prices', async (req, res) => {
  await boxOffice.useDefaultPrices(req.params.programming_id);
  res.json({ success: true });
}));

router.put('/screenings/:programming_id/capacity', audit, handle('set capacity', async (req, res) => {
  res.json({ screening: await boxOffice.setTicketCapacity(req.params.programming_id, req.body.ticket_capacity) });
}));

// An edition's default price list (?edition_id=) or a screening's own one (?programming_id=)
router.get('/categories', handle('load categories', async (req, res) => {
  if (UUID_RE.test(req.query.programming_id || '')) {
    return res.json({ categories: await boxOffice.listCategories({ programmingId: req.query.programming_id }) });
  }
  const editionId = requireEdition(req, res);
  if (!editionId) return;
  res.json({ categories: await boxOffice.listCategories({ editionId }) });
}));

router.post('/categories', audit, handle('create category', async (req, res) => {
  if (!UUID_RE.test(req.body.edition_id || '')) return res.status(400).json({ error: 'edition_id is required' });
  if (req.body.programming_id && !UUID_RE.test(req.body.programming_id)) {
    return res.status(400).json({ error: 'Invalid programming_id' });
  }
  res.status(201).json(await boxOffice.createCategory(req.body.edition_id, req.body));
}));

router.put('/categories/:id', audit, handle('update category', async (req, res) => {
  res.json(await boxOffice.updateCategory(req.params.id, req.body));
}));

router.delete('/categories/:id', audit, handle('delete category', async (req, res) => {
  res.json(await boxOffice.deleteCategory(req.params.id));
}));

router.post('/sales', audit, handle('sell tickets', async (req, res) => {
  const { programming_id, items, payment_method } = req.body;
  if (!UUID_RE.test(programming_id || '')) return res.status(400).json({ error: 'programming_id is required' });
  const sale = await boxOffice.sellTickets({
    programmingId: programming_id,
    items,
    paymentMethod: payment_method,
    soldBy: req.user?.email || null
  });
  res.status(201).json({ id: sale.orderId, ...sale });
}));

// Free tickets, printed now; optionally issued to an existing guest
router.post('/free-tickets', audit, handle('issue free tickets', async (req, res) => {
  const { programming_id, quantity, guest_id, note } = req.body;
  if (!UUID_RE.test(programming_id || '')) return res.status(400).json({ error: 'programming_id is required' });
  if (guest_id && !UUID_RE.test(guest_id)) return res.status(400).json({ error: 'Invalid guest_id' });
  const issued = await boxOffice.issueFreeTickets({
    programmingId: programming_id,
    quantity,
    guestId: guest_id || null,
    note,
    soldBy: req.user?.email || null
  });
  res.status(201).json({ id: issued.orderId, ...issued });
}));

// Guests by name or email, for free tickets
router.get('/guests', handle('search guests', async (req, res) => {
  res.json({ guests: await boxOffice.searchGuests(req.query.q) });
}));

router.post('/tickets/:id/reprint', audit, handle('reprint ticket', async (req, res) => {
  res.json({ ticket: await boxOffice.reprintTicket(req.params.id) });
}));

router.post('/tickets/:id/cancel', audit, handle('cancel ticket', async (req, res) => {
  res.json(await boxOffice.cancelTicket(req.params.id, req.user?.email || null));
}));

router.get('/summary', handle('load summary', async (req, res) => {
  const editionId = requireEdition(req, res);
  if (!editionId) return;
  res.json({ rows: await boxOffice.getSummary(editionId) });
}));

module.exports = router;
