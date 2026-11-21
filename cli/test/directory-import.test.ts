import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { importMarkdownDirectory as migrateMarkdownDirectory, placeOutput, readCollectedFile } from '../directory-import.ts'

interface Report {
  schemaVersion: number
  sourceFormat: string
  files: { source: string, output: string, diagnostics: { code: string }[], links: { target: string, status: string, reason?: string }[] }[]
  assets: string[]
  skipped: string[]
  review: string[]
}

function fileOf(report: Report, source: string): Report['files'][number] {
  const file = report.files.find((entry) => entry.source === source)
  if (file === undefined) throw new Error(`no report entry for ${source}`)
  return file
}

function reportOf(path: string): Report {
  return JSON.parse(readFileSync(path, 'utf8')) as Report
}

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('converts a Markdown tree, copies assets, and reports review and skipped entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  const output = join(root, 'output')
  mkdirSync(join(source, 'nested'), { recursive: true })
  writeFileSync(join(source, 'nested', 'clean.md'), '# Clean\n')
  writeFileSync(join(source, 'loss.markdown'), 'A [script](javascript:alert(1)) link.\n')
  writeFileSync(join(source, 'asset.svg'), '<svg/>')
  symlinkSync('asset.svg', join(source, 'alias.svg'))
  const summary = migrateMarkdownDirectory(source, output)
  const report = reportOf(summary.report)
  expect(summary).toMatchObject({ files: 2, assets: 1, skipped: 1 })
  expect(readFileSync(join(output, 'nested', 'clean.crv'), 'utf8')).toBe('= Clean\n')
  expect(readFileSync(join(output, 'asset.svg'), 'utf8')).toBe('<svg/>')
  expect(report.skipped).toEqual(['alias.svg'])
  expect(report.review).toEqual(['loss.markdown'])
  if (process.platform !== 'win32') {
    const sibling = join(root, 'sibling')
    mkdirSync(sibling)
    expect(statSync(output).mode & 0o777).toBe(statSync(sibling).mode & 0o777)
  }
})

it('refuses destination collisions without leaving an output', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'same.md'), 'One\n')
  writeFileSync(join(source, 'same.markdown'), 'Two\n')
  expect(() => migrateMarkdownDirectory(source, join(root, 'output'))).toThrow(/same\.crv/)
  expect(() => readFileSync(join(root, 'output', 'migration-report.json'))).toThrow()
})

it('rewrites a case-only cross-file fragment and reports it as a fixup', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'a.md'), '# Guide\n\nSee [steps](b.md#install-steps), [same](b.md#Install-Steps) and [whole](b.md).\n')
  writeFileSync(join(source, 'b.md'), '# Install Steps\n\nRun it.\n\n# Twin\n\n# twin\n')
  writeFileSync(join(source, 'c.md'), '[twin](b.md#TWIN) [none](b.md#nothing)\n')
  const output = join(root, 'output')
  const report = reportOf(migrateMarkdownDirectory(source, output).report)
  expect(readFileSync(join(output, 'a.crv'), 'utf8')).toBe('= Guide\n\nSee [steps](b.crv#Install-Steps), [same](b.crv#Install-Steps) and [whole](b.crv).\n')
  const a = fileOf(report, 'a.md')
  expect(a.links).toContainEqual({ target: 'b.md#install-steps', status: 'rewritten' })
  expect(a.diagnostics.filter((row: { code: string }) => row.code === 'link-fragment-case-rewritten')).toEqual([{
    code: 'link-fragment-case-rewritten',
    message: 'Rewrote link fragment #install-steps to #Install-Steps, the one heading id it matches without regard to case.',
    severity: 'hint',
    channel: 'parse',
    path: '/children/1/children/1',
  }])
  const c = fileOf(report, 'c.md')
  expect(c.links).toEqual([
    { target: 'b.md#TWIN', status: 'unresolved', reason: 'fragment missing from target' },
    { target: 'b.md#nothing', status: 'unresolved', reason: 'fragment missing from target' },
  ])
  expect(c.diagnostics.some((row: { code: string }) => row.code === 'link-fragment-case-rewritten')).toBe(false)
  expect(report.review).toEqual(['c.md'])
})

