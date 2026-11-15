# Source property tests

Run from the repository root with Node 26 after `npm ci` and `npm ci --prefix import --ignore-scripts`:

```sh
node v2/proptest/run.ts --target parse --seed 1794696020 --count 100000 --minutes 30 --max-bytes 4096
```

Targets are `parse`, `render`, `format`, `diagnostics`, `extensions`, `decode`, `cli`, `lint`, `migrate`, and `import`. Four input families are mixed: random Unicode or decoded bytes, corpus mutations, grammar shapes, and dictionary splices. The checked-in `corpus/` seeds Unicode, container, tab, and link shapes; the runner also reads the specification examples and every repository `.crv`. `--corpus DIR` adds `.crv` files to the corpus. The runner stops at the case limit or the minute limit, whichever comes first. It prints each finding, writes a minimized `.crv` input and JSON sidecar under `findings/TARGET/` (hashing the finding signature and logical input), and exits with status 1 if any finding occurred. The sidecar records the finding kind, case seed, run seed, and engine commit. Reduction has a 20-second limit per input; `minimizationTimedOut` identifies any case that needs further reduction. The format summary counts reported writer losses and refusals separately from findings. `inputJson` preserves UTF-16 surrogate halves that a UTF-8 source file cannot encode.

Reproduce a finding, including its original case seed and any surrogate halves, with:

```sh
node v2/proptest/run.ts --target parse --seed 0 --count 0 --replay v2/proptest/findings/parse/HASH.crv
```

Without a sidecar, `--replay` reads the `.crv` file directly. Run `npm run test:proptest:v2` to replay the curated regression corpus. A matching known finding is marked as an expected failure; a fixed case becomes a passing test automatically, and a different failure fails the suite.

To add a target, add its name to `Target` and `TARGETS` in `targets.ts`, implement a pure check function returning a finding or `null`, add a dispatch arm, and add it to the CI loop. Keep random choices on the passed seeded generator. The four source generators live in `generate.ts`.

A ten-minute coverage sample can be run with `npx c8 --all --reporter=text --reporter=json --reporter=json-summary --include='v2/src/**/*.ts' --reports-dir=v2/proptest/coverage --temp-directory=v2/proptest/.nyc_output node v2/proptest/coverage.ts 10`. The coverage driver allocates equal time to each target and stores target logs under `coverage-logs/`.
