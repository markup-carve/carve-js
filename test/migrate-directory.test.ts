import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { migrateMarkdownDirectory } from '../src/migrate-directory.js'

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
  expect(existsSync(join(source, 'new'))).toBe(false)
  if (process.platform !== 'win32') {
    const alias = join(root, 'alias')
    symlinkSync(source, alias, 'dir')
    expect(() => migrateMarkdownDirectory(source, join(alias, 'new', 'out'))).toThrow(/outside/)
    expect(existsSync(join(source, 'new'))).toBe(false)
  }
})
