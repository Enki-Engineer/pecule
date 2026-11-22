CREATE TABLE `transfer_peers` (
	`transaction_id` varchar(160) NOT NULL,
	`peer_account_id` varchar(64) NOT NULL,
	CONSTRAINT `transfer_peers_transaction_id` PRIMARY KEY(`transaction_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_peer_account` ON `transfer_peers` (`peer_account_id`);