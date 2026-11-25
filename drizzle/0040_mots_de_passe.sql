CREATE TABLE `passwords` (
	`user_id` int NOT NULL,
	`hash` varchar(255) NOT NULL,
	`failures` int NOT NULL DEFAULT 0,
	`locked_until` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `passwords_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `passwords` ADD CONSTRAINT `fk_passwords_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;