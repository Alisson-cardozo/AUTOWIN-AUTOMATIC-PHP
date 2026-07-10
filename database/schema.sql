-- AutoWin PHP — schema MySQL (paridade com Prisma do sistema Node)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `email` VARCHAR(200) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_users_username_unique` (`username`),
  UNIQUE KEY `admin_users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userBot` BIGINT NULL UNIQUE,
  `email` VARCHAR(200) NULL,
  `name` VARCHAR(200) NULL,
  `password` VARCHAR(255) NULL,
  `accountType` VARCHAR(10) NOT NULL DEFAULT 'DEMO',
  `gameType` VARCHAR(10) NOT NULL DEFAULT 'DOUBLE',
  `hashedToken` TEXT NULL,
  `alreadyTested` TINYINT(1) NOT NULL DEFAULT 0,
  `token` TEXT NULL,
  `processPid` BIGINT NULL,
  `wallet` VARCHAR(20) NULL,
  `blazeEmail` VARCHAR(200) NULL,
  `connectPending` TINYINT(1) NOT NULL DEFAULT 0,
  `connectError` TEXT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 0,
  `isTesting` TINYINT(1) NOT NULL DEFAULT 0,
  `isAdminAccount` TINYINT(1) NOT NULL DEFAULT 0,
  `paymentId` BIGINT NULL,
  `paymentExpireIn` INT NULL,
  `paymentStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `features` TEXT NULL,
  `pendingFeatures` TEXT NULL,
  `notifyPrefs` TEXT NULL,
  `isBetting` TINYINT(1) NOT NULL DEFAULT 0,
  `colorBet` VARCHAR(20) NULL,
  `colorBefore` VARCHAR(20) NULL,
  `pointBet` VARCHAR(20) NULL,
  `pointBefore` VARCHAR(20) NULL,
  `webPassword` VARCHAR(255) NULL,
  `jonbetEmail` VARCHAR(200) NULL,
  `jonbetPassword` VARCHAR(255) NULL,
  `jonbetToken` TEXT NULL,
  `jonbetWallet` VARCHAR(20) NULL,
  `jonbetConnectPending` TINYINT(1) NOT NULL DEFAULT 0,
  `jonbetConnectError` TEXT NULL,
  `jonbetAccountType` VARCHAR(10) NOT NULL DEFAULT 'DEMO',
  `jonbetGameType` VARCHAR(10) NOT NULL DEFAULT 'DOUBLE',
  `jonbetIsActive` TINYINT(1) NOT NULL DEFAULT 0,
  `jonbetIsBetting` TINYINT(1) NOT NULL DEFAULT 0,
  `jonbetColorBet` VARCHAR(20) NULL,
  `jonbetColorBefore` VARCHAR(20) NULL,
  `jonbetPointBet` VARCHAR(20) NULL,
  `jonbetPointBefore` VARCHAR(20) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expireIn` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `users_email_idx` (`email`),
  KEY `users_paymentStatus_idx` (`paymentStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `endpoint` VARCHAR(500) NOT NULL,
  `p256dh` VARCHAR(200) NOT NULL,
  `auth` VARCHAR(200) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `push_subscriptions_endpoint_unique` (`endpoint`),
  KEY `push_subscriptions_ownerId_idx` (`ownerId`),
  CONSTRAINT `push_subscriptions_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `strategyType` VARCHAR(50) NOT NULL DEFAULT 'SEQUÊNCIA',
  `enterType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `enterPercent` DOUBLE NOT NULL DEFAULT 0,
  `enterValue` DOUBLE NOT NULL DEFAULT 0,
  `firstAmount` DOUBLE NOT NULL DEFAULT 0,
  `firstProtection` DOUBLE NOT NULL DEFAULT 0,
  `stopType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `stopGain` VARCHAR(20) NOT NULL DEFAULT '0',
  `stopLoss` VARCHAR(20) NOT NULL DEFAULT '0',
  `protectionHand` VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  `protectionValue` DOUBLE NOT NULL DEFAULT 0,
  `martingale` INT NOT NULL DEFAULT 1,
  `whiteMartingale` VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  `martingaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `whiteMultiplier` DOUBLE NOT NULL DEFAULT 2,
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
  UNIQUE KEY `settings_ownerId_unique` (`ownerId`),
  CONSTRAINT `settings_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `variables` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `countLoss` INT NOT NULL DEFAULT 0,
  `countWin` INT NOT NULL DEFAULT 0,
  `countMartingale` INT NOT NULL DEFAULT 0,
  `profit` DOUBLE NOT NULL DEFAULT 0,
  `balance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalanceDate` DATETIME NULL,
  `firstBalanceMode` VARCHAR(10) NULL,
  `monthStartBalance` DOUBLE NOT NULL DEFAULT 0,
  `monthStartDate` DATETIME NULL,
  `monthCountWin` INT NOT NULL DEFAULT 0,
  `monthCountLoss` INT NOT NULL DEFAULT 0,
  `created` INT NOT NULL DEFAULT 0,
  `isGale` TINYINT(1) NOT NULL DEFAULT 0,
  `lastCycleWasLoss` TINYINT(1) NOT NULL DEFAULT 0,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `variables_ownerId_unique` (`ownerId`),
  CONSTRAINT `variables_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jonbet_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `strategyType` VARCHAR(50) NOT NULL DEFAULT 'SEQUÊNCIA',
  `enterType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `enterPercent` DOUBLE NOT NULL DEFAULT 0,
  `enterValue` DOUBLE NOT NULL DEFAULT 0,
  `firstAmount` DOUBLE NOT NULL DEFAULT 0,
  `firstProtection` DOUBLE NOT NULL DEFAULT 0,
  `stopType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  `stopGain` VARCHAR(20) NOT NULL DEFAULT '0',
  `stopLoss` VARCHAR(20) NOT NULL DEFAULT '0',
  `protectionHand` VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  `protectionValue` DOUBLE NOT NULL DEFAULT 0,
  `martingale` INT NOT NULL DEFAULT 1,
  `whiteMartingale` VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  `martingaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
  `whiteMultiplier` DOUBLE NOT NULL DEFAULT 2,
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
  UNIQUE KEY `jonbet_settings_ownerId_unique` (`ownerId`),
  CONSTRAINT `jonbet_settings_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jonbet_variables` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `countLoss` INT NOT NULL DEFAULT 0,
  `countWin` INT NOT NULL DEFAULT 0,
  `countMartingale` INT NOT NULL DEFAULT 0,
  `profit` DOUBLE NOT NULL DEFAULT 0,
  `balance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalance` DOUBLE NOT NULL DEFAULT 0,
  `firstBalanceDate` DATETIME NULL,
  `firstBalanceMode` VARCHAR(10) NULL,
  `monthStartBalance` DOUBLE NOT NULL DEFAULT 0,
  `monthStartDate` DATETIME NULL,
  `monthCountWin` INT NOT NULL DEFAULT 0,
  `monthCountLoss` INT NOT NULL DEFAULT 0,
  `created` INT NOT NULL DEFAULT 0,
  `isGale` TINYINT(1) NOT NULL DEFAULT 0,
  `lastCycleWasLoss` TINYINT(1) NOT NULL DEFAULT 0,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `jonbet_variables_ownerId_unique` (`ownerId`),
  CONSTRAINT `jonbet_variables_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `strategies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sequence` VARCHAR(500) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `gameType` VARCHAR(10) NOT NULL DEFAULT 'DOUBLE',
  `strategyType` VARCHAR(30) NOT NULL DEFAULT 'SEQUÊNCIA',
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `strategies_ownerId_idx` (`ownerId`),
  CONSTRAINT `strategies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Resultados live por JOGO + PLATAFORMA (Blaze Double ≠ Jonbet Double, etc.)
CREATE TABLE IF NOT EXISTS `game_results` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `blazeId` VARCHAR(50) NULL,
  `gameType` VARCHAR(10) NOT NULL,
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  `color` VARCHAR(20) NULL,
  `roll` INT NULL,
  `crashPoint` DOUBLE NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `game_results_gameType_platform_createdAt_idx` (`gameType`, `platform`, `createdAt`),
  KEY `game_results_blazeId_platform_idx` (`blazeId`, `platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `roulette_results` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `evoId` VARCHAR(100) NOT NULL,
  `result` INT NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `lightningMultiplier` INT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `roulette_results_evoId_unique` (`evoId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(20) NOT NULL,
  `gameType` VARCHAR(20) NULL,
  `signalColor` VARCHAR(20) NULL,
  `resultColor` VARCHAR(20) NULL,
  `pattern` VARCHAR(200) NULL,
  `betAmount` DOUBLE NULL,
  `profit` DOUBLE NULL,
  `galeLevel` INT NULL,
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  `ownerId` INT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bot_entries_ownerId_idx` (`ownerId`),
  KEY `bot_entries_owner_month_idx` (`ownerId`, `createdAt`),
  CONSTRAINT `bot_entries_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `telegram_userbots` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `session` TEXT NULL,
  `phone` VARCHAR(20) NULL,
  `groupId` VARCHAR(50) NULL,
  `groupName` VARCHAR(200) NULL,
  `keywords` TEXT NULL,
  `signalKeyword` TEXT NULL,
  `signalKeywordVerified` TINYINT(1) NOT NULL DEFAULT 0,
  `isConnected` TINYINT(1) NOT NULL DEFAULT 0,
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `telegram_userbots_ownerId_unique` (`ownerId`),
  CONSTRAINT `telegram_userbots_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_strategies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sequence` VARCHAR(500) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `gameType` VARCHAR(10) NOT NULL DEFAULT 'DOUBLE',
  `strategyType` VARCHAR(30) NOT NULL,
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_config` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL,
  `value` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_config_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_results` (
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
  UNIQUE KEY `bacbo_results_externalId_unique` (`externalId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_strategies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sequence` VARCHAR(500) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `strategyType` VARCHAR(30) NOT NULL DEFAULT 'SEQUÊNCIA',
  `ownerId` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bacbo_strategies_ownerId_idx` (`ownerId`),
  CONSTRAINT `bacbo_strategies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_settings` (
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
  UNIQUE KEY `bacbo_settings_ownerId_unique` (`ownerId`),
  CONSTRAINT `bacbo_settings_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_variables` (
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
  UNIQUE KEY `bacbo_variables_ownerId_unique` (`ownerId`),
  CONSTRAINT `bacbo_variables_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bacbo_bot_entries` (
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
  KEY `bacbo_bot_entries_ownerId_idx` (`ownerId`),
  CONSTRAINT `bacbo_bot_entries_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comandos IPC entre web e worker de bots
CREATE TABLE IF NOT EXISTS `bot_commands` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  `action` VARCHAR(30) NOT NULL,
  `payload` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `bot_commands_status_idx` (`status`, `id`),
  KEY `bot_commands_userId_idx` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE',
  `message` TEXT NOT NULL,
  `strategyType` VARCHAR(50) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bot_messages_userId_idx` (`userId`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Instalações já existentes — migrate.php tolera "coluna já existe".
ALTER TABLE `bot_messages` ADD COLUMN `strategyType` VARCHAR(50) NULL;
ALTER TABLE `game_results` ADD COLUMN `platform` VARCHAR(10) NOT NULL DEFAULT 'BLAZE';
ALTER TABLE `game_results` ADD KEY `game_results_gameType_platform_createdAt_idx` (`gameType`, `platform`, `createdAt`);

SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO `system_config` (`key`, `value`) VALUES
  ('EMERGENCY_STOP', 'false'),
  ('TRIAL_DAYS', '1'),
  ('PLANS', '[{"id":"mensal","name":"Mensal","price":49.90,"days":30,"features":["double","crash","fortune","jonbet","bacbo","premium"]},{"id":"trimestral","name":"Trimestral","price":129.90,"days":90,"features":["double","crash","fortune","jonbet","bacbo","premium"]}]'),
  ('ANNOUNCEMENT', ''),
  ('SOCIAL_INSTAGRAM', ''),
  ('SOCIAL_TELEGRAM', ''),
  ('SOCIAL_GITHUB', ''),
  ('MERCADOPAGO_ACCESS_TOKEN', ''),
  ('VAPID_PUBLIC_KEY', ''),
  ('VAPID_PRIVATE_KEY', ''),
  ('TELEGRAM_API_ID', ''),
  ('TELEGRAM_API_HASH', '')
ON DUPLICATE KEY UPDATE `key` = `key`;
