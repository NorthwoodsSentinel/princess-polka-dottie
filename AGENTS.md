# AGENTS.md — princess-polka-dottie

Rules for any agent (or person) changing this repo. The shape and most of the wording come from the
`modelcontextprotocol/inspector` AGENTS.md (branch v2/main, commit d330df9617e44ec893bc1a53618662239342d433), as the
maintainer ruled on it. Where the source's way and ours differ, **the source's way stands until there is a reason to
depart**; every departure below says why.

`CLAUDE.md` contains only `@./AGENTS.md`. Keep one copy of these rules: two copies are strictly worse than one,
because the stale copy is indistinguishable from the live one.

## What this is

A public Cloudflare Worker with two Durable Object "overwatchers". `PatternSensor` reads a conversation window plus
optional body and brain signals and returns a pattern assessment (circling, somatic language, regulation state,
trajectory). `ContextMapper` turns an assessment into an injection recommendation (which context files, which
delivery mode) and records it as a prediction that can be scored later. `README.md` is the user-facing description.

## The AUTH_TOKEN gate (read this before touching `src/index.ts`)

`GET /` and `GET /health` are public. Every other route requires `Authorization: Bearer <AUTH_TOKEN>`, and the
worker denies everything when `AUTH_TOKEN` is unset.

- **Never weaken the gate.** No new public route, no fallback comparison, no route matched before the gate.
  Changing it is a decision made explicitly in the issue; a refactor, a lint fix or a review suggestion is never a
  reason.
- `test/index.test.ts` "auth gate" cases pin today's behavior. Add a case when the gate changes; never delete or
  loosen one.

## Project structure

- `src/index.ts` — routing, the auth gate, security headers, the `/sense` pipeline.
- `src/PatternSensor.ts`, `src/ContextMapper.ts` — the two Durable Objects.
- `src/types.ts` — shared types (no runtime code).
- `wrangler.toml` — bindings and migrations.
- `test/` — Vitest suites (`*.test.ts`) and `test/helpers/fakes.ts` (in-memory Durable Object storage, state and
  namespaces that hand out real overwatcher instances).
- `scripts/verify-gate-scope.ts` — gate tooling.

## Development setup

- `npm ci`. This repo already used npm (`package-lock.json`), which is also the source's runner; keep it.
- Tests run on Vitest with `@vitest/coverage-v8`, the source's choice.
- No Cloudflare account, secret or network is needed for any gate step.

## Issue-driven work style

- **Before starting work, find the issue.** Every change has one. Before filing a new one, search for a match:
  **never create a duplicate**.
- **`Todo` means the maintainer approved it, and only the maintainer moves an issue into `Todo`.** `Backlog` is
  filed, not approved. Start work only on an approved issue.
