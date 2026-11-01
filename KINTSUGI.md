# Kintsugi

Kintsugi is the Japanese art of mending broken pottery with gold, so the repair becomes part of the object's history instead of something hidden.

This file is the same idea for code. Every fix here leaves a seam in three places, all carrying the same gold line:

- a short `kintsugi:` comment at the repair site, where the file format allows one (a lockfile or `package.json` can't carry comments; there the trailer and the ledger row carry the seam);
- a `Kintsugi:` trailer on the commit;
- an entry in this append-only ledger.

The seam shows the break; it doesn't hide it. Security fixes describe what kind of thing was mended, never how to exploit it.

A repair is entered as "review pending". The reviewer is recorded only after the review has happened, in a later commit that names the verdict and the commit it reviewed, so this ledger never claims a review before it exists.

| Date | What broke | How it was mended | Mended by / reviewed by | Gold line |
|---|---|---|---|---|
| 2026-11-01 | The development toolchain (a Wrangler resolved from `^4.0.0` through `package-lock.json`) carried 27 open Dependabot alerts, 12 of them high, in undici, sharp, ws and esbuild. The deployed Worker imports no npm packages, so it was never exposed. | Wrangler pinned to 4.153.0, the oldest release whose Miniflare ships the patched undici 7.30.1. `bun.lock` replaces `package-lock.json`. `bun audit`: 0; `tsc` clean; dry-run deploy builds. | Margin / CeeCee via Codex AUDIT of 3749ff4: dependency side clean; one process finding (this file's own comment rule), fixed in the next commit | *The workbench was older than the work and had grown soft where no one looked; it is renewed now, and the dog's name on the door stays exactly as it was, in gold.* |
