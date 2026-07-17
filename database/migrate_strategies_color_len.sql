-- Amplia color para entradas de roleta (NUM:/VIZ:/TERM:)
ALTER TABLE `strategies`
  MODIFY COLUMN `color` VARCHAR(500) NOT NULL;
