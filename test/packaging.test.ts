import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'

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

  it('claims both extensions, so no overrides block is needed', async () => {
    const plugin = (await import('../src/prettier.js')) as { languages: { extensions: string[] }[] }

    expect(plugin.languages[0]?.extensions).toEqual(['.crv', '.carve'])
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

  it('matches both file extensions', () => {
    for (const hook of hooks) {
      expect('doc.crv').toMatch(new RegExp(hook.files))
      expect('doc.carve').toMatch(new RegExp(hook.files))
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
})
