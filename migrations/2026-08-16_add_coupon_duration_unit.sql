-- Extends coupon hour-tiering to also support Weeks/Months as the
-- threshold's unit (previously the `minHours` threshold was always
-- interpreted as hours). `minHours` keeps its column name for backward
-- compatibility (existing coupons already have thresholds stored there),
-- but its VALUE is now interpreted in whatever `durationUnit` says.
--
-- Existing coupons get durationUnit = 'HOURS', which is exactly how their
-- `minHours` value was already being interpreted — no behavior change for
-- any coupon created before this migration.
--
-- Safe to re-run.

SET @dbname = DATABASE();

SET @sql = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'durationUnit'
    ),
    "ALTER TABLE coupons ADD COLUMN durationUnit VARCHAR(10) DEFAULT 'HOURS' AFTER minHours",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
