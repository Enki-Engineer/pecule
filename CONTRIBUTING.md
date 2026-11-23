# Contribuer à Pécule

Merci de votre intérêt. Pécule est un projet personnel, tenu sur du temps libre : les corrections et les petites
améliorations sont les bienvenues ; pour une fonction nouvelle, ouvrez d'abord un ticket pour en parler
([proposer une idée](https://github.com/Enki-Engineer/pecule/issues/new?template=idee.md)).

## Mettre le projet en route

```sh
pnpm install
pnpm local base        # MariaDB dans Docker, sur 127.0.0.1:3316
pnpm local dev         # http://localhost:3210, rechargement à chaud
```

Au premier lancement, l'appli demande le code d'installation : c'est `API_TOKEN` dans `.env.dev.local`.
Le mode démo (Réglages → Mode démo) remplit l'appli d'une famille fictive.

## Avant d'envoyer une demande de fusion

```sh
pnpm lint && pnpm test && pnpm build
```

- Les règles du code sont dans [`CLAUDE.md`](CLAUDE.md) (elles valent pour les humains comme pour les agents) et
  l'organisation du projet dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Tout texte affiché passe par `t()`** et sa traduction dans les quatre autres langues est ajoutée dans la même
  demande (`pnpm i18n:manquants` liste ce qui manque ; un test échoue sinon).
- **Aucune donnée réelle** dans le code, les tests ou les exemples : la famille de la démo (Alex, Camille, Léo ;
  Nantes, Angers) sert partout.
- Une modification du schéma vient avec sa migration (`pnpm db:generate --name …`) et le schéma de départ régénéré
  (`pnpm local base && pnpm db:initial`).
- `dependencies` ne porte que ce que le serveur charge en service ; ce qui sert à construire l'écran va dans
  `devDependencies` (le build refuse un paquet mal rangé). Une étape d'installation ajoutée se reporte dans
  [`AGENTS.md`](AGENTS.md) et dans la compétence `skills/pecule/SKILL.md` (un test les relit).
- Ce qui change pour un foyer ou pour celui qui héberge s'écrit dans [`CHANGELOG.md`](CHANGELOG.md). Les versions
  sont publiées par les mainteneurs (étiquette `vX.Y.Z`, voir « Versions et publication » dans `CLAUDE.md`).
- Le code, ses commentaires et les messages de commit sont en français.

## Signaler un problème

Un ticket avec : ce que vous avez fait, ce que vous attendiez, ce qui s'est passé, la sortie de `doctor`
(`docker compose exec pecule node scripts/doctor.mjs`, ou `node scripts/doctor.mjs`). **Ne joignez jamais de vraies données bancaires** : le mode démo permet presque toujours de
reproduire. Une faille de sécurité ne se signale pas par un ticket public : voir [`SECURITY.md`](SECURITY.md).

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du projet (AGPL-3.0-only).
