-- Speed up customer list search by apartment / name prefixes.
ALTER TABLE customers
  ADD INDEX idx_customer_apartment (apartment_number),
  ADD INDEX idx_customer_last_name (last_name),
  ADD INDEX idx_customer_first_name (first_name);
