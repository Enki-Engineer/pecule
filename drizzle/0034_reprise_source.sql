-- Ce qu'une reprise d'historique depuis un autre outil a écrit (routes d'administration « import ») portait le nom
-- d'un outil en particulier : la valeur devient « reprise », la même pour tout foyer. Aucune structure ne change ;
-- chaque instruction se rejoue sans effet. `updated_at` des opérations est gardé tel quel.
UPDATE `transactions` SET `category_source` = 'reprise', `updated_at` = `updated_at` WHERE `category_source` = 'notion';--> statement-breakpoint
UPDATE `transactions` SET `origin` = 'reprise', `updated_at` = `updated_at` WHERE `origin` = 'notion';--> statement-breakpoint
UPDATE `accounts` SET `source` = 'reprise' WHERE `source` = 'notion';--> statement-breakpoint
UPDATE `wealth_snapshots` SET `source` = 'reprise' WHERE `source` = 'notion';--> statement-breakpoint
UPDATE `documents` SET `source` = 'reprise' WHERE `source` = 'notion';--> statement-breakpoint
UPDATE `agenda_items` SET `source` = 'reprise' WHERE `source` = 'notion';--> statement-breakpoint
UPDATE `commitments` SET `source` = 'reprise' WHERE `source` = 'notion';
