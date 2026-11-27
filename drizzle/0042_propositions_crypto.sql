CREATE TABLE `crypto_proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_user_id` int NOT NULL,
	`ref` varchar(191) NOT NULL,
	`origin` varchar(12) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'ouverte',
	`date` date NOT NULL,
	`since` date,
	`type` varchar(40) NOT NULL,
	`asset` varchar(120),
	`quantity` decimal(30,10),
	`value` decimal(14,2),
	`portfolio_id` varchar(96),
	`from_portfolio_id` varchar(96),
	`direction` varchar(4),
	`event_id` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `crypto_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crypto_proposal` UNIQUE(`owner_user_id`,`ref`)
);
--> statement-breakpoint
ALTER TABLE `crypto_events` ADD `transaction_id` varchar(160);--> statement-breakpoint
ALTER TABLE `crypto_proposals` ADD CONSTRAINT `fk_crypto_proposals_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crypto_events_tx` ON `crypto_events` (`transaction_id`);