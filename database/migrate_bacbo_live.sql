-- Bac Bo Ao Vivo — tabelas isoladas (rodar na VPS se schema.sql já foi aplicado antes)
-- mysql -u USER -p DB < database/migrate_bacbo_live.sql

CREATE TABLE IF NOT EXISTS `bacbo_live_results` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `externalId` VARCHAR(50) NOT NULL,
  `winner` VARCHAR(20) NOT NULL,
  `playerTotal` INT NOT NULL,
  `bankerTotal` INT NOT NULL,
  `player1` INT NOT NULL DEFAULT 0,
  `player2` INT NOT NULL DEFAULT 0,
  `banker1` INT NOT NULL DEFAULT 0,
  `banker2` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bacbo_live_results_externalId_unique` (`externalId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_live_strategies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sequence` VARCHAR(500) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `strategyType` VARCHAR(30) NOT NULL DEFAULT 'SEQUÊNCIA',
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bacbo_live_strategies_ownerId_idx` (`ownerId`),
  CONSTRAINT `bacbo_live_strategies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_live_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `strategyType` VARCHAR(50) NOT NULL DEFAULT 'SEQUÊNCIA',
  `enterType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `enterPercent` DOUBLE NOT NULL DEFAULT 0,
  `enterValue` DOUBLE NOT NULL DEFAULT 0,
  `stopType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `stopGain` VARCHAR(20) NOT NULL DEFAULT '0',
  `stopLoss` VARCHAR(20) NOT NULL DEFAULT '0',
  `protectionHand` VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  `protectionValue` DOUBLE NOT NULL DEFAULT 0,
  `whiteMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `martingale` INT NOT NULL DEFAULT 1,
  `martingaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `whiteEntryGaleEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `whiteEntryGale` INT NOT NULL DEFAULT 1,
  `whiteEntryGaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `whiteEntryType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `whiteEntryValue` DOUBLE NOT NULL DEFAULT 0,
  `whiteEntryPercent` DOUBLE NOT NULL DEFAULT 0,
  `quantityCycles` INT NOT NULL DEFAULT 1,
  `skipFirstEntry` TINYINT(1) NOT NULL DEFAULT 0,
  `skipEntryAfterLoss` TINYINT(1) NOT NULL DEFAULT 0,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bacbo_live_settings_ownerId_unique` (`ownerId`),
  CONSTRAINT `bacbo_live_settings_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_live_variables` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `countLoss` INT NOT NULL DEFAULT 0,
  `countWin` INT NOT NULL DEFAULT 0,
  `countMartingale` INT NOT NULL DEFAULT 0,
  `profit` DOUBLE NOT NULL DEFAULT 0,
  `balance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalanceDate` DATETIME NULL,
  `monthStartBalance` DOUBLE NOT NULL DEFAULT 0,
  `monthStartDate` DATETIME NULL,
  `monthCountWin` INT NOT NULL DEFAULT 0,
  `monthCountLoss` INT NOT NULL DEFAULT 0,
  `isGale` TINYINT(1) NOT NULL DEFAULT 0,
  `lastCycleWasLoss` TINYINT(1) NOT NULL DEFAULT 0,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bacbo_live_variables_ownerId_unique` (`ownerId`),
  CONSTRAINT `bacbo_live_variables_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_live_bot_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(20) NOT NULL,
  `signalColor` VARCHAR(20) NULL,
  `resultColor` VARCHAR(20) NULL,
  `pattern` VARCHAR(200) NULL,
  `betAmount` DOUBLE NULL,
  `profit` DOUBLE NULL,
  `galeLevel` INT NULL,
  `ownerId` INT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bacbo_live_bot_entries_ownerId_idx` (`ownerId`),
  CONSTRAINT `bacbo_live_bot_entries_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
