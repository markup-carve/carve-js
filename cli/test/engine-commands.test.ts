import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXES, fixSource } from '../fix.ts'
import { parseArgs } from '../flags.ts'
import { lint } from '../../lint/lint.ts'
import { CATALOG } from '../../lint/catalog.ts'

const root = join(import.meta.dirname, '../..')
const main = join(root, 'cli/main.ts')
const dirs: string[] = []

function temp(files: Record<string, string>): string {
  const path = mkdtempSync(join(tmpdir(), 'carve-engine-'))
  dirs.push(path)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text)
  return path
}

function cli(args: string[], input = '', cwd = root): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { cwd, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('carve fix and carve lint --fix', () => {
  it('rewrites each habit to the replacement its rule documents', () => {
    const cases: [string, string][] = [
      ['a **b** c\n', 'a *b* c\n'],
      ['a ~~b~~ c\n', 'a {~b~} c\n'],
      ['a _b_ c\n', 'a /b/ c\n'],
      ['snake_case_name\n', 'snake{/case/}name\n'],
      ['x^2^ y\n', 'x{^2^} y\n'],
      ['a =b= c\n', 'a {=b=} c\n'],
      ['+ one\n+ two\n', '- one\n- two\n'],
      ['# Title ##  \n', '# Title\n'],
      ['a\n\n---\n', 'a\n\n***\n'],
      ['**a ~~b~~ c**\n', '*a {~b~} c*\n'],
      ['> - **ä😀**\n', '> - *ä😀*\n'],
    ]
    for (const [input, output] of cases) expect(fixSource(input, {}).output, JSON.stringify(input)).toBe(output)
  })

  it('leaves a range that two rules would rewrite differently, and a fix that would not hold', () => {
    // djot-subscript-tilde reads `~t~` as subscript, deprecated-bare-strike as strike.
    expect(fixSource('a ~t~ b\n', {}).output).toBe('a ~t~ b\n')
    expect(fixSource('a ~t~ b\n', { rules: { 'djot-subscript-tilde': 'off' } }).output).toBe('a {~t~} b\n')
    // A `-` line directly below text opens no list, so the `+` stays.
    expect(fixSource('x\n+ y\n', {}).output).toBe('x\n+ y\n')
    expect(fixSource('a **b** c\n', { rules: { 'markdown-strong-double-star': 'off' } }).output).toBe('a **b** c\n')
  })

  it('every fixable rule is in the catalog, and the fixed source no longer reports it', () => {
    for (const id of FIXES.keys()) expect(CATALOG[id], id).toBeDefined()
    const input = 'a **b** ~~c~~ _d_ x^2^ =e=\n\n+ item\n\n# T ##\n\n---\n'
    const fixed = fixSource(input, {}).output
    const left = lint(fixed, { rules: Object.fromEntries([...FIXES.keys()].map((id) => [id, 'on'])) })
    expect(left.filter((entry) => FIXES.has(entry.code as never)).map((entry) => entry.code)).toEqual([])
  })

  it('fix is lint --fix: source on standard output, remaining entries and the summary on standard error', () => {
    const result = cli(['fix'], 'a **b**\n\n# T ##\n\nx ~t~ y\n')
    expect(result.stdout).toBe('a *b*\n\n# T\n\nx ~t~ y\n')
    expect(result.stderr).toContain('<stdin>: fixed markdown-strong-double-star 1, heading-closing-hashes 1')
    expect(result.stderr).toMatch(/<stdin>:5:3: warning deprecated-bare-strike /)
    expect(result.status).toBe(1)
    expect(cli(['lint', '--fix'], 'a **b**\n').stdout).toBe('a *b*\n')
  })

  it('--write replaces the file, and lint writes what remains as usual', () => {
    const dir = temp({ 'a.crv': 'a **b**\n', 'b.crv': 'clean\n' })
    const result = cli(['fix', '-w', 'a.crv', 'b.crv'], '', dir)
    expect([result.status, result.stdout]).toEqual([0, ''])
    expect(readFileSync(join(dir, 'a.crv'), 'utf8')).toBe('a *b*\n')
    expect(readFileSync(join(dir, 'b.crv'), 'utf8')).toBe('clean\n')
  })

  it('refuses --write without --fix and --json with the source on standard output', () => {
    expect(() => parseArgs(['lint', '--write'])).toThrow('--write needs --fix')
    expect(() => parseArgs(['fix', '--json'])).toThrow('--json needs --write')
    expect(parseArgs(['fix', '--json', '--write', 'a.crv']).values).toEqual({ fix: true, json: true, write: true })
  })
})

describe('carve flatten', () => {
  it('writes one file with every include expanded', () => {
    const dir = temp({ 'main.crv': '= Main\n\n{{ part.crv }}\n\nEnd.\n', 'part.crv': '---\nx: 1\n---\n== Part\n\n{{ leaf.crv }}\n',
      'leaf.crv': 'Leaf *text*.\n' })
    const result = cli(['flatten', 'main.crv'], '', dir)
    expect([result.status, result.stdout, result.stderr]).toEqual([0, '= Main\n\n== Part\n\nLeaf *text*.\n\nEnd.\n', ''])
  })

  it('refuses a file whose include did not expand, and one whose keys meet in one scope', () => {
    const dir = temp({ 'bad.crv': '{{ nope.crv }}\n', 'dup.crv': '{{ a.crv }}\n\n{{ b.crv }}\n',
      'a.crv': 'A [^n].\n\n[^n]: One.\n', 'b.crv': 'B [^n].\n\n[^n]: Two.\n', 'ok.crv': 'fine\n' })
    const bad = cli(['flatten', 'bad.crv', 'ok.crv'], '', dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toBe('fine\n')
    expect(bad.stderr).toMatch(/^carve\[include-unresolved\]: bad\.crv:[^\n]*\nbad\.crv:1:1: warning include-not-found /)
    const dup = cli(['flatten', 'dup.crv'], '', dir)
    expect([dup.status, dup.stdout]).toEqual([1, ''])
    expect(dup.stderr).toMatch(/^carve\[flatten-changed\]: dup\.crv/)
    const stdin = cli(['flatten'], '{{ a.crv }}\n', dir)
    expect(stdin.stderr).toContain('include-no-resolver')
    expect(cli(['flatten', '--include-root', '.'], '{{ a.crv }}\n', dir).stdout).toBe('A [^n].\n\n[^n]: One.\n')
  })
})

describe('--output, --strict, --ignore and upgrade --migrate', () => {
  it('-o and --output write the product of render, fmt and import to a file', () => {
    const dir = temp({ 'a.crv': 'a *b*\n', 'b.crv': 'c\n' })
    expect(cli(['render', '-o', 'out.html', 'a.crv', 'b.crv'], '', dir)).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(readFileSync(join(dir, 'out.html'), 'utf8')).toBe('<p>a <strong>b</strong></p>\n<p>c</p>\n')
    cli(['fmt', '--output=f.crv'], '= T\n', dir)
    expect(readFileSync(join(dir, 'f.crv'), 'utf8')).toBe('= T\n')
    cli(['import', '--from=html', '-o', 'i.crv'], '<p><em>x</em></p>', dir)
    expect(readFileSync(join(dir, 'i.crv'), 'utf8')).toBe('/x/\n')
    writeFileSync(join(dir, 'keep.html'), 'KEEP\n')
    expect(cli(['render', '-o', 'keep.html', 'missing.crv'], '', dir).status).toBe(2)
    expect(readFileSync(join(dir, 'keep.html'), 'utf8')).toBe('KEEP\n')
    expect(() => parseArgs(['fmt', '-o', 'x', '--check'])).toThrow('--output cannot be combined')
    expect(() => parseArgs(['render', '-o', 'x', '--report-losses', 'x'])).toThrow('cannot write the same path')
    expect(() => parseArgs(['ast', '-o', 'x'])).toThrow('unknown flag -o')
  })

  it('--strict fails a file that wrote any entry: a render loss, or a lint hint', () => {
    const render = cli(['render', '--strict'], '{{ e }}\n')
    expect([render.status, render.stdout]).toEqual([1, '<p>{{ e }}</p>\n'])
    expect(cli(['render', '--strict'], 'a\n').status).toBe(0)
    expect(cli(['lint'], 'a\n\n---\n').status).toBe(0)
    expect(cli(['lint', '--strict'], 'a\n\n---\n').status).toBe(1)
  })

  it('lint --ignore drops the entries of a file id, repeatable', () => {
    const dir = temp({ 'm.crv': '= M\n\n{{ p.crv }}\n\n{{ q.crv }}\n', 'p.crv': 'a **b**\n', 'q.crv': 'c ~~d~~\n' })
    expect(cli(['lint', 'm.crv'], '', dir).stdout).toMatch(/^p\.crv:1:3: .*\nq\.crv:1:3: /)
    expect(cli(['lint', '--ignore', 'p.crv', 'm.crv'], '', dir).stdout).toMatch(/^q\.crv:1:3: /)
    expect(cli(['lint', '--ignore', 'p.crv', '--ignore=q.crv', 'm.crv'], '', dir)).toEqual({ status: 0, stdout: '', stderr: '' })
  })

  it('upgrade --migrate respells a reference that misses its target only by case', () => {
    const dir = temp({ 'u.crv': '# Intro\n\nSee </#intro>.\n' })
    expect(cli(['upgrade', 'u.crv'], '', dir).stdout).toBe('# Intro\n\nSee </#intro>.\n')
    const migrated = cli(['upgrade', '--migrate', 'u.crv'], '', dir)
    expect([migrated.status, migrated.stdout]).toEqual([0, '# Intro\n\nSee </#Intro>.\n'])
    expect(migrated.stderr).toContain('u.crv:3: case-reference rewrite:')
  })
})

describe('--extensions and --extension-options (C2-T-010)', () => {
  const tabs = ':::: tabs\n::: tab "A"\na\n:::\n::::\n'

  it('registers every standard extension of the catalog on render, fmt, lint and ast', () => {
    const dir = temp({ 'a.crv': tabs })
    const catalog = JSON.parse(readFileSync(join(root, 'data/extensions.json'), 'utf8')) as { extensions: { name: string }[] }
    const names = JSON.stringify(catalog.extensions.map((entry) => entry.name))
    for (const command of ['render', 'fmt', 'lint', 'ast']) {
      const result = cli([command, '--extensions', names, 'a.crv'], '', dir)
      expect([command, result.status, result.stderr]).toEqual([command, 0, ''])
    }
  })

  it('registers a tab together with its group, and the spoiler forms together (C2-X-064)', () => {
    const dir = temp({ 'a.crv': tabs, 's.crv': ':spoiler[x]\n\n::: spoiler\ny\n:::\n' })
    type Tree = { name?: string, children: Tree[] }
    const tab = JSON.parse(cli(['ast', '--extensions', '["carve.tab"]', 'a.crv'], '', dir).stdout) as Tree
    expect(tab.children[0]?.name).toBe('carve.tabs')
    const spoiler = JSON.parse(cli(['ast', '--no-positions', '--extensions', '["carve.spoiler"]', 's.crv'], '', dir).stdout) as Tree
    expect([spoiler.children[0]?.children[0]?.name, spoiler.children[1]?.name]).toEqual(['carve.spoiler', 'carve.spoilerBlock'])
  })

  it('registers them for render --to markdown as well', () => {
    const dir = temp({ 'a.crv': tabs })
    const core = cli(['render', '--to', 'markdown', 'a.crv'], '', dir)
    expect(core.stderr).toContain('markdown-container-flattened')
    const registered = cli(['render', '--to', 'markdown', '--extensions', '["carve.tabs"]', 'a.crv'], '', dir)
    expect([registered.stdout, registered.stderr]).toEqual(['**A**\n\na\n', ''])
  })

  it('refuses with usage what the catalog does not name', () => {
    const dir = temp({ 'a.crv': tabs })
    const refused = [
      ['--extensions', '"carve.tabs"'],
      ['--extensions', '["all"]'],
      ['--extension-options', '{"carve.tabs":{"mode":"aria"}}'],
      ['--extensions', '["carve.tabs"]', '--extension-options', '[]'],
      ['--extensions', '["carve.tabs"]', '--extension-options', '{"carve.tabs":{"mode":"radio"}}'],
      ['--extensions', '["carve.tabs"]', '--extension-options', '{"carve.tabs":{"color":"red"}}'],
      ['--extensions', '["carve.mathBlock"]', '--extension-options', '{"carve.mathBlock":{"mode":"aria"}}'],
    ]
    for (const flags of refused) {
      const result = cli(['render', ...flags, 'a.crv'], '', dir)
      expect([flags, result.status, result.stdout, /^carve\[usage\]:/.test(result.stderr)]).toEqual([flags, 2, '', true])
    }
  })
})