- **Label by type: exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question`.**
- **`Done` means the work shipped** (its PR merged) and was verified. Anything else is canceled, not done.
- **When work begins**, assign yourself, set the issue In Progress, and create the branch **in a new git worktree**,
  never by switching branches in a checkout another session may share.
- **When work is complete**, run `npm run format` then `npm run local:gate`, **sign off every commit**
  (`git commit -s`), open a PR with **the issue reference as the body's first line**, and set the issue In Review.
- **After opening a PR, run a Codex review loop** (`codex exec --sandbox read-only`), unprompted. Stop on the
  **first** clean round. **Weigh each finding against the issue the PR closes and decline scope expansion.** Two
  failed rounds in a row: stop, leave the PR open, list the findings in it. (Departure: the source uses Copilot; the
  maintainer chose Codex as the off-lineage reviewer.)
- **If new tasks are discovered during development, file issues** rather than widening the PR.
- **Pace bulk GitHub writes: 1 s between requests, never in parallel**, under 80 a minute and 500 an hour.
- **A security issue stays private until its fix is ready**; accepting or publishing an advisory is outward-facing
  and stays human-gated, never automated.
- **This repo is public. Merging is the maintainer's act**, and nothing personal goes into a commit, PR or test
  (home paths, emails, names, tokens). Tests use synthetic data only.
- **Deploys are human-gated.** `npm run deploy` is run by whoever operates an instance, into their own account.
  No agent deploys, and no workflow deploys.

### Responding to code reviews

- Judge each suggestion against the issue the PR closes. Fix defects in what the PR added; decline, with a reason,
  what expands it; file an issue for anything worth doing on its own.
- Reply in each review comment's own thread (a rollup comment does not discharge it), then post a summary in
  addition.

## Always test new or modified code

- **Every file under `src/` must clear ≥ 90 on all four dimensions (lines, statements, functions, branches), per
  file**, enforced by `vitest.config.mts` and therefore by `npm test`, `npm run local:gate` and CI. This is the
  source's bar. **Never lower the threshold to pass.**
- Measured on 2026-11-16 (statements / branches / functions / lines): `src/index.ts`, `src/PatternSensor.ts` and
  `src/ContextMapper.ts` 100 / 100 / 100 / 100. `src/types.ts` has no executable code (0 of 0, reported as 100).
  No coverage exclusions.
- Coverage exclusions, if one is ever needed, are exact paths, one per entry, each with a reason and a follow-up
  issue; never a glob that could hide a new file.
- **A genuinely-unreachable branch is annotated at the source** (`/* v8 ignore next -- <reason> */`), never waved
  through by lowering the gate.
- **A gate must show how much it checked.** `scripts/verify-gate-scope.ts` runs after the tests and fails if a
  tracked `.ts`/`.mts` file is in no tsconfig project or a `src/` file is missing from the coverage summary. Fix
  that by fixing the globs, never by excusing the file.
- Test files are `test/**/*.test.ts`; a file named otherwise is silently not run.
- A test that races is fixed with fake timers or an awaited condition, never with a longer timeout.

## Mandatory pre-push gate

- **ALWAYS run `npm run format` before committing.**
- **`npm run local:gate` is the mandatory pre-push command.** It runs every check CI runs: `format:check`, `lint`,
  `typecheck` (both tsconfig projects) and `test` (Vitest with the coverage bar, then the gate-scope check).
- There is deliberately no `ci` script (the name collides with the package-manager built-in). CI runs the four
  stages directly and never calls a `local:*` script.
- Departures, each for a stated reason: no gate lease (the gate takes seconds and binds no ports); no DCO check job
  (adding a required-check ruleset is a repository setting, the maintainer's to change); no smoke stage (there is
  no built artifact to drive without a Cloudflare account).

## Waiting on long-running work

**When you are waiting for something to finish, arm a notifier and stop. Never spend turns polling.** For state the
harness cannot observe (a CI run, a remote review), poll inside one backgrounded loop that exits when the condition
holds, at 30 s or more.

## Build output is never a gate target

**No gate (lint, format or typecheck) may read generated output.** Out of scope: `node_modules/`, `.wrangler/`,
`coverage/`, `dist/`, `package-lock.json`. Each scope states it: `globalIgnores` in `eslint.config.mjs`,
`.prettierignore`, and tsconfig `include` lists that name source directories. **When a build starts writing to a
new location, add it to the ignore lists in the same change.** Never widen an ignore to silence a finding in
first-party code. Markdown is also outside the format scope: prettier rewrites prose.

## Lint has no warning tier

**`lint` runs with `--max-warnings 0`, so a warning fails the gate exactly as an error does.** Rules: ESLint
recommended, typescript-eslint recommended, and `@typescript-eslint/no-floating-promises` at `error`.

- **Do not silence a finding to satisfy the gate.** If a rule genuinely must be waived on one line, use its inline
  disable comment **with a one-line justification**. Dropping a rule or widening an ignore to make `lint` pass is
  not a fix.

## TypeScript

- TypeScript for all code. Never `any`: narrow JSON at the boundary from `unknown`.
- No floating promises: `await` them, or `void` them with a comment saying why.
- Every new file starts with a header comment saying what it is for and why.
- A rule about what the code does is asserted at runtime in a test, not read out of the source.
