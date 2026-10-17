-- Migration: box-office tickets sold at the venue (Tickets → Box office) and
-- printed on a 58 mm thermal printer.
--
-- box_office_categories: ticket categories with their price. A category with
--   programming_id NULL is part of the edition's default price list; one with
--   programming_id belongs to that screening only. A screening with active
--   categories of its own sells only those (e.g. yoga, workshops), every other
--   screening sells the edition's defaults. goout_deal_id links a category
--   imported from a GoOut deal. Categories that sold tickets are deactivated,
--   not deleted.
--
-- box_office_tickets: one row per printed ticket. Tickets sold together share
--   order_id. code is what the QR code holds: 10 digits starting with 4, the last
--   one a Luhn check digit (see server/utils/boxOfficeCode.js), so the scanner
--   tells it apart from badges (7 digits), one-time tickets (30XXXXC) and GoOut
--   tickets (13 digits). Category name and price are copied at sale time so later
--   edits of a category don't change sold tickets. Cancelled tickets keep their
--   row (cancelled_at) and no longer count into capacity or revenue.
--   Free tickets have payment_method 'free' and price 0. A free ticket may be
--   issued to an existing guest (guest_id, holder_name printed on the ticket):
--   its scan is recorded for that guest, so the guest's history shows what they saw.
--
-- programming_schedule.ticket_capacity: seats for sale at a screening, when it
--   differs from the venue capacity (e.g. seats kept for guests and pass holders).
--   Box office sells up to this minus the valid GoOut tickets and the box-office
--   tickets already sold.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

ALTER TABLE programming_schedule
ADD COLUMN IF NOT EXISTS ticket_capacity INTEGER CHECK (ticket_capacity IS NULL OR ticket_capacity >= 0);

CREATE TABLE IF NOT EXISTS box_office_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  programming_id UUID REFERENCES programming_schedule(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  goout_deal_id VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_box_office_categories_edition_id ON box_office_categories(edition_id);
CREATE INDEX IF NOT EXISTS idx_box_office_categories_programming_id ON box_office_categories(programming_id);

CREATE TABLE IF NOT EXISTS box_office_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  order_id UUID NOT NULL,
  programming_id UUID NOT NULL REFERENCES programming_schedule(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES box_office_categories(id) ON DELETE SET NULL,
  category_name VARCHAR(100) NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  payment_method VARCHAR(10) NOT NULL CHECK (payment_method IN ('cash', 'card', 'free')),
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  holder_name VARCHAR(255),
  note VARCHAR(200),
  sold_by VARCHAR(255),
  sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_count INTEGER NOT NULL DEFAULT 1,
  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_box_office_tickets_programming_id ON box_office_tickets(programming_id);
CREATE INDEX IF NOT EXISTS idx_box_office_tickets_order_id ON box_office_tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_box_office_tickets_sold_at ON box_office_tickets(sold_at);
CREATE INDEX IF NOT EXISTS idx_box_office_tickets_guest_id ON box_office_tickets(guest_id);
