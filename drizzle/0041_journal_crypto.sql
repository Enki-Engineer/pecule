ALTER TABLE `crypto_events` DROP INDEX `uq_crypto_events_ref`;--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `end_date` date;--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `portfolio_id` varchar(96);--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `price` decimal(24,10);--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `fee` decimal(14,2);--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `status` varchar(12) DEFAULT 'fait' NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `origin` varchar(12) DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_events` ADD CONSTRAINT `uq_crypto_events_ref` UNIQUE(`owner_user_id`,`source_ref`);--> statement-breakpoint
-- Les genres écrits en toutes lettres par une reprise (« Dépôt fiat », « Staking — sortie ») deviennent ceux de la
-- liste fermée (src/lib/crypto-events.ts) ; un texte inconnu est gardé tel quel. Rejouable : un genre déjà rangé
-- se retrouve lui-même. Les lettres accentuées sont lues par « _ », quelle que soit la collation de la table.
UPDATE `crypto_events` SET `type` = CASE
  WHEN `type` LIKE 'staking%sortie%' THEN 'fin-staking'
  WHEN `type` LIKE 'staking%r_compense%' THEN 'recompense'
  WHEN `type` LIKE 'staking%' THEN 'staking'
  WHEN `type` LIKE 'd_p_t%' THEN 'depot'
  WHEN `type` LIKE 'retrait%' THEN 'retrait'
  WHEN `type` LIKE 'int_r_t%' THEN 'interets'
  WHEN `type` LIKE 'mining%' OR `type` LIKE 'minage%' THEN 'minage'
  WHEN `type` LIKE '_change%' THEN 'echange'
  WHEN `type` LIKE 'achat%' THEN 'achat'
  WHEN `type` LIKE 'vente%' THEN 'vente'
  WHEN `type` LIKE 'transfert%' THEN 'transfert'
  WHEN `type` LIKE 'prime%' OR `type` LIKE 'airdrop%' THEN 'prime'
  ELSE `type` END
WHERE `type` IS NOT NULL;
