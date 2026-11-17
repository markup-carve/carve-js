import { configDefaults, defineConfig } from 'vitest/config'
// Cases that take seconds run under `npm run test:stress`, in CI as a step of their own.
const exclude = process.env['CARVE_STRESS'] === undefined ? [...configDefaults.exclude, '**/*.stress.test.ts'] : configDefaults.exclude
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude } })
