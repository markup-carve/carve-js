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

it.runIf(posix && process.getuid?.() !== 0)('reports an unreadable file as a read failure, not as invalid UTF-8', () => {
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