it('names a cross-file fragment as the link wrote it, not percent-encoded (CARVE-P2-031)', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'a.md'), 'See [b](b.md#über-uns).\n')
  writeFileSync(join(source, 'b.md'), '# Über Uns\n\nRun it.\n')
  const output = join(root, 'output')
  const report = reportOf(migrateMarkdownDirectory(source, output).report)
  expect(readFileSync(join(output, 'a.crv'), 'utf8')).toBe('See [b](b.crv#Über-Uns).\n')
  const a = fileOf(report, 'a.md')
  expect(a.diagnostics.filter((row: { code: string }) => row.code === 'link-fragment-case-rewritten')).toEqual([{
    code: 'link-fragment-case-rewritten',
    message: 'Rewrote link fragment #über-uns to #Über-Uns, the one heading id it matches without regard to case.',
    severity: 'hint',
    channel: 'parse',
    path: '/children/0/children/1',
  }])
})

it('rewrites verified document links and reports missing files, fragments, and assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-links-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(join(source, 'chapters'), { recursive: true })
  writeFileSync(join(source, 'index.md'), '# Home\n\n[good](chapters/intro.md#Intro) [self](#Home) [self-low](#home) [query](?view=1) [encoded](chapters/a%23b.md#A) [bad](chapters/intro.md#intro) [third](chapters/intro.md#intro-2) [quote](chapters/intro.md#quote-head) [empty](chapters/intro.md#) [gone](missing.md) [route](/docs/intro) ![image](lost.png) [asset](manual.pdf#page=2)\n')
  writeFileSync(join(source, 'chapters/intro.md'), '# Intro\n\n[home](../index.md#Home)\n\n# Intro\n\n# Intro\n\n> # Quote Head\n')
  writeFileSync(join(source, 'chapters/a#b.md'), '# A\n')
  writeFileSync(join(source, 'manual.pdf'), 'pdf')
  const output = join(root, 'output')
  const summary = migrateMarkdownDirectory(source, output)
  const report = reportOf(summary.report)
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('(chapters/intro.crv#Intro)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('[empty](chapters/intro.crv#)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('[quote](chapters/intro.crv#Quote-Head)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('(chapters/a%23b.crv#A)')
  expect(readFileSync(join(output, 'chapters/intro.crv'), 'utf8')).toContain('(../index.crv#Home)')
  expect(report.review).toEqual(['index.md'])
  expect(fileOf(report, 'index.md').links).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: 'missing.md', status: 'unresolved' }),
    expect.objectContaining({ target: 'chapters/intro.md#intro', status: 'rewritten' }),
    expect.objectContaining({ target: 'chapters/intro.md#intro-2', status: 'unresolved', reason: 'fragment missing from target' }),
    expect.objectContaining({ target: 'lost.png', status: 'unresolved' }),
    expect.objectContaining({ target: '/docs/intro', status: 'unresolved', reason: 'site-root path needs route mapping' }),
    expect.objectContaining({ target: '#Home', status: 'valid' }),
    expect.objectContaining({ target: '#home', status: 'rewritten' }),
    expect.objectContaining({ target: '?view=1', status: 'valid' }),
    expect.objectContaining({ target: 'manual.pdf#page=2', status: 'unresolved', reason: 'asset fragment needs site check' }),
  ]))
})

it('does not treat data-id as an anchor', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-links-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'page.md'), '# Page\n\n[false anchor](other.md#shadow) [false code](other.md#ghost) [raw heading](other.md#fake) [native](other.md#same) [legacy](other.md#legacy)\n\n<a href=" other.md ">raw</a>\n\n<img src=" chart.png " srcset="missing-responsive.png 2x, chart,v2.png 1x">\n\n<link rel="preload" as="image" imagesrcset="chart,v2.png 2x">\n\n<video poster="missing-poster.png"></video>\n')
  writeFileSync(join(source, 'other.md'), '# Other\n\n<div data-id="shadow">Text</div>\n\n`id="ghost"`\n\n<h1 id="Fake">Raw</h1>\n\n# Same\n\n<h1 id="Same">Raw</h1>\n\n<a name="legacy"></a>\n')
  writeFileSync(join(source, 'chart.png'), 'png')
  writeFileSync(join(source, 'chart,v2.png'), 'png')
  const report = reportOf(migrateMarkdownDirectory(source, join(root, 'output')).report)
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md#shadow', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md#ghost', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md#fake', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md#same', status: 'rewritten',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md#legacy', status: 'rewritten',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'other.md', status: 'unresolved', reason: 'raw HTML link needs manual rewrite',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'chart.png', status: 'valid',
  })
  expect(fileOf(report, 'page.md').links.filter((link: { target: string }) => link.target === 'chart,v2.png')).toHaveLength(2)
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'missing-responsive.png', status: 'unresolved', reason: 'target missing from output',
  })
  expect(fileOf(report, 'page.md').links).toContainEqual({
    target: 'missing-poster.png', status: 'unresolved', reason: 'target missing from output',
  })
})

