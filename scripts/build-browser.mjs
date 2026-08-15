/**
 * Build the browser IIFE bundle, for consumers that load classic scripts
 * rather than ESM (CDN script tags, sandboxed iframes, userscript hosts).
 * It exposes the whole public API surface of `src/index.ts` as a `carve`
 * global:
 *
 *   dist/carve.iife.min.js
 *
 * The entry is deliberately `src/index.ts` unmodified: everything exported
 * there is browser-safe. Node builtins live only in `src/cli.ts` (a separate
 * entry), and `@djot/djot` is dependency-injected rather than imported (see
 * src/portability.ts), so the only bundled dependency is parse5. An entry with
 * a narrower export list would be a second public API surface, and would need
 * its own module in `src/` plus a test asserting its exports - the bundle here
 * is gated against `src/index.ts` precisely because it claims to BE it.
 *
 * esbuild is invoked as a pinned one-off through `npx`, not carried as a
 * devDependency. The spec repo installs this package as a git dependency
 * (`github:markup-carve/carve-js#<sha>`), where npm runs `prepare` and
 * therefore installs devDependencies; an entry here would download esbuild
 * plus its platform binary on every one of those installs, for a bundle that
 * install does not build. The mutation-XSS job takes the same shape with
 * playwright.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Pinned exactly: the artifact is reproducible only if the bundler is. */
export const ESBUILD_VERSION = '0.28.2'

/** The published artifact, pointed at by the `unpkg` and `jsdelivr` fields. */
export const BUNDLE = 'dist/carve.iife.min.js'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

/**
 * Run the pinned esbuild over `src/index.ts`.
 *
 * @param {object} [options]
 * @param {string} [options.outfile] Where to write, relative to the repo root.
 * @param {boolean} [options.sourcemap] Emit the sourcemap next to it.
 * @param {string[]} [options.extraArgs] Appended verbatim; the selfcheck uses
 *   this to emit a deliberately wrong artifact.
 * @returns {string} The absolute path written.
 */
export function buildBrowserBundle({ outfile = BUNDLE, sourcemap = true, extraArgs = [] } = {}) {
  const args = [
    '--yes',
    `esbuild@${ESBUILD_VERSION}`,
    'src/index.ts',
    '--bundle',
    '--format=iife',
    '--global-name=carve',
    '--minify',
    // Minified identifiers otherwise reach the consumer: `RenderDepthError`
    // becomes a one-letter class, and a host branching on `error.name` or
    // `error.constructor.name` sees something different from the ESM build.
    '--keep-names',
    // Matches the engines floor's browser contemporaries; no syntax exotic
    // enough to need anything newer.
    '--target=es2020',
    `--banner:js=/*! ${pkg.name} ${pkg.version} - ${pkg.license} - ${pkg.homepage} */`,
    `--outfile=${outfile}`,
    ...(sourcemap ? ['--sourcemap'] : []),
    ...extraArgs,
  ]

  const run = spawnSync('npx', args, { cwd: fileURLToPath(root), stdio: 'inherit' })
  if (run.status !== 0) {
    throw new Error(`esbuild@${ESBUILD_VERSION} exited with ${run.status ?? run.signal}`)
  }
  return fileURLToPath(new URL(outfile, root))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildBrowserBundle()
}
