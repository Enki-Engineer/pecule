# Contributing to Pécule

[Lire en français](CONTRIBUTING.fr.md)

Thank you for your interest. Pécule is a personal project, maintained in spare time: fixes and small improvements
are welcome; for a new feature, open an issue first to talk about it
([suggest an idea](https://github.com/Enki-Engineer/pecule/issues/new?template=idee.md)).

The code, its comments and the commit messages are written in French; issues and pull requests are welcome in French
or in English.

## Getting the project running

```sh
pnpm install
pnpm local base        # MariaDB in Docker, on 127.0.0.1:3316
pnpm local dev         # http://localhost:3210, hot reload
```

On first launch the app asks for the setup code: it is `API_TOKEN` in `.env.dev.local`.
The demo mode (Settings → Demo mode) fills the app with a fictional family.

## Before opening a pull request

```sh
pnpm lint && pnpm test && pnpm build
```

- The rules of the code are in [`CLAUDE.md`](CLAUDE.md) (they apply to humans and agents alike) and the project's
  layout is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Both are in French.
- **Every displayed text goes through `t()`**, and its translation into the four other languages is added in the same
  pull request (`pnpm i18n:manquants` lists what is missing; a test fails otherwise).
- **No real data** in the code, the tests or the examples: the demo family (Alex, Camille, Léo; Nantes, Angers) is
  used everywhere.
- A schema change comes with its migration (`pnpm db:generate --name …`) and the regenerated initial schema
  (`pnpm local base && pnpm db:initial`).
- `dependencies` only holds what the server loads at runtime; what is only needed to build the screens goes into
  `devDependencies` (the build refuses a misplaced package). A new installation step is also written into
  [`AGENTS.md`](AGENTS.md) and the skill `skills/pecule/SKILL.md` (a test reads them).
- What changes for a household or for whoever hosts the app is written in [`CHANGELOG.md`](CHANGELOG.md). Releases
  are published by the maintainers (tag `vX.Y.Z`, see "Versions et publication" in `CLAUDE.md`).

## Reporting a problem

An issue with: what you did, what you expected, what happened, and the output of `doctor`
(`docker compose exec pecule node scripts/doctor.mjs`, or `node scripts/doctor.mjs`). **Never attach real bank
data**: the demo mode almost always reproduces the problem. A security vulnerability is not reported through a public
issue: see [`SECURITY.md`](SECURITY.md).

By contributing, you agree that your contribution is published under the project's licence (AGPL-3.0-only).
