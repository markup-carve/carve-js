import { defineConfig } from 'vitest/config'

// Limit vitest discovery to this repo's own `test/` suite.
// The vendored `spec/` submodule (markup-carve/carve) carries its own
// `node:test` runners (spec/tests/corpus.test.mjs, normativity.test.mjs)
// used by the carve repo's CI; those have no Vitest API and would fail
// here as "no test suite found" if vitest tried to load them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One module graph per worker instead of per file: re-importing the engine
    // for each of ~830 files was about 40% of the suite's CPU time.
    isolate: false,
  },
})
