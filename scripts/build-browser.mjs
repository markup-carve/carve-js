/**
 * Build the browser IIFE bundles, for consumers that load classic scripts
 * rather than ESM (CDN script tags, sandboxed iframes, userscript hosts).
 * Both expose a `carve` global:
 *
 *   dist/carve.iife.min.js         the whole public API surface of src/index.ts
 *   dist/carve.render.iife.min.js  the render core only - source in, HTML out
 *
 * The render bundle is for embedders that display carve content but never
 * author it: the linter, formatter, migrators and diff machinery treeshake
 * away, at roughly a quarter of the full bundle's size. Its export list below
 * is the profile; growing it is an API decision, not a build detail.
 *
 * The entry is deliberately `src/index.ts` unmodified: everything exported
 * there is browser-safe. Node builtins live only in `src/cli.ts` (a separate
 * entry), and `@djot/djot` is dependency-injected rather than imported (see
 * src/portability.ts), so the only bundled dependency is parse5.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const shared = {
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
}

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/carve.iife.min.js',
})

await build({
  ...shared,
  stdin: {
    contents: `export {
      parse,
      resolve,
      renderHtml,
      carveToHtml,
      SPEC_VERSION,
      LIB_VERSION,
    } from './src/index.ts'`,
    resolveDir: new URL('..', import.meta.url).pathname,
    sourcefile: 'render-entry.ts',
    loader: 'ts',
  },
  outfile: 'dist/carve.render.iife.min.js',
})
