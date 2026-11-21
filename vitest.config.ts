import { configDefaults, defineConfig } from 'vitest/config'

// Limit vitest discovery to this repo's own `test/` suite.
// The vendored `spec/` submodule (markup-carve/carve) carries its own
// `node:test` runners (spec/tests/corpus.test.mjs, normativity.test.mjs)
// used by the carve repo's CI; those have no Vitest API and would fail
// here as "no test suite found" if vitest tried to load them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Cases that take seconds run under `npm run test:stress`, in CI as a step of their own.
    exclude: process.env['CARVE_STRESS'] === undefined ? [...configDefaults.exclude, '**/*.stress.test.ts'] : configDefaults.exclude,
    // One module graph per worker instead of per file.
    isolate: false,
  },
})
