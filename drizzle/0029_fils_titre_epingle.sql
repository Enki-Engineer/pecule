ALTER TABLE `assistant_threads` ADD `title` varchar(160);--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `pinned` tinyint DEFAULT 0 NOT NULL;