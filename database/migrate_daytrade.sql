-- Day Trade / IQ Option
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `iqEmail` VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS `iqPassword` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `iqSsid` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `iqBalanceId` BIGINT NULL,
  ADD COLUMN IF NOT EXISTS `iqAccountType` VARCHAR(10) NOT NULL DEFAULT 'DEMO',
  ADD COLUMN IF NOT EXISTS `daytradeIsActive` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `daytradeIsBetting` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `daytradeConnectPending` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `daytradeConnectError` TEXT NULL;

CREATE TABLE IF NOT EXISTS `daytrade_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `strategyType` VARCHAR(50) NOT NULL DEFAULT 'HORÁRIOS',
  `enterType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `enterValue` DOUBLE NOT NULL DEFAULT 1,
  `enterPercent` DOUBLE NOT NULL DEFAULT 1,
  `stopType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `stopGain` VARCHAR(20) NOT NULL DEFAULT '20',
  `stopLoss` VARCHAR(20) NOT NULL DEFAULT '10',
  `martingale` INT NOT NULL DEFAULT 1,
  `martingaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `expirationMinutes` INT NOT NULL DEFAULT 1,
  `minPayout` DOUBLE NOT NULL DEFAULT 70,
  `defaultAsset` VARCHAR(50) NOT NULL DEFAULT 'EURUSD-OTC',
  `quantityCycles` INT NOT NULL DEFAULT 1,
  `skipFirstEntry` TINYINT(1) NOT NULL DEFAULT 0,
  `skipEntryAfterLoss` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daytrade_settings_ownerId_unique` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `daytrade_variables` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `balance` DOUBLE NOT NULL DEFAULT 10000,
  `firstBalance` DOUBLE NOT NULL DEFAULT 10000,
  `profit` DOUBLE NOT NULL DEFAULT 0,
  `countWin` INT NOT NULL DEFAULT 0,
  `countLoss` INT NOT NULL DEFAULT 0,
  `countMartingale` INT NOT NULL DEFAULT 0,
  `isGale` TINYINT(1) NOT NULL DEFAULT 0,
  `monthCountWin` INT NOT NULL DEFAULT 0,
  `monthCountLoss` INT NOT NULL DEFAULT 0,
  `monthStartBalance` DOUBLE NOT NULL DEFAULT 10000,
  `firstBalanceDate` DATETIME NULL,
  `monthStartDate` DATETIME NULL,
  `firstBalanceMode` VARCHAR(10) NULL,
  `lastDirection` VARCHAR(10) NULL,
  `lastAsset` VARCHAR(50) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daytrade_variables_ownerId_unique` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `daytrade_strategies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `strategyType` VARCHAR(50) NOT NULL DEFAULT 'HORÁRIOS',
  `sequence` VARCHAR(200) NOT NULL,
  `color` VARCHAR(50) NOT NULL DEFAULT 'CALL',
  `asset` VARCHAR(50) NOT NULL DEFAULT 'EURUSD-OTC',
  `expirationMinutes` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `daytrade_strategies_owner_idx` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `daytrade_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `asset` VARCHAR(50) NULL,
  `direction` VARCHAR(10) NULL,
  `amount` DOUBLE NULL,
  `expiration` INT NULL,
  `result` VARCHAR(20) NULL,
  `profit` DOUBLE NULL,
  `pattern` VARCHAR(200) NULL,
  `mode` VARCHAR(10) NULL,
  `externalId` VARCHAR(80) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `daytrade_entries_owner_idx` (`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
