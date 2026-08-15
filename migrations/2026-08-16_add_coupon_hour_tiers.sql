-- Adds hour-based discount tiering to coupons.
-- A coupon can now specify:
--   minHours              e.g. 10  -- the hour threshold
--   belowMinHoursDiscount e.g. 5   -- discount value (same unit as discountType:
--                                     PERCENT or FIXED) applied when the
--                                     booking's totalHours < minHours
-- discountValue (existing column) is used as-is when totalHours >= minHours.
--
-- Both new columns are nullable: existing coupons with no tiering configured
-- keep behaving exactly as before (flat discountValue regardless of hours).
--
-- Run this once against the carlust database (AWS RDS). Safe to re-run —
-- guarded with IF NOT EXISTS-style checks via information_schema.

SET @dbname = DATABASE();

SET @sql = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'minHours'
    ),
    'ALTER TABLE coupons ADD COLUMN minHours INT NULL AFTER discountValue',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'belowMinHoursDiscount'
    ),
    'ALTER TABLE coupons ADD COLUMN belowMinHoursDiscount DECIMAL(10,2) NULL AFTER minHours',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
