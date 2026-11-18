-- Une déclaration d'impôt appartient au foyer (imposition commune, `owner_user_id` = 0) ou à un membre (imposition
-- séparée) : la clé passe de l'année de revenus seule à l'année et son déclarant. Les lignes en place gardent 0 :
-- rien ne change tant qu'un membre ne dit pas qu'une déclaration est la sienne.
-- La clé étrangère des salaires déclarés visait l'année seule, qui n'est plus unique : elle est retirée d'abord.
-- Le changement de clé tient en une instruction : rejouée après un démarrage coupé, elle redonne la même clé.
ALTER TABLE `tax_return_salaries` DROP FOREIGN KEY `fk_tax_salaries_return`;
--> statement-breakpoint
ALTER TABLE `tax_returns` ADD `owner_user_id` int DEFAULT 0 NOT NULL AFTER `income_year`;
--> statement-breakpoint
ALTER TABLE `tax_returns` DROP PRIMARY KEY, ADD PRIMARY KEY(`income_year`,`owner_user_id`);
