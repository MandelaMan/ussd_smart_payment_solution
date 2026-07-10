ALTER TABLE products
  ADD UNIQUE KEY uk_products_building_price (building_id, price);
