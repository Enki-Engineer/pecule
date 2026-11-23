CREATE TABLE `crypto_file_moves` (
	`id` int AUTO_INCREMENT NOT NULL,
	`portfolio_id` varchar(96) NOT NULL,
	`owner_user_id` int NOT NULL,
	`at` datetime NOT NULL,
	`kind` varchar(96) NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`amount` decimal(30,10) NOT NULL,
	`row_key` char(40) NOT NULL,
	CONSTRAINT `crypto_file_moves_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crypto_file_move` UNIQUE(`portfolio_id`,`row_key`)
);
--> statement-breakpoint
ALTER TABLE `crypto_file_moves` ADD CONSTRAINT `fk_crypto_file_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;