it('keeps an existing output and refuses an output inside the source', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'page.md'), 'Page\n')
  const output = join(root, 'output')
  mkdirSync(output)
  writeFileSync(join(output, 'keep.txt'), 'keep')
  expect(() => migrateMarkdownDirectory(source, output)).toThrow(/already exists/)
  expect(readFileSync(join(output, 'keep.txt'), 'utf8')).toBe('keep')
  expect(() => migrateMarkdownDirectory(source, join(source, 'out'))).toThrow(/outside/)
  expect(() => migrateMarkdownDirectory(source, join(source, '..', 'source', 'new', 'out'))).toThrow(/outside/)
  expect(() => migrateMarkdownDirectory(source, `${root}/zzz/../source/new/out`)).toThrow(/outside/)
  expect(existsSync(join(source, 'new'))).toBe(false)
  if (process.platform !== 'win32') {
    const alias = join(root, 'alias')
    symlinkSync(source, alias, 'dir')
    expect(() => migrateMarkdownDirectory(source, join(alias, 'new', 'out'))).toThrow(/outside/)
    expect(existsSync(join(source, 'new'))).toBe(false)
  }
})

const posix = process.platform !== 'win32'

it.runIf(posix)('refuses a collected file swapped for a symlink or another file before it is read', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const page = join(root, 'a.md')
  const secret = join(root, 'secret.txt')
  writeFileSync(page, 'Page\n')
  writeFileSync(secret, 'PRIVATE')
  const seen = lstatSync(page)
  expect(readCollectedFile(page, seen).bytes.toString()).toBe('Page\n')
  unlinkSync(page)
  symlinkSync(secret, page)
  expect(() => readCollectedFile(page, seen, 'a.md')).toThrow(/changed during import: a\.md/)
  writeFileSync(join(root, 'other.md'), 'Page\n')
  renameSync(join(root, 'other.md'), page)
  expect(() => readCollectedFile(page, seen, 'a.md')).toThrow(/changed during import/)
})

it.runIf(posix)('refuses an output directory that appears before the tree is moved into place', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const temporary = join(root, 'tmp')
  mkdirSync(temporary)
  writeFileSync(join(temporary, 'page.crv'), 'Page\n')
  const output = join(root, 'output')
  mkdirSync(output)
  expect(() => placeOutput(temporary, output)).toThrow(/output appeared during conversion/)
  expect(readdirSync(output)).toEqual([])
  expect(existsSync(join(temporary, 'page.crv'))).toBe(true)
  rmSync(output, { recursive: true })
  placeOutput(temporary, output)
  expect(readFileSync(join(output, 'page.crv'), 'utf8')).toBe('Page\n')
})

it.runIf(posix && process.getuid?.() !== 0)('reports an unreadable file as a read failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'locked.md'), 'Page\n')
  chmodSync(join(source, 'locked.md'), 0o000)
  try {
    expect(() => migrateMarkdownDirectory(source, join(root, 'output'))).toThrow(/cannot read locked\.md: EACCES/)
    expect(existsSync(join(root, 'output'))).toBe(false)
  } finally {
    chmodSync(join(source, 'locked.md'), 0o644)
  }
})

it.runIf(posix)('keeps an asset\'s permission bits under a restrictive umask', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'page.md'), 'Page\n')
  writeFileSync(join(source, 'run.sh'), 'echo\n', { mode: 0o755 })
  chmodSync(join(source, 'run.sh'), 0o755)
  const umask = process.umask(0o077)
  try { migrateMarkdownDirectory(source, join(root, 'output')) }
  finally { process.umask(umask) }
  expect(statSync(join(root, 'output', 'run.sh')).mode & 0o777).toBe(0o755)
})

it('replaces ill-formed bytes as single-file migration does', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'page.md'), Buffer.from([0x61, 0xed, 0xa0, 0x80, 0x62, 0x0a]))
  migrateMarkdownDirectory(source, join(root, 'output'))
  expect(readFileSync(join(root, 'output', 'page.crv'), 'utf8')).toBe('a\uFFFD\uFFFD\uFFFDb\n')
})

it('matches the Markdown extension by ASCII case only', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'page.MD'), 'Page\n')
  writeFileSync(join(source, 'x.mar\u212Adown'), 'Kelvin\n')
  const summary = migrateMarkdownDirectory(source, join(root, 'output'))
  expect(summary).toMatchObject({ files: 1, assets: 1 })
  expect(readFileSync(join(root, 'output', 'x.mar\u212Adown'), 'utf8')).toBe('Kelvin\n')
})

