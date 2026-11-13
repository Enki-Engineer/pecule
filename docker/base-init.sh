#!/bin/sh
# Base du mode démo (données fictives, séparée de la vraie base), créée au premier démarrage du conteneur MariaDB.
# Elle a son propre utilisateur : une session de démo ne peut pas lire la vraie base, même par une erreur du code.
set -e
mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS pecule_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'pecule_demo'@'%' IDENTIFIED BY '${DEMO_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON pecule_demo.* TO 'pecule_demo'@'%';
FLUSH PRIVILEGES;
SQL
