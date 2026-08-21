import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'
import { parse as parseYaml } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { carveToCarve } from '../src/index.js'

/**
 * The three ways a repository runs `carve fmt` without anyone typing it: a
 * GitHub Action, a pre-commit hook, and a Prettier plugin.
 *
 * All three are configuration, which is exactly the kind of thing that rots
 * silently - a renamed CLI flag breaks the Action months later, in someone
 * else's CI, with no test here having failed. So each one is checked against
 * the CLI it drives rather than against itself.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

const PLUGIN = new URL('../dist/prettier.js', import.meta.url).pathname
const format = (source: string): Promise<string> =>
  prettier.format(source, { parser: 'carve', plugins: [PLUGIN] })

describe('prettier plugin', () => {
  it('formats a document exactly as carve fmt does', async () => {
    // The property that matters: a repository running both tools must not have
    // each one undo the other. Byte equality, including the trailing newline.
    const source = '#   Title\n\nsome text with   spaces\n\n-   a\n-   b\n'

    expect(await format(source)).toBe(carveToCarve(source))
  })

  it('is idempotent, like the formatter it delegates to', async () => {
    const once = await format('# T\n\n*   x\n')

    expect(await format(once)).toBe(once)
  })

  it('formats malformed input rather than refusing the file', async () => {
    // `carve fmt` never fails on malformed input - there is no parse error in
    // Carve, only text that means something else. A plugin that threw would
    // stop a whole Prettier run over one document.
    await expect(format('[unclosed\n\n::: never-closed\n')).resolves.toBeTypeOf('string')
  })

  it('claims the one Carve extension, so no overrides block is needed', async () => {
    // `.crv` is the only Carve extension: the spec states it and no other, and
    // `.carve` was dropped in intellij-carve 0.1.2 with an instruction to rename.
    // jekyll-carve and mkdocs-carve both assert they do NOT match `.carve`, so a
    // plugin that claimed it formatted files the rest of the ecosystem refuses to
    // render. The assertion is exact rather than a `toContain` for that reason.
    const plugin = (await import('../src/prettier.js')) as { languages: { extensions: string[] }[] }

    expect(plugin.languages[0]?.extensions).toEqual(['.crv'])
  })
})

describe('GitHub Action', () => {
  const action = parseYaml(read('action.yml')) as {
    runs: { using: string; steps: { run?: string; shell?: string }[] }
    inputs: Record<string, { default?: string }>
  }

  it('is a composite action with an install step and a check step', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.runs.steps.length).toBe(2)
    for (const step of action.runs.steps) expect(step.shell).toBe('bash')
  })

  it('runs only CLI commands this engine actually has', () => {
    // The rot this catches: a renamed flag breaks the Action in someone else's
    // CI, months later, with nothing here having failed.
    const script = action.runs.steps.map((s) => s.run ?? '').join('\n')
    const help = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8')

    for (const invocation of [
      'carve fmt --check',
      'carve lint --from-djot',
      'carve lint --portable',
      'carve lint',
    ]) {
      expect(script).toContain(invocation)
      const [, subcommand, flag] = invocation.split(' ')
      expect(help).toContain(`'${subcommand}'`)
      if (flag) expect(help).toContain(flag.replace(/^--/, ''))
    }
  })

  it('does not fail a repository that has no Carve documents yet', () => {
    const script = action.runs.steps.map((s) => s.run ?? '').join('\n')

    expect(script).toContain('nullglob')
    expect(script).toMatch(/nothing to check[\s\S]*exit 0/)
  })

  it('reports both checks in one run rather than stopping at the first', () => {
    // One push should show every problem. `set -e` plus a bare command would
    // stop at the formatting failure and hide the lint one until tomorrow.
    const script = action.runs.steps.map((s) => s.run ?? '').join('\n')

    expect(script).toContain('|| status=1')
  })
})

describe('pre-commit hooks', () => {
  const hooks = parseYaml(read('.pre-commit-hooks.yaml')) as {
    id: string
    entry: string
    language: string
    files: string
  }[]

  it('offers a reporting hook and a writing one, distinctly', () => {
    const ids = hooks.map((h) => h.id)

    expect(ids).toContain('carve-fmt')
    expect(ids).toContain('carve-fmt-write')
    expect(hooks.find((h) => h.id === 'carve-fmt')?.entry).toBe('carve fmt --check')
    expect(hooks.find((h) => h.id === 'carve-fmt-write')?.entry).toBe('carve fmt --write')
  })

  it('installs the engine from this package rather than the ambient one', () => {
    // `language: node` makes pre-commit build the hook from the pinned rev, so
    // the hook and the Action run the same engine at the same version - which
    // is the only reason pinning a rev is worth anything.
    for (const hook of hooks) expect(hook.language).toBe('node')
  })

  it('matches the one Carve extension and nothing else', () => {
    // `.crv` is the only Carve extension. `.carve` was dropped in intellij-carve
    // 0.1.2 with an instruction to rename, and jekyll-carve and mkdocs-carve each
    // assert they do not match it, so a hook that ran over `.carve` would format
    // and lint files no other tool in the org reads.
    for (const hook of hooks) {
      expect('doc.crv').toMatch(new RegExp(hook.files))
      expect('doc.carve').not.toMatch(new RegExp(hook.files))
      expect('doc.md').not.toMatch(new RegExp(hook.files))
    }
  })

  it('names only commands the CLI has', () => {
    const help = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8')

    for (const hook of hooks) {
      const [binary, subcommand] = hook.entry.split(' ')
      expect(binary).toBe('carve')
      expect(help).toContain(`'${subcommand}'`)
    }
  })
})

describe('package metadata', () => {
  const pkg = JSON.parse(read('package.json')) as {
    exports: Record<string, unknown>
    files: string[]
    bin: Record<string, string>
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
    scripts?: Record<string, string>
  }

  it('exports the prettier plugin under a stable specifier', () => {
    // What a consumer writes in .prettierrc. Renaming it is a breaking change,
    // which is easier to notice with the string pinned here.
    expect(pkg.exports['./prettier']).toEqual({
      import: './dist/prettier.js',
      types: './dist/prettier.d.ts',
    })
  })

  it('ships the Action and the hook definitions', () => {
    // Both are read from the INSTALLED package (pre-commit) or the tagged repo
    // (the Action). Leaving them out of `files` publishes a package whose
    // documented integrations are missing.
    expect(pkg.files).toContain('action.yml')
    expect(pkg.files).toContain('.pre-commit-hooks.yaml')
  })

  it('still exposes the binary both integrations invoke', () => {
    expect(pkg.bin.carve).toBeTypeOf('string')
    expect(root).toBeTypeOf('string')
  })

  it('builds dist rather than tracking it', () => {
    // A reviewer reading this checkout sees `main` and `exports` pointing into
    // `dist/`, finds a `dist/` on disk holding an older build, and concludes a
    // source-only change never reaches a consumer. It is a reasonable reading
    // and it is wrong: `dist/` is gitignored and UNTRACKED, and `prepare` -
    // which npm runs on install and before publish - rebuilds it from `src/`.
    // The stale copy on disk is a leftover of the last local build, not
    // anything this repository ships.
    //
    // Pinned because the finding is easy to reach and expensive to re-refute:
    // committing `dist/` on the strength of it would put a generated tree in
    // review diffs forever and let it drift from `src/` for real.
    const tracked = execFileSync('git', ['ls-files', 'dist'], { cwd: root, encoding: 'utf8' })

    expect(tracked).toBe('')
    expect(read('.gitignore')).toMatch(/^dist\/$/m)
    expect(pkg.scripts?.prepare).toBe('npm run build')
  })

  it('installs only the HTML5 parser at runtime', () => {
    // `carve portability` runs djot.js, and the obvious way to give it one is
    // a dependency. That would put a second markup parser in the tree of every
    // consumer, including the ones embedding this in a browser bundle, to
    // serve one subcommand. Instead the engine is injected (src/portability.ts)
    // and the CLI imports it lazily, which only works as long as this stays
    // empty.
    expect(pkg.dependencies ?? {}).toEqual({ parse5: '^7.3.0' })
  })

  it('declares djot.js as an OPTIONAL peer', () => {
    // Optional, so npm does not install it for people who never run the
    // subcommand; declared, so a project that does run it gets a version
    // warning instead of a surprise at the first parse difference.
    expect(pkg.peerDependencies?.['@djot/djot']).toBeTypeOf('string')
    expect(pkg.peerDependenciesMeta?.['@djot/djot']?.optional).toBe(true)
  })
})

describe('resolving a subpath from a consumer position', () => {
  /**
   * Everything in `package metadata` above reads this repository's own
   * manifest off disk with `readFileSync`. That answers "what does the file
   * say", which is NOT the question an `exports` map decides - the map is
   * enforced by the resolver, against an installed package, and a `readFileSync`
   * assertion on it passes just as happily with the entry deleted.
   *
   * So this block asks the resolver instead. A scratch directory gets the
   * `node_modules` layout an install produces, the package is linked into it,
   * and a real `node` reads the specifier back the way a consumer's CI step
   * would. What is under test is Node's resolution, not this file's opinion
   * of it.
   */
  let consumer: string

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), 'carve-consumer-'))
    mkdirSync(join(consumer, 'node_modules', '@markup-carve'), { recursive: true })
    symlinkSync(root, join(consumer, 'node_modules', '@markup-carve', 'carve'), 'dir')
  })

  afterAll(() => rmSync(consumer, { recursive: true, force: true }))

  const resolve = (script: string): string =>
    execFileSync('node', ['-e', script], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  // Probed with `import`, not `require`: this package is ESM-only, so `.` and
  // `./prettier` name no `require` condition and a require probe would report
  // the same ERR_PACKAGE_PATH_NOT_EXPORTED for a subpath that is wide open.
  const codeOf = (specifier: string): string =>
    resolve(
      `import(${JSON.stringify(specifier)}).then(() => console.log('RESOLVED'),` +
        ` (e) => console.log(e.code ?? String(e)))`,
    )

  it('reads the installed version back through the package specifier', () => {
    // The question a version-pinning CI step asks. Closed, it throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED, which reads as "this package is not
    // installed" rather than "this subpath is closed" - so whoever hits it
    // goes and audits their install first.
    const version = resolve(
      `console.log(require('@markup-carve/carve/package.json').version)`,
    )

    expect(version).toBe((JSON.parse(read('package.json')) as { version: string }).version)
  })

  it('reads it back under import as well as require', () => {
    // Both resolvers consult the same map, but a consumer on either side of
    // the divide should get the same answer, and only one of them is what a
    // shell one-liner in CI happens to use.
    const version = resolve(
      `import('@markup-carve/carve/package.json', { with: { type: 'json' } })` +
        `.then((m) => console.log(m.default.version))`,
    )

    expect(version).toBe((JSON.parse(read('package.json')) as { version: string }).version)
  })

  it('opens that one file and not the directory holding it', () => {
    // The failure this guards: widening the map with a wildcard, or dropping
    // it, to fix the line above. Either would publish the whole checkout as
    // importable API - `src/` included - and nothing else here would notice.
    expect(codeOf('@markup-carve/carve/tsconfig.json')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf('@markup-carve/carve/src/index.ts')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf('@markup-carve/carve/dist/index.js')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })

  it('still resolves the entry points the map already named', () => {
    expect(codeOf('@markup-carve/carve')).toBe('RESOLVED')
    expect(codeOf('@markup-carve/carve/prettier')).toBe('RESOLVED')
  })
})
