# Find Someone Who?

A mobile icebreaker for the Dog, Dragon and Cat groups.

- [Play on GitHub Pages](https://hallowstar.github.io/find-who/)
- [Owner dashboard](https://hallowstar.github.io/find-who/owner/)

GitHub Pages serves the player interface. The shared player API, game database and
owner dashboard run on ChatGPT Sites. The dashboard authorizes the site owner's
ChatGPT account. The Pages workflow publishes the player interface on pushes to
`main`.

Run `npm run dev` with Node 24 or later for a local game backed by an in-memory
SQLite database. Run `node scripts/build-pages.mjs` to build the Pages files into
`dist/pages`. The production Worker expects a D1 binding called `DB` and an
`OWNER_EMAIL` runtime secret. The database migration lives in `drizzle/`.
