CREATE TABLE `fx_rates` (
	`date` date NOT NULL,
	`currency` char(3) NOT NULL,
	`rate` decimal(18,8) NOT NULL,
	CONSTRAINT `fx_rates_currency_date_pk` PRIMARY KEY(`currency`,`date`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance_original` decimal(14,2);--> statement-breakpoint
ALTER TABLE `transactions` ADD `original_amount` decimal(14,2);--> statement-breakpoint
ALTER TABLE `transactions` ADD `original_currency` char(3);