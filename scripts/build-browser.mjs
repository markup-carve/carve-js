/**
 * Build the browser IIFE bundle: the whole public API surface of
 * `src/index.ts` under a single `carve` global, for consumers that load
 * classic scripts rather than ESM (CDN script tags, sandboxed iframes,
 * userscript hosts).
 *
 * The entry is deliberately `src/index.ts` unmodified: everything exported
 * there is browser-safe. Node builtins live only in `src/cli.ts` (a separate
 * entry), and `@djot/djot` is dependency-injected rather than imported (see
 * src/portability.ts), so the only bundled dependency is parse5.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/carve.iife.min.js',
  bundle: true,
  format: 'iife',
  globalName: 'carve',
  minify: true,
  sourcemap: true,
  // Matches the engines floor's browser contemporaries; no syntax exotic
  // enough to need anything newer.
  target: 'es2020',
  banner: {
    js: `/*! ${pkg.name} ${pkg.version} — ${pkg.license} — ${pkg.homepage} */`,
  },
})
