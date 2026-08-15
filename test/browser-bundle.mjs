// Parity gate for the published browser bundle.
//
// The bundle exists so that classic-script consumers stop hand-building their
// own copy of this library. That is only worth anything if the artifact we
// ship is the library: an unchecked bundle moves the provenance problem up one
// level instead of solving it. So this builds `dist/carve.iife.min.js` and
// asserts, against the ESM build in `dist/`, that
//
//   • the `carve` global exports exactly the names `src/index.ts` exports -
//     no name silently dropped by treeshaking or renamed by the minifier, and
//     none added;
//   • every document in the spec corpus renders byte-identically through the
//     bundle and through the ESM build, thrown errors included;
//   • the non-render surface (markdown/carve/plain/ansi writers, linter,
//     importers, diff) agrees too, since the global claims the whole API.
//
// The bundle is loaded in a `vm` context holding only globals a browser also
// provides, so a Node builtin creeping into the entry fails here rather than
// in a consumer's iframe. (esbuild's browser platform would already refuse to
// resolve one at build time; this is the second half of that.)
//
// A `--selfcheck` run builds deliberately WRONG artifacts first - one whose
// render output is perturbed, one missing an export - and asserts this check
// REPORTS each of them. A gate that cannot fail is not a gate.
//
// Run: `npm run build && npm run test:browser`. The bundler is fetched by
// `npx` at a pinned version (see scripts/build-browser.mjs); nothing is added
// to devDependencies. Exits non-zero on any mismatch.

import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { buildBrowserBundle, BUNDLE } from '../scripts/build-browser.mjs'
import * as esm from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

/**
 * Load an IIFE bundle and hand back its `carve` global.
 *
 * The context deliberately carries browser globals only. Anything the bundle
 * reaches for that is not here is undefined, exactly as it would be in a
 * sandboxed iframe.
 */
function loadBundle(file) {
  const context = vm.createContext({
    console,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
  })
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: basename(file) })
  const api = context.carve
  if (!api || typeof api !== 'object') {
    throw new Error(`${basename(file)} defined no \`carve\` global`)
  }
  return api
}

/**
 * Same call on both sides, reduced to one comparable string.
 *
 * A thrown error reduces to its class name and nothing else: the message of a
 * native TypeError quotes a local identifier, which minification renames, so
 * comparing messages would report the minifier as a divergence. `--keep-names`
 * keeps the class names themselves stable.
 */
