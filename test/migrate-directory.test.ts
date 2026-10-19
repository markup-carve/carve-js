import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { migrateMarkdownDirectory, placeOutput, readCollectedFile } from '../src/migrate-directory.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('converts a Markdown tree, copies assets, and reports review and skipped entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-migrate-'))
  roots.push(root)
  const source = join(root, 'source')
  const output = join(root, 'output')
  mkdirSync(join(source, 'nested'), { recursive: true })
  writeFileSync(join(source, 'nested', 'clean.md'), '# Clean\n')
  writeFileSync(join(source, 'loss.markdown'), 'A footnote[^a].\n\n[^a]: Note.\n')
  writeFileSync(join(source, 'asset.svg'), '<svg/>')
  symlinkSync('asset.svg', join(source, 'alias.svg'))
  const summary = migrateMarkdownDirectory(source, output)
  const report = JSON.parse(readFileSync(summary.report, 'utf8'))
  expect(summary).toMatchObject({ files: 2, assets: 1, skipped: 1 })
  expect(readFileSync(join(output, 'nested', 'clean.crv'), 'utf8')).toContain('# Clean')
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
  const report = JSON.parse(readFileSync(migrateMarkdownDirectory(source, output).report, 'utf8'))
  expect(readFileSync(join(output, 'a.crv'), 'utf8')).toBe('# Guide\n\nSee [steps](b.crv#Install-Steps), [same](b.crv#Install-Steps) and [whole](b.crv).\n')
  const a = report.files.find((file: { source: string }) => file.source === 'a.md')
  expect(a.links).toContainEqual({ target: 'b.md#install-steps', status: 'rewritten' })
  expect(a.diagnostics.filter((row: { code: string }) => row.code === 'link-fragment-case-rewritten')).toEqual([{
    code: 'link-fragment-case-rewritten',
    message: 'Rewrote link fragment #install-steps to #Install-Steps, the one heading id it matches without regard to case.',
    severity: 'info',
    fidelity: 'normalized',
    confidence: 'inferred',
    path: 'link:b.md#install-steps',
  }])
  const c = report.files.find((file: { source: string }) => file.source === 'c.md')
  expect(c.links).toEqual([
    { target: 'b.md#TWIN', status: 'unresolved', reason: 'fragment missing from target' },
    { target: 'b.md#nothing', status: 'unresolved', reason: 'fragment missing from target' },
  ])
  expect(c.diagnostics.some((row: { code: string }) => row.code === 'link-fragment-case-rewritten')).toBe(false)
  expect(report.review).toEqual(['c.md'])
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
  const report = JSON.parse(readFileSync(summary.report, 'utf8'))
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('(chapters/intro.crv#Intro)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('[empty](chapters/intro.crv#)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('[quote](chapters/intro.crv#Quote-Head)')
  expect(readFileSync(join(output, 'index.crv'), 'utf8')).toContain('(chapters/a%23b.crv#A)')
  expect(readFileSync(join(output, 'chapters/intro.crv'), 'utf8')).toContain('(../index.crv#Home)')
  expect(report.review).toEqual(['index.md'])
  expect(report.files[2].links).toEqual(expect.arrayContaining([
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
  const report = JSON.parse(readFileSync(migrateMarkdownDirectory(source, join(root, 'output')).report, 'utf8'))
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md#shadow', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md#ghost', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md#fake', status: 'unresolved', reason: 'fragment missing from target',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md#same', status: 'rewritten',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md#legacy', status: 'rewritten',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'other.md', status: 'unresolved', reason: 'raw HTML link needs manual rewrite',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'chart.png', status: 'valid',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links.filter((link: { target: string }) => link.target === 'chart,v2.png')).toHaveLength(2)
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
    target: 'missing-responsive.png', status: 'unresolved', reason: 'target missing from output',
  })
  expect(report.files.find((file: { source: string }) => file.source === 'page.md').links).toContainEqual({
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
  expect(() => readCollectedFile(page, seen, 'a.md')).toThrow(/changed during migration: a\.md/)
  writeFileSync(join(root, 'other.md'), 'Page\n')
  renameSync(join(root, 'other.md'), page)
  expect(() => readCollectedFile(page, seen, 'a.md')).toThrow(/changed during migration/)
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
  const report = JSON.parse(readFileSync(summary.report, 'utf8'))
  expect(readFileSync(join(root, 'output', 'index.crv'), 'utf8')).toContain('(ghost.md)')
  expect(report.files[0].links).toEqual([expect.objectContaining({ target: 'ghost.md', status: 'unresolved', reason: 'target missing from output' })])
})
