-- Pécule — schéma de départ d'une installation neuve. Écrit par `pnpm db:initial`, ne pas modifier à la main.
-- inclut-jusqu-a: drizzle/0033_actif_versements.sql
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES';
-- § table accounts
CREATE TABLE `accounts` (
  `id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `display_name` varchar(120) DEFAULT NULL,
  `institution` varchar(120) DEFAULT NULL,
  `owner` varchar(16) NOT NULL DEFAULT 'autre',
  `kind` varchar(16) NOT NULL DEFAULT 'courant',
  `currency` char(3) NOT NULL DEFAULT 'EUR',
  `balance` decimal(14,2) DEFAULT NULL,
  `balance_at` datetime DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT 0,
  `excluded` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `source` varchar(16) NOT NULL DEFAULT 'finta',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `balance_original` decimal(14,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table account_prefs
CREATE TABLE `account_prefs` (
  `user_id` int(11) NOT NULL,
  `account_id` varchar(64) NOT NULL,
  `hidden` tinyint(1) DEFAULT NULL,
  `excluded` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`user_id`,`account_id`),
  CONSTRAINT `fk_prefs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table account_sources
CREATE TABLE `account_sources` (
  `finta_account_id` char(36) NOT NULL,
  `account_id` varchar(64) NOT NULL,
  `connection_id` char(36) DEFAULT NULL,
  `connection_status` varchar(32) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`finta_account_id`),
  KEY `idx_sources_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table agenda_items
CREATE TABLE `agenda_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `kind` varchar(12) NOT NULL DEFAULT 'tache',
  `title` varchar(255) NOT NULL,
  `notes` text DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `domain` varchar(16) NOT NULL DEFAULT 'autre',
  `entity_type` varchar(16) DEFAULT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `amount` decimal(14,2) DEFAULT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'a_faire',
  `done_at` datetime DEFAULT NULL,
  `recurrence` varchar(12) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'manuel',
  `source_ref` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agenda_source_ref` (`source_ref`),
  KEY `fk_agenda_owner` (`owner_user_id`),
  KEY `idx_agenda_due` (`status`,`due_date`),
  CONSTRAINT `fk_agenda_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table ai_usage
CREATE TABLE `ai_usage` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `thread_id` char(36) DEFAULT NULL,
  `feature` varchar(24) NOT NULL,
  `model` varchar(64) NOT NULL,
  `input_tokens` int(11) NOT NULL DEFAULT 0,
  `cache_write_tokens` int(11) NOT NULL DEFAULT 0,
  `cache_read_tokens` int(11) NOT NULL DEFAULT 0,
  `output_tokens` int(11) NOT NULL DEFAULT 0,
  `cost_usd` decimal(12,6) NOT NULL DEFAULT 0.000000,
  `cost_eur` decimal(12,6) NOT NULL DEFAULT 0.000000,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_ai_usage_user` (`user_id`),
  KEY `idx_ai_usage_date` (`created_at`),
  KEY `idx_ai_usage_thread` (`thread_id`),
  CONSTRAINT `fk_ai_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table alerts
CREATE TABLE `alerts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_at` datetime NOT NULL DEFAULT current_timestamp(),
  `level` varchar(16) NOT NULL DEFAULT 'erreur',
  `source` varchar(32) NOT NULL,
  `message` varchar(512) NOT NULL,
  `details` text DEFAULT NULL,
  `occurrences` int(11) NOT NULL DEFAULT 1,
  `resolved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_alerts_open` (`resolved_at`,`last_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table api_tokens
CREATE TABLE `api_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(80) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `scope` varchar(16) NOT NULL DEFAULT 'depot',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_used_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_api_tokens_hash` (`token_hash`),
  KEY `fk_api_tokens_user` (`user_id`),
  CONSTRAINT `fk_api_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table app_kv
CREATE TABLE `app_kv` (
  `key` varchar(64) NOT NULL,
  `value` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table assets
CREATE TABLE `assets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `name` varchar(160) NOT NULL,
  `category` varchar(16) NOT NULL,
  `institution` varchar(255) DEFAULT NULL,
  `valuation` varchar(16) NOT NULL DEFAULT 'manuel',
  `ticker` varchar(32) DEFAULT NULL,
  `quantity` decimal(24,8) DEFAULT NULL,
  `cash` decimal(14,2) DEFAULT NULL,
  `value` decimal(14,2) DEFAULT NULL,
  `value_date` date DEFAULT NULL,
  `invested` decimal(14,2) DEFAULT NULL,
  `share` decimal(5,4) NOT NULL DEFAULT 1.0000,
  `liquidity` varchar(24) DEFAULT NULL,
  `loan_ids` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `closed` tinyint(1) NOT NULL DEFAULT 0,
  `payout_match` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assets_name` (`owner_user_id`,`name`),
  CONSTRAINT `fk_assets_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table assistant_actions
CREATE TABLE `assistant_actions` (
  `id` char(36) NOT NULL,
  `thread_id` char(36) NOT NULL,
  `user_id` int(11) NOT NULL,
  `tool_use_id` varchar(64) NOT NULL,
  `tool` varchar(64) NOT NULL,
  `input` text NOT NULL,
  `label` varchar(255) NOT NULL,
  `details` text DEFAULT NULL,
  `fingerprint` char(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `result` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `decided_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_actions_thread` (`thread_id`,`status`),
  KEY `idx_actions_fingerprint` (`user_id`,`fingerprint`),
  CONSTRAINT `fk_actions_thread` FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_actions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table assistant_memories
CREATE TABLE `assistant_memories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `content` varchar(500) NOT NULL,
  `thread_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_memories_user` (`user_id`,`created_at`),
  CONSTRAINT `fk_memories_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table assistant_threads
CREATE TABLE `assistant_threads` (
  `id` char(36) NOT NULL,
  `user_id` int(11) NOT NULL,
  `messages` longtext NOT NULL,
  `display` longtext NOT NULL,
  `pending` longtext DEFAULT NULL,
  `input_tokens` int(11) NOT NULL DEFAULT 0,
  `output_tokens` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `title` varchar(160) DEFAULT NULL,
  `pinned` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_threads_user` (`user_id`,`updated_at`),
  CONSTRAINT `fk_threads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table audit_log
CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  `user_id` int(11) DEFAULT NULL,
  `via` varchar(16) NOT NULL,
  `action` varchar(96) NOT NULL,
  `target` varchar(191) DEFAULT NULL,
  `details` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_audit_user` (`user_id`),
  KEY `idx_audit_at` (`at`),
  KEY `idx_audit_action` (`action`,`target`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table auth_challenges
CREATE TABLE `auth_challenges` (
  `id` char(64) NOT NULL,
  `challenge` varchar(255) NOT NULL,
  `purpose` varchar(16) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table balances
CREATE TABLE `balances` (
  `account_id` varchar(64) NOT NULL,
  `date` date NOT NULL,
  `balance` decimal(14,2) NOT NULL,
  PRIMARY KEY (`account_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table career_periods
CREATE TABLE `career_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) NOT NULL,
  `period` varchar(60) NOT NULL,
  `start_year` int(11) DEFAULT NULL,
  `end_year` int(11) DEFAULT NULL,
  `employer` varchar(160) DEFAULT NULL,
  `income` decimal(12,2) DEFAULT NULL,
  `quarters` int(11) DEFAULT NULL,
  `points` decimal(10,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_career_period` (`owner_user_id`,`period`),
  CONSTRAINT `fk_career_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table categories
CREATE TABLE `categories` (
  `id` varchar(16) NOT NULL,
  `name` varchar(120) NOT NULL,
  `group_name` varchar(120) DEFAULT NULL,
  `poste` varchar(120) DEFAULT NULL,
  `kind` varchar(16) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `description` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table commitments
CREATE TABLE `commitments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `label` varchar(160) NOT NULL,
  `group_name` varchar(60) DEFAULT NULL,
  `type` varchar(16) NOT NULL DEFAULT 'abonnement',
  `status` varchar(16) NOT NULL DEFAULT 'actif',
  `monthly` decimal(12,2) DEFAULT NULL,
  `annual` decimal(12,2) DEFAULT NULL,
  `category_id` varchar(16) DEFAULT NULL,
  `match_pattern` varchar(120) DEFAULT NULL,
  `property_id` varchar(32) DEFAULT NULL,
  `provider` varchar(120) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `renewal_date` date DEFAULT NULL,
  `notice_days` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'manuel',
  `source_ref` varchar(191) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `label_regex` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commitments_source_ref` (`source_ref`),
  KEY `idx_commitments_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table crypto_events
CREATE TABLE `crypto_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `title` varchar(255) NOT NULL,
  `asset` varchar(120) DEFAULT NULL,
  `type` varchar(40) DEFAULT NULL,
  `platform` varchar(60) DEFAULT NULL,
  `quantity` decimal(30,10) DEFAULT NULL,
  `value` decimal(14,2) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `source_ref` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crypto_events_ref` (`source_ref`),
  KEY `fk_crypto_events_owner` (`owner_user_id`),
  KEY `idx_crypto_events_date` (`date`),
  CONSTRAINT `fk_crypto_events_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table crypto_positions
CREATE TABLE `crypto_positions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) NOT NULL,
  `symbol` varchar(24) NOT NULL,
  `name` varchar(80) NOT NULL,
  `coingecko_id` varchar(80) DEFAULT NULL,
  `quantity` decimal(30,10) NOT NULL DEFAULT 0.0000000000,
  `manual_value` decimal(14,2) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `updated_at` date DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `source` varchar(16) NOT NULL DEFAULT 'manuel',
  `line_key` varchar(160) NOT NULL DEFAULT '',
  `portfolio_id` varchar(96) DEFAULT NULL,
  `coinstats_id` varchar(120) DEFAULT NULL,
  `synced_at` datetime DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  `archived_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crypto_line` (`owner_user_id`,`source`,`line_key`),
  KEY `idx_crypto_portfolio` (`portfolio_id`),
  CONSTRAINT `fk_crypto_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table crypto_sources
CREATE TABLE `crypto_sources` (
  `portfolio_id` varchar(96) NOT NULL,
  `owner_user_id` int(11) NOT NULL,
  `parent_id` varchar(96) DEFAULT NULL,
  `name` varchar(160) NOT NULL,
  `type` varchar(16) NOT NULL,
  `enabled` tinyint(4) NOT NULL DEFAULT 1,
  `status` varchar(16) NOT NULL DEFAULT 'ok',
  `lines` int(11) NOT NULL DEFAULT 0,
  `last_total_eur` decimal(14,2) DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `replaces_id` varchar(96) DEFAULT NULL,
  PRIMARY KEY (`portfolio_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table crypto_sync_runs
CREATE TABLE `crypto_sync_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `finished_at` datetime DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'running',
  `trigger` varchar(16) NOT NULL,
  `sources` int(11) NOT NULL DEFAULT 0,
  `lines` int(11) NOT NULL DEFAULT 0,
  `total_eur` decimal(14,2) DEFAULT NULL,
  `credits_used` int(11) DEFAULT NULL,
  `error` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table custom_brands
CREATE TABLE `custom_brands` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `pattern` varchar(120) NOT NULL,
  `domain` varchar(120) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_custom_brands_pattern` (`pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table data_translations
CREATE TABLE `data_translations` (
  `source` varchar(191) NOT NULL,
  `lang` varchar(5) NOT NULL,
  `text` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`source`,`lang`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- § table documents
CREATE TABLE `documents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `kind` varchar(24) NOT NULL DEFAULT 'autre',
  `domain` varchar(16) NOT NULL DEFAULT 'autre',
  `entity_type` varchar(16) DEFAULT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `doc_date` date DEFAULT NULL,
  `expires_at` date DEFAULT NULL,
  `summary` text DEFAULT NULL,
  `facts` text DEFAULT NULL,
  `content_text` mediumtext DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_mime` varchar(80) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `file_sha256` char(64) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'appli',
  `source_ref` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `topic` varchar(24) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documents_file` (`file_sha256`),
  UNIQUE KEY `uq_documents_source_ref` (`source_ref`),
  KEY `fk_documents_owner` (`owner_user_id`),
  KEY `idx_documents_domain` (`domain`,`doc_date`),
  KEY `idx_documents_entity` (`entity_type`,`entity_id`),
  KEY `idx_documents_expires` (`expires_at`),
  KEY `idx_documents_topic` (`topic`),
  FULLTEXT KEY `ft_documents` (`title`,`summary`,`content_text`),
  CONSTRAINT `fk_documents_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table document_files
CREATE TABLE `document_files` (
  `document_id` int(11) NOT NULL,
  `content` longblob NOT NULL,
  PRIMARY KEY (`document_id`),
  CONSTRAINT `fk_document_files_doc` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table enrollment_tokens
CREATE TABLE `enrollment_tokens` (
  `token_hash` char(64) NOT NULL,
  `user_id` int(11) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`token_hash`),
  KEY `fk_enroll_user` (`user_id`),
  CONSTRAINT `fk_enroll_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table envelopes
CREATE TABLE `envelopes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `scope` varchar(12) NOT NULL DEFAULT 'poste',
  `ref` varchar(120) NOT NULL,
  `monthly` decimal(12,2) NOT NULL,
  `alert_pct` int(11) NOT NULL DEFAULT 80,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table facts
CREATE TABLE `facts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `entity_type` varchar(16) NOT NULL,
  `entity_id` varchar(64) NOT NULL,
  `fact_key` varchar(60) NOT NULL,
  `label` varchar(160) NOT NULL,
  `value` varchar(500) NOT NULL,
  `unit` varchar(24) DEFAULT NULL,
  `as_of` date DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_facts` (`entity_type`,`entity_id`,`fact_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table fx_rates
CREATE TABLE `fx_rates` (
  `date` date NOT NULL,
  `currency` char(3) NOT NULL,
  `rate` decimal(18,8) NOT NULL,
  PRIMARY KEY (`currency`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table goals
CREATE TABLE `goals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `emoji` varchar(16) DEFAULT NULL,
  `target` decimal(14,2) NOT NULL,
  `target_date` date DEFAULT NULL,
  `asset_id` int(11) DEFAULT NULL,
  `current_manual` decimal(14,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'actif',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table import_batches
CREATE TABLE `import_batches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(160) NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'ouvert',
  `source` varchar(12) NOT NULL DEFAULT 'ecran',
  `cost_cap_eur` decimal(8,2) NOT NULL DEFAULT 5.00,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_import_batches_user` (`user_id`,`created_at`),
  CONSTRAINT `fk_import_batches_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table import_items
CREATE TABLE `import_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` int(11) NOT NULL,
  `rel_path` varchar(500) NOT NULL,
  `file_size` int(11) NOT NULL DEFAULT 0,
  `file_mime` varchar(80) DEFAULT NULL,
  `file_sha256` char(64) DEFAULT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'envoi',
  `extractor` varchar(24) DEFAULT NULL,
  `document_id` int(11) DEFAULT NULL,
  `invoice_id` int(11) DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `proposal` mediumtext DEFAULT NULL,
  `edits` mediumtext DEFAULT NULL,
  `checks` text DEFAULT NULL,
  `existing` text DEFAULT NULL,
  `confidence` varchar(8) DEFAULT NULL,
  `result` mediumtext DEFAULT NULL,
  `error` text DEFAULT NULL,
  `cost_eur` decimal(10,4) NOT NULL DEFAULT 0.0000,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `part` varchar(160) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_import_items_batch` (`batch_id`,`status`),
  KEY `idx_import_items_status` (`status`),
  CONSTRAINT `fk_import_items_batch` FOREIGN KEY (`batch_id`) REFERENCES `import_batches` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table income_sources
CREATE TABLE `income_sources` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `person` varchar(16) NOT NULL,
  `label` varchar(160) NOT NULL,
  `kind` varchar(16) NOT NULL DEFAULT 'autre',
  `monthly` decimal(12,2) DEFAULT NULL,
  `annual_gross` decimal(14,2) DEFAULT NULL,
  `valid_from` date DEFAULT NULL,
  `valid_to` date DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `source_ref` varchar(191) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_income_source_ref` (`source_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table invoices
CREATE TABLE `invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `merchant` varchar(120) NOT NULL,
  `title` varchar(255) NOT NULL,
  `invoice_date` date DEFAULT NULL,
  `order_ref` varchar(80) DEFAULT NULL,
  `invoice_number` varchar(80) DEFAULT NULL,
  `total` decimal(12,2) DEFAULT NULL,
  `currency` char(3) NOT NULL DEFAULT 'EUR',
  `warranty_until` date DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'appli',
  `source_ref` varchar(160) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_mime` varchar(80) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `file_sha256` char(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `no_match` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_source_ref` (`source_ref`),
  UNIQUE KEY `uq_invoices_file` (`file_sha256`),
  KEY `idx_invoices_date` (`invoice_date`),
  KEY `idx_invoices_merchant` (`merchant`),
  KEY `fk_invoices_owner` (`owner_user_id`),
  CONSTRAINT `fk_invoices_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table invoice_files
CREATE TABLE `invoice_files` (
  `invoice_id` int(11) NOT NULL,
  `content` longblob NOT NULL,
  PRIMARY KEY (`invoice_id`),
  CONSTRAINT `fk_invoice_files` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table invoice_items
CREATE TABLE `invoice_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoice_id` int(11) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `label` varchar(512) NOT NULL,
  `quantity` decimal(10,3) NOT NULL DEFAULT 1.000,
  `amount` decimal(12,2) DEFAULT NULL,
  `category_id` varchar(16) DEFAULT NULL,
  `ref` varchar(64) DEFAULT NULL,
  `url` varchar(512) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_items_invoice` (`invoice_id`,`position`),
  CONSTRAINT `fk_items_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table invoice_transactions
CREATE TABLE `invoice_transactions` (
  `invoice_id` int(11) NOT NULL,
  `transaction_id` varchar(160) NOT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'manuel',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`invoice_id`,`transaction_id`),
  KEY `idx_invoice_tx` (`transaction_id`),
  CONSTRAINT `fk_invtx_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_invtx_tx` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table loans
CREATE TABLE `loans` (
  `id` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `property` varchar(60) NOT NULL,
  `bank` varchar(120) NOT NULL,
  `reference` varchar(60) DEFAULT NULL,
  `type` varchar(32) NOT NULL,
  `principal` decimal(14,2) NOT NULL,
  `disbursed` decimal(14,2) DEFAULT NULL,
  `rate` decimal(7,4) NOT NULL,
  `duration_months` int(11) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `owner_user_id` int(11) DEFAULT NULL,
  `share` decimal(5,4) NOT NULL DEFAULT 1.0000,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table loan_schedule
CREATE TABLE `loan_schedule` (
  `loan_id` varchar(32) NOT NULL,
  `rang` int(11) NOT NULL,
  `date` date NOT NULL,
  `payment` decimal(14,2) NOT NULL DEFAULT 0.00,
  `principal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `interest` decimal(14,2) NOT NULL DEFAULT 0.00,
  `insurance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `deferred_interest` decimal(14,2) NOT NULL DEFAULT 0.00,
  `remaining` decimal(14,2) NOT NULL,
  PRIMARY KEY (`loan_id`,`rang`),
  KEY `idx_schedule_date` (`loan_id`,`date`),
  CONSTRAINT `fk_schedule_loan` FOREIGN KEY (`loan_id`) REFERENCES `loans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table logos
CREATE TABLE `logos` (
  `key` varchar(150) NOT NULL,
  `mime` varchar(40) DEFAULT NULL,
  `data` longblob DEFAULT NULL,
  `source` varchar(255) DEFAULT NULL,
  `status` varchar(8) NOT NULL DEFAULT 'ok',
  `fetched_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table notifications_sent
CREATE TABLE `notifications_sent` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `key` varchar(191) NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `body` varchar(400) DEFAULT NULL,
  `url` varchar(200) DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notif_key` (`user_id`,`key`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table oauth_clients
CREATE TABLE `oauth_clients` (
  `client_id` varchar(255) NOT NULL,
  `name` varchar(120) NOT NULL,
  `redirect_uris` text NOT NULL,
  `source` varchar(8) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `fetched_at` datetime DEFAULT NULL,
  PRIMARY KEY (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table oauth_codes
CREATE TABLE `oauth_codes` (
  `code_hash` char(64) NOT NULL,
  `client_id` varchar(255) NOT NULL,
  `user_id` int(11) NOT NULL,
  `redirect_uri` varchar(512) NOT NULL,
  `code_challenge` varchar(64) NOT NULL,
  `scope` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `grant_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`code_hash`),
  KEY `fk_oauth_codes_user` (`user_id`),
  CONSTRAINT `fk_oauth_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table oauth_grants
CREATE TABLE `oauth_grants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `client_id` varchar(255) NOT NULL,
  `client_name` varchar(120) NOT NULL,
  `scope` varchar(255) NOT NULL,
  `access_hash` char(64) NOT NULL,
  `access_expires_at` datetime NOT NULL,
  `refresh_hash` char(64) NOT NULL,
  `prev_refresh_hash` char(64) DEFAULT NULL,
  `refresh_expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_used_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oauth_grants_access` (`access_hash`),
  UNIQUE KEY `uq_oauth_grants_refresh` (`refresh_hash`),
  KEY `fk_oauth_grants_user` (`user_id`),
  KEY `idx_oauth_grants_prev` (`prev_refresh_hash`),
  CONSTRAINT `fk_oauth_grants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table oauth_requests
CREATE TABLE `oauth_requests` (
  `id_hash` char(64) NOT NULL,
  `client_id` varchar(255) NOT NULL,
  `redirect_uri` varchar(512) NOT NULL,
  `state` text DEFAULT NULL,
  `code_challenge` varchar(64) NOT NULL,
  `scope` varchar(255) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table passkeys
CREATE TABLE `passkeys` (
  `id` varchar(512) NOT NULL,
  `id_hash` char(64) NOT NULL,
  `user_id` int(11) NOT NULL,
  `public_key` blob NOT NULL,
  `counter` bigint(20) NOT NULL DEFAULT 0,
  `transports` varchar(255) DEFAULT NULL,
  `device_name` varchar(120) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_used_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id_hash`),
  KEY `fk_passkeys_user` (`user_id`),
  CONSTRAINT `fk_passkeys_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table payslips
CREATE TABLE `payslips` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) NOT NULL,
  `employer` varchar(120) NOT NULL,
  `period` varchar(7) NOT NULL,
  `pay_date` date DEFAULT NULL,
  `gross` decimal(12,2) DEFAULT NULL,
  `net_before_tax` decimal(12,2) DEFAULT NULL,
  `net_taxable` decimal(12,2) DEFAULT NULL,
  `income_tax` decimal(12,2) DEFAULT NULL,
  `tax_rate` decimal(5,2) DEFAULT NULL,
  `net_paid` decimal(12,2) DEFAULT NULL,
  `bonus` decimal(12,2) DEFAULT NULL,
  `employer_cost` decimal(12,2) DEFAULT NULL,
  `ytd_net_taxable` decimal(12,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `document_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payslips` (`owner_user_id`,`employer`,`period`),
  KEY `idx_payslips_period` (`period`),
  CONSTRAINT `fk_payslips_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table prices
CREATE TABLE `prices` (
  `id` varchar(96) NOT NULL,
  `price_eur` decimal(24,10) NOT NULL,
  `change_24h` decimal(10,4) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table projections
CREATE TABLE `projections` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) DEFAULT NULL,
  `scenario` varchar(16) NOT NULL,
  `horizon_year` int(11) NOT NULL,
  `poche` varchar(60) NOT NULL,
  `value` decimal(14,2) DEFAULT NULL,
  `hypothesis` text DEFAULT NULL,
  `as_of` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projection` (`owner_user_id`,`scenario`,`horizon_year`,`poche`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table properties
CREATE TABLE `properties` (
  `id` varchar(32) NOT NULL,
  `owner_user_id` int(11) DEFAULT NULL,
  `name` varchar(160) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `city` varchar(120) DEFAULT NULL,
  `surface` decimal(8,2) DEFAULT NULL,
  `rooms` int(11) DEFAULT NULL,
  `acquisition_date` date DEFAULT NULL,
  `acquisition_price` decimal(14,2) DEFAULT NULL,
  `acquisition_costs` decimal(14,2) DEFAULT NULL,
  `rent_monthly` decimal(12,2) DEFAULT NULL,
  `charges_monthly` decimal(12,2) DEFAULT NULL,
  `deposit` decimal(12,2) DEFAULT NULL,
  `lease_kind` varchar(24) DEFAULT NULL,
  `lease_start` date DEFAULT NULL,
  `next_rent_revision` date DEFAULT NULL,
  `tax_regime` varchar(40) DEFAULT NULL,
  `asset_id` int(11) DEFAULT NULL,
  `loan_ids` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table property_taxes
CREATE TABLE `property_taxes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `year` int(11) NOT NULL,
  `property_id` varchar(32) NOT NULL,
  `base` decimal(12,2) DEFAULT NULL,
  `contributions` decimal(12,2) DEFAULT NULL,
  `teom` decimal(12,2) DEFAULT NULL,
  `fees` decimal(12,2) DEFAULT NULL,
  `total` decimal(12,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `document_id` int(11) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_property_taxes` (`year`,`property_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table push_subscriptions
CREATE TABLE `push_subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `endpoint` varchar(600) NOT NULL,
  `endpoint_hash` varchar(64) NOT NULL,
  `p256dh` varchar(200) NOT NULL,
  `auth` varchar(100) NOT NULL,
  `device` varchar(120) DEFAULT NULL,
  `prefs` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_push_endpoint` (`endpoint_hash`),
  KEY `fk_push_user` (`user_id`),
  CONSTRAINT `fk_push_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table retirement_simulations
CREATE TABLE `retirement_simulations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `owner_user_id` int(11) NOT NULL,
  `simulated_on` date NOT NULL,
  `label` varchar(160) NOT NULL,
  `age` decimal(5,2) DEFAULT NULL,
  `quarters` int(11) DEFAULT NULL,
  `base_pension` decimal(10,2) DEFAULT NULL,
  `complementary` decimal(10,2) DEFAULT NULL,
  `gross_monthly` decimal(10,2) DEFAULT NULL,
  `net_monthly` decimal(10,2) DEFAULT NULL,
  `adjustment` varchar(120) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'info-retraite',
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_retirement_sim` (`owner_user_id`,`simulated_on`,`label`),
  CONSTRAINT `fk_retirement_sim_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table rules
CREATE TABLE `rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pattern` varchar(255) NOT NULL,
  `category_id` varchar(16) NOT NULL,
  `priority` int(11) NOT NULL DEFAULT 100,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rules_pattern` (`pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table sessions
CREATE TABLE `sessions` (
  `token_hash` char(64) NOT NULL,
  `user_id` int(11) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `user_agent` varchar(255) DEFAULT NULL,
  `demo` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`token_hash`),
  KEY `fk_sessions_user` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table sync_runs
CREATE TABLE `sync_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `finished_at` datetime DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'running',
  `source` varchar(16) NOT NULL,
  `window_start` date DEFAULT NULL,
  `tx_seen` int(11) NOT NULL DEFAULT 0,
  `tx_new` int(11) NOT NULL DEFAULT 0,
  `tx_auto` int(11) NOT NULL DEFAULT 0,
  `error` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table tax_returns
CREATE TABLE `tax_returns` (
  `income_year` int(11) NOT NULL,
  `owner_user_id` int(11) NOT NULL DEFAULT 0,
  `notice_year` int(11) DEFAULT NULL,
  `parts` decimal(4,2) DEFAULT NULL,
  `situation` varchar(40) DEFAULT NULL,
  `other_income` decimal(12,2) DEFAULT NULL,
  `taxable_income` decimal(12,2) DEFAULT NULL,
  `rfr` decimal(12,2) DEFAULT NULL,
  `net_tax` decimal(12,2) DEFAULT NULL,
  `social_levies` decimal(12,2) DEFAULT NULL,
  `total` decimal(12,2) DEFAULT NULL,
  `decote` decimal(12,2) DEFAULT NULL,
  `credits` decimal(12,2) DEFAULT NULL,
  `balance` decimal(12,2) DEFAULT NULL,
  `tmi` decimal(5,2) DEFAULT NULL,
  `avg_rate` decimal(5,2) DEFAULT NULL,
  `credits_detail` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `document_id` int(11) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`income_year`,`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table tax_return_salaries
CREATE TABLE `tax_return_salaries` (
  `income_year` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`income_year`,`user_id`),
  KEY `fk_tax_salaries_user` (`user_id`),
  CONSTRAINT `fk_tax_salaries_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table transactions
CREATE TABLE `transactions` (
  `id` varchar(160) NOT NULL,
  `finta_id` char(36) DEFAULT NULL,
  `account_id` varchar(64) NOT NULL,
  `date` date NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `label` varchar(512) NOT NULL,
  `merchant` varchar(255) DEFAULT NULL,
  `label_key` varchar(255) NOT NULL DEFAULT '',
  `status` varchar(16) NOT NULL DEFAULT 'posted',
  `category_id` varchar(16) DEFAULT NULL,
  `category_source` varchar(16) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `origin` varchar(16) NOT NULL DEFAULT 'finta',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `bank_label` varchar(255) DEFAULT NULL,
  `bank_ref` varchar(160) DEFAULT NULL,
  `original_amount` decimal(14,2) DEFAULT NULL,
  `original_currency` char(3) DEFAULT NULL,
  `purchase_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tx_finta` (`finta_id`),
  UNIQUE KEY `uq_tx_bank_ref` (`bank_ref`),
  KEY `idx_tx_date` (`date`),
  KEY `idx_tx_account_date` (`account_id`,`date`),
  KEY `idx_tx_category` (`category_id`),
  KEY `idx_tx_label_key` (`label_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table transaction_splits
CREATE TABLE `transaction_splits` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(160) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `amount` decimal(14,2) NOT NULL,
  `category_id` varchar(16) DEFAULT NULL,
  `label` varchar(255) DEFAULT NULL,
  `invoice_item_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_splits_tx` (`transaction_id`,`position`),
  KEY `fk_splits_item` (`invoice_item_id`),
  CONSTRAINT `fk_splits_item` FOREIGN KEY (`invoice_item_id`) REFERENCES `invoice_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_splits_tx` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table users
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `language` varchar(5) DEFAULT NULL,
  `role` varchar(16) NOT NULL DEFAULT 'membre',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § table wealth_snapshots
CREATE TABLE `wealth_snapshots` (
  `user_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `gross` decimal(14,2) NOT NULL,
  `debts` decimal(14,2) NOT NULL,
  `net` decimal(14,2) NOT NULL,
  `breakdown` text DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'auto',
  PRIMARY KEY (`user_id`,`date`),
  CONSTRAINT `fk_snap_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- § vue tx_lines
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `tx_lines` AS select `t`.`id` AS `id`,`t`.`account_id` AS `account_id`,if(`k`.`value` = 'achat',coalesce(`t`.`purchase_date`,`t`.`date`),`t`.`date`) AS `date`,`t`.`amount` AS `amount`,`t`.`category_id` AS `category_id`,`t`.`status` AS `status`,0 AS `split_id` from (`transactions` `t` left join `app_kv` `k` on(`k`.`key` = 'stats:date_basis')) where not exists(select 1 from `transaction_splits` `s` where `s`.`transaction_id` = `t`.`id` limit 1) union all select `t`.`id` AS `id`,`t`.`account_id` AS `account_id`,if(`k`.`value` = 'achat',coalesce(`t`.`purchase_date`,`t`.`date`),`t`.`date`) AS `date`,`s`.`amount` AS `amount`,`s`.`category_id` AS `category_id`,`t`.`status` AS `status`,`s`.`id` AS `split_id` from ((`transaction_splits` `s` join `transactions` `t` on(`t`.`id` = `s`.`transaction_id`)) left join `app_kv` `k` on(`k`.`key` = 'stats:date_basis'));
