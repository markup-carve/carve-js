# Contributing to carve-js

Thanks for your interest in contributing.

## Getting started

```bash
git clone --recurse-submodules https://github.com/markup-carve/carve-js.git
cd carve-js
npm install
npm test
```

If you cloned without `--recurse-submodules`, run `git submodule update --init`.
The specification lives in `spec/` as a submodule; `data/` holds the tables and
the conformance corpus copied from it at the commit `data/spec-pin.json` names.

The runtime requires Node 20 or newer. For development, use Node 22.18 or newer:
the scripts and the tools in `import/` and `upgrade/` run their TypeScript
sources directly.

## Running the tests

```bash
npm test               # vitest over test/**/*.test.ts
npm run typecheck      # the engine, proptest and 0.1 reader types, then typed lint
npm run lint           # typed lint on its own
npm run build          # the 0.1 reader into build/, the package into dist/
npm run test:cli       # the carve bin
npm run test:lint      # the linter
npm run test:migrate   # tree migration
npm --prefix upgrade test
npm --prefix import test
```

To narrow a run, name the file or the test:

```bash
npx vitest run test/corpus.test.ts
npx vitest run -t 'heading'
npm run test:watch
```

Two checks run against the built artifact, so they need `npm run build` first:

```bash
npm run test:browser   # the IIFE bundle renders identically to the ESM build
npm run test:package   # the packed package installs and its entries and bin work
```

`test:browser` loads the bundle in a Node `vm` context holding only globals a
browser also provides, so a Node builtin creeping into the entry fails there
rather than in a consumer's iframe. It runs a `--selfcheck` pass first that
builds deliberately wrong artifacts and asserts the check reports them.

The slower gates (enumerators, stress shapes, writer gates, property tests, the
AST schema cross-check) run in `.github/workflows/engine.yml`; each has an
`npm run` script of the same name.

## Writing tests

Name a test for the clause or behavior it pins, and match the surrounding style
of whichever file is closest to your change. Make the test able to fail: revert
the fix and watch it go red before you trust it.

If your change affects behavior documented under `docs/`, update that page in
the same PR.

## Project layout

`docs/development.md` has the source map.

## Spec changes

This repository implements the language; it does not define it. Syntax and
semantics live in [markup-carve/carve](https://github.com/markup-carve/carve),
and the [versioning contract](https://markup-carve.github.io/carve/versioning)
says what a release may change. If your change would alter what valid Carve
means, open the discussion there first.

Rendered output is byte-identical across implementations by design, so a change
that alters it is rarely a single-repository change. Check whether the spec pins
the behavior at all, and link any sibling PRs in
[carve-rs](https://github.com/markup-carve/carve-rs) and
[carve-php](https://github.com/markup-carve/carve-php) from your description.

CI asserts that the spec submodule pin is reachable from the matching spec
branch, which catches a pin naming a commit that no longer exists.

## Versions

`release.yml` refuses a tag that is not a plain `X.Y.Z`, and a `prepublishOnly`
script refuses `npm publish` of any other version, including one run by hand.

## Pull requests

- One logical change per PR, with a test that fails without it.
- `npm test` and `npm run typecheck` green.
- Say what behavior changed in the description. The reasoning belongs in the
  commit body.

## 0.2 engine gates

Pull requests to `next2` run `engine-smoke.yml`. It uses the same gate scripts as
`engine.yml` with smaller, seeded bounds. The bound table and the single
`full`/`smoke` switch are in `scripts/engine-gate.mjs`. To reproduce one gate,
run `node scripts/engine-gate.mjs smoke enumerate` (or replace `smoke` with
`full`). Some gates need the pinned spec checkout or import dependencies as in
the workflow.

The full gates run after each push to `next2`, nightly at 03:15 UTC, and through
manual workflow dispatch. A failed full run opens or comments on the
`next2 engine gates failing` issue with its run and failing jobs. A later green
full run closes it.
