-- La valeur d'un mouvement crypto est dans la devise du foyer : son nom ne dit plus « euro ».
ALTER TABLE `crypto_events` CHANGE COLUMN `value_eur` `value` decimal(14,2);
