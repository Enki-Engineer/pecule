ALTER TABLE `documents` ADD `topic` varchar(24);--> statement-breakpoint
CREATE INDEX `idx_documents_topic` ON `documents` (`topic`);