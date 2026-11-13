CREATE TABLE `custom_brands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`pattern` varchar(120) NOT NULL,
	`domain` varchar(120),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `custom_brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_custom_brands_pattern` UNIQUE(`pattern`)
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `purchase_date` date;--> statement-breakpoint
-- La colonne `date` de la vue devient le jour retenu pour les statistiques : le jour d'achat quand le foyer l'a choisi
-- (ligne « stats:date_basis » = « achat » dans app_kv), sinon le jour d'écriture de la banque, comme avant. Sans
-- cette ligne, rien ne change.
CREATE OR REPLACE VIEW `tx_lines` AS
SELECT t.id AS id, t.account_id AS account_id,
       IF(k.value = 'achat', COALESCE(t.purchase_date, t.date), t.date) AS date,
       t.amount AS amount, t.category_id AS category_id, t.status AS status, 0 AS split_id
FROM transactions t LEFT JOIN app_kv k ON k.`key` = 'stats:date_basis'
WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id LIMIT 1)
UNION ALL
SELECT t.id AS id, t.account_id AS account_id,
       IF(k.value = 'achat', COALESCE(t.purchase_date, t.date), t.date) AS date,
       s.amount AS amount, s.category_id AS category_id, t.status AS status, s.id AS split_id
FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id LEFT JOIN app_kv k ON k.`key` = 'stats:date_basis';
