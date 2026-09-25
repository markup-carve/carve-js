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
The spec corpus lives in `spec/` as a submodule, and the conformance tests read
it from there.

Node 20 or newer. `engines.node` in `package.json` says `>=20`, and CI runs the
test matrix on 20 and 22, so 20 is a floor the project actually exercises rather
than an aspiration. The other CI jobs pin 22.

## Running the tests

```bash
npm test               # vitest over test/**/*.test.ts
npm run typecheck      # tsc --noEmit
npm run build          # tsc, into dist/
```

Typechecking is a gate, not a convenience: CI runs `npm run typecheck` before the
suite on both Node versions, and `npm run build` after it, so a type error fails
the run even when every test passes.

To narrow a run, name the file or the test:

```bash
npx vitest run test/corpus.test.ts
npx vitest run -t 'heading'
npm run test:watch
```

The suite is about 740 test files. `npm run test:includes` runs the
include-conformance vectors on their own; CI runs it as a step of its own after
`npm test`, so a failure there names that gate rather than the whole suite.

Two suites run against the built artifact, so they need `npm run build` first and
stay out of the everyday run:

```bash
npm run build
npm run test:browser   # the IIFE bundle renders identically to the ESM build
npm run test:mxss      # mutation-XSS check on the svg fence
```

`test:browser` loads the bundle in a Node `vm` context holding only globals a
browser also provides, so a Node builtin creeping into the entry fails there
rather than in a consumer's iframe. `test:mxss` is the one that needs a real
browser: Playwright and Chromium, which CI installs for that job alone rather than
carrying as a devDependency.

Both scripts run their own `--selfcheck` pass first: each builds a deliberately
wrong artifact and asserts the check reports it, so neither gate can pass by being
unable to fail.

### The scaling guards

`npm run test:perf` runs the wall-clock guards, with file parallelism off. They
assert asymptotics, so a reading taken while the machine is busy means nothing:
in the default run they would measure each other, which is why they are skipped
there. CI gives them a runner of their own in
`.github/workflows/scaling-guards.yml`, on pushes to `main` and nightly rather
than on the pull-request path. For a branch:

```bash
gh workflow run scaling-guards.yml -R markup-carve/carve-js --ref <branch>
```

## Conformance and the corpus

Part of the suite is driven by the shared spec corpus in `spec/`, so a spec bump
can change expectations with no local edit. `test/corpus.test.ts` runs the
mandatory corpus byte for byte and `test/optional-corpus.test.ts` the Tier-2
opt-in constructs.

A corpus category this implementation does not support yet is declared rather
than quietly absent. `IMPLEMENTED` in `test/corpus.test.ts` lists the categories
that must pass; the list is guarded from both directions, so a corpus category
missing from it fails the build and an entry naming no corpus pair fails it too.
Implementing a feature therefore means adding its category to `IMPLEMENTED` as
well as making the parser handle it.

## Writing tests

Test files are named for the behavior they pin, one sentence per file:
`test/a-blank-line-is-space-and-tab-only.test.ts`. Match that shape and the
surrounding style of whichever file is closest to your change.

Two conventions worth stating:

- **Make the test able to fail.** Revert the fix and watch it go red before you
  trust it. Several bugs across the Carve engines survived behind a check that
  structurally could not see what it was checking.
- If your change affects behavior documented under `docs/`, update that page in
  the same PR. A wrong security or migration doc is worse than a missing one.

## Project layout

```
src/
├── index.ts             # public API
├── parse.ts             # linear-time block and inline parser
├── ast.ts               # typed AST node definitions
├── render-html.ts       # canonical HTML renderer
├── render-markdown.ts   # plus render-plain.ts, render-ansi.ts, render-carve.ts
├── html-import.ts       # plus djot-import.ts, markdown-migrate.ts, bbcode-migrate.ts
├── profile.ts           # allowed constructs for untrusted input
├── includes.ts          # file inclusion; the fs resolver is in includes-fs.ts
├── source-patch.ts      # source-preserving patches
└── cli.ts               # the `carve` binary
test/                    # vitest suites plus the corpus runners
spec/                    # git submodule: markup-carve/carve
scripts/                 # the browser bundle build and the drift check
```

`docs/development.md` has the fuller source map.

## Spec changes

This repository implements the language; it does not define it. Syntax and
semantics live in [markup-carve/carve](https://github.com/markup-carve/carve)
(`resources/grammar.ebnf` plus the corpus), and the
[versioning contract](https://markup-carve.github.io/carve/versioning) says what
a release may change. If your change would alter what valid Carve means, open the
discussion there first. Language work for 0.2 is tracked in
[markup-carve/carve#1092](https://github.com/markup-carve/carve/issues/1092).

Rendered output is byte-identical across implementations by design, so a change
that alters it is rarely a single-repository change. Expect to pair it with
[carve-rs](https://github.com/markup-carve/carve-rs) and
[carve-php](https://github.com/markup-carve/carve-php), and check whether the
spec pins the behavior at all: where it does not, every implementation can agree
with the others and still be wrong together. Link the sibling PRs from your
description.

CI also asserts that the spec submodule pin is reachable from spec `main`, which
is the check that catches a pin naming a commit that no longer exists. Reachable
is all it means: a commit five hundred behind is reachable too.

## Pull requests

- One logical change per PR, with a test that fails without it.
- `npm test` and `npm run typecheck` green.
- Say what behavior changed in the description. The reasoning belongs in the
  commit body.