it('does not rewrite a link to a missing Markdown file onto an asset of the mapped name', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-links-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'index.md'), '[go](ghost.md)\n')
  writeFileSync(join(source, 'ghost.crv'), 'Already Carve\n')
  const summary = migrateMarkdownDirectory(source, join(root, 'output'))
  const report = reportOf(summary.report)
  expect(readFileSync(join(root, 'output', 'index.crv'), 'utf8')).toContain('(ghost.md)')
  expect(fileOf(report, 'index.md').links).toEqual([expect.objectContaining({ target: 'ghost.md', status: 'unresolved', reason: 'target missing from output' })])
})

const main = join(import.meta.dirname, '../main.ts')

function cli(args: string[]): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'carve-directory-'))
  roots.push(root)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, 'SRC', name, '..'), { recursive: true })
    writeFileSync(join(root, 'SRC', name), text)
  }
  return root
}

it('imports a directory on the command line, with the link of carve#6315 rewritten', () => {
  const root = tree({ 'a.md': 'Hello\n\n[Next](b.md)\n', 'b.md': '# Next\n' })
  const result = cli(['import', '--from', 'gfm', '--directory', join(root, 'SRC'), '--output', join(root, 'DST')])
  expect(result).toMatchObject({ status: 0, stderr: '' })
  expect(result.stdout).toBe(`2 file(s) converted; 0 asset(s) copied; 0 file(s) need review; 0 entry(s) skipped. Report: ${join(realpathSync(root), 'DST', 'migration-report.json')}\n`)
  expect(readFileSync(join(root, 'DST', 'a.crv'), 'utf8')).toBe('Hello\n\n[Next](b.crv)\n')
  expect(readFileSync(join(root, 'DST', 'b.crv'), 'utf8')).toBe(cli(['import', '--from', 'gfm', join(root, 'SRC', 'b.md')]).stdout)
  const report = reportOf(join(root, 'DST', 'migration-report.json'))
  expect(report).toEqual({ schemaVersion: 1, sourceFormat: 'gfm', assets: [], skipped: [], review: [], files: [
    { source: 'a.md', output: 'a.crv', diagnostics: [], links: [{ target: 'b.md', status: 'rewritten' }] },
    { source: 'b.md', output: 'b.crv', diagnostics: [], links: [] },
  ] })
})

it('rewrites a reference link, which the import resolves to its destination', () => {
  const root = tree({ 'a.md': '[Next][n]\n\n[n]: b.md#Next\n', 'b.md': '# Next\n' })
  expect(cli(['import', '--from', 'markdown', '--directory', join(root, 'SRC'), '--output', join(root, 'DST')]).status).toBe(0)
  expect(readFileSync(join(root, 'DST', 'a.crv'), 'utf8')).toBe('[Next](b.crv#Next)\n')
  expect(reportOf(join(root, 'DST', 'migration-report.json')).sourceFormat).toBe('markdown')
})

it('ends with status 1 under --strict-losses when a file needs review', () => {
  const root = tree({ 'a.md': '[x](javascript:alert(1))\n' })
  const result = cli(['import', '--from', 'gfm', '--strict-losses', '--directory', join(root, 'SRC'), '--output', join(root, 'DST')])
  expect(result.status).toBe(1)
  expect(result.stdout).toContain('1 file(s) need review')
  expect(reportOf(join(root, 'DST', 'migration-report.json')).review).toEqual(['a.md'])
})

it('refuses a directory import that misses its output or mixes in single-file flags', () => {
  const root = tree({ 'a.md': 'A\n' })
  const source = join(root, 'SRC')
  const output = join(root, 'DST')
  for (const [args, message] of [
    [['--from', 'gfm', '--directory', source], '--directory needs --output DIR'],
    [['--from', 'html', '--directory', source, '--output', output], '--directory imports --from gfm or markdown'],
    [['--from', 'gfm', '--directory', source, '--output', output, join(source, 'a.md')], '--directory takes no file'],
    [['--from', 'gfm', '--raw-html', '--directory', source, '--output', output], '--directory cannot be combined with --raw-html'],
    [['--from', 'gfm', '--report-losses', '-', '--directory', source, '--output', output], '--directory cannot be combined with --report-losses'],
  ] as const) {
    expect(cli(['import', ...args])).toMatchObject({ status: 2, stdout: '', stderr: `carve[usage]: ${message}\n` })
  }
  expect(existsSync(output)).toBe(false)
  const missing = cli(['import', '--from', 'gfm', '--directory', join(root, 'none'), '--output', output])
  expect(missing).toMatchObject({ status: 2, stderr: `carve[usage]: source is not a directory: ${join(root, 'none')}\n` })
})