function outcome(fn) {
  try {
    const value = fn()
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch (error) {
    return `THREW ${error?.constructor?.name ?? 'Error'}`
  }
}

/** True when the call threw - a probe that throws on BOTH sides proves nothing. */
function threw(fn) {
  return outcome(fn).startsWith('THREW ')
}

// One document exercising the writers, the linter, the importers and the diff.
// The corpus sweep below covers rendering breadth; this covers API breadth.
const PROBE = [
  '# Heading /one/',
  '',
  'Text with *bold*, `code`, a [link](https://example.com) and a ^[note].',
  '',
  '- item one',
  '- item two',
  '',
  '``` js',
  'const x = 1',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n')

const PROBES = {
  carveToHtml: (api) => api.carveToHtml(PROBE),
  renderHtml: (api) => api.renderHtml(api.resolve(api.parse(PROBE))),
  renderMarkdown: (api) => api.renderMarkdown(api.resolve(api.parse(PROBE))),
  renderCarve: (api) => api.renderCarve(api.parse(PROBE)),
  renderPlainText: (api) => api.renderPlainText(api.resolve(api.parse(PROBE))),
  renderAnsi: (api) => api.renderAnsi(api.resolve(api.parse(PROBE))),
  lintCarve: (api) => api.lintCarve(PROBE),
  markdownToCarve: (api) => api.markdownToCarve('# md\n\n**b** and _i_\n'),
  bbcodeToCarve: (api) => api.bbcodeToCarve('[b]b[/b] and [i]i[/i]'),
  htmlToCarve: (api) => api.htmlToCarve('<h1>h</h1><p><em>i</em></p>'),
  parse: (api) => api.parse(PROBE),
  toSourceLayout: (api) => api.toSourceLayout(PROBE, api.parse(PROBE)),
  diffAst: (api) => api.diffAst(api.parse(PROBE), api.parse(PROBE + '\n\nextra\n')),
  SPEC_VERSION: (api) => api.SPEC_VERSION,
  LIB_VERSION: (api) => api.LIB_VERSION,
}

/**
 * Compare one bundle against the ESM build.
 *
 * @returns {string[]} One line per divergence; empty means identical.
 */
function check(file) {
  const api = loadBundle(file)
  const failures = []

  const bundled = Object.keys(api).sort()
  const source = Object.keys(esm).sort()
  const missing = source.filter((name) => !bundled.includes(name))
  const extra = bundled.filter((name) => !source.includes(name))
  if (missing.length) failures.push(`exports missing from the bundle: ${missing.join(', ')}`)
  if (extra.length) failures.push(`exports the bundle adds: ${extra.join(', ')}`)

  for (const [name, probe] of Object.entries(PROBES)) {
    if (threw(() => probe(esm))) {
      failures.push(`api probe is not a probe, it throws against the ESM build: ${name}`)
      continue
    }
    if (outcome(() => probe(api)) !== outcome(() => probe(esm))) {
      failures.push(`api probe diverges: ${name}`)
    }
  }

  const documents = readdirSync(corpusDir)
    .filter((name) => name.endsWith('.crv'))
    .sort()
  let diverged = 0
  for (const name of documents) {
    const source = readFileSync(join(corpusDir, name), 'utf8')
    if (outcome(() => api.carveToHtml(source)) !== outcome(() => esm.carveToHtml(source))) {
      if (diverged < 5) failures.push(`corpus document renders differently: ${name}`)
      diverged += 1
    }
  }
  if (diverged > 5) failures.push(`… and ${diverged - 5} more corpus documents`)
  if (!documents.length) failures.push('the corpus held no documents to compare')

  return { failures, documents: documents.length }
}

/**
 * Emit two artifacts that are deliberately NOT the library, and require this
 * check to say so. The perturbations are build flags rather than edits to
 * `src/`, so the selfcheck can never leave the tree dirty.
 */
function selfcheck() {
  const dir = mkdtempSync(join(tmpdir(), 'carve-browser-bundle-'))
  const mutants = [
    {
      name: 'perturbed render output',
      // Appended after the IIFE assigns the global, so the artifact renders
      // something the library does not. The global's own properties are
      // getters, so each footer rebuilds it as a plain object first.
      args: ['--footer:js=carve={...carve,carveToHtml:()=>"<!--mutant-->"}'],
      expect: /corpus document renders differently|api probe diverges/,
    },
    {
      name: 'a dropped export',
      args: ['--footer:js=carve=(()=>{const c={...carve};delete c.lintCarve;return c})()'],
      expect: /exports missing from the bundle: .*lintCarve/,
    },
  ]

  let ok = true
  try {
    for (const mutant of mutants) {
      const outfile = join(dir, `${mutant.name.replace(/\W+/g, '-')}.js`)
      buildBrowserBundle({ outfile, sourcemap: false, extraArgs: mutant.args })
      const { failures } = check(outfile)
      const caught = failures.some((line) => mutant.expect.test(line))
      console.log(`selfcheck ${caught ? 'ok' : 'FAILED'}: ${mutant.name}`)
      if (!caught) {
        ok = false
        console.log(failures.length ? failures.map((l) => `  ${l}`).join('\n') : '  (reported nothing)')
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (!ok) {
    console.error('\nThe parity check did not detect a bundle that is not the library.')
    process.exit(1)
  }
  console.log('selfcheck: the parity check detects a divergent artifact.')
}

if (process.argv.includes('--selfcheck')) {
  selfcheck()
} else {
  // Verify the artifact that ships, not a copy of it built another way.
  const file = buildBrowserBundle()
  const { failures, documents } = check(file)
  if (failures.length) {
    console.error(`${BUNDLE} is not the library:\n${failures.map((l) => `  ${l}`).join('\n')}`)
    process.exit(1)
  }
  console.log(
    `${BUNDLE}: ${Object.keys(esm).length} exports, ${Object.keys(PROBES).length} api probes and ` +
      `${documents} corpus documents identical to the ESM build.`,
  )
}
