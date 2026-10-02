-- Internal notes on the customer card. Not sent to TISP or Zoho.
ALTER TABLE customers
  ADD COLUMN staff_notes TEXT NULL AFTER cancellation_reason;
