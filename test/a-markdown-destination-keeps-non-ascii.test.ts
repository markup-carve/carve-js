import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve, migrateMarkdown } from '../src/index.js'
import { migrateMarkdownDirectory } from '../src/migrate-directory.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it.each([
  '[a](/ü.png) and ![b](/ü.png) and [c](/%C3%BC)',
  '[a](/ü[x].png?q=ö#über)',
  '[a](https://bücher.de/ö)',
  '![x](/ü.png)\n',
  '[r][id]\n\n[id]: /ü.png\n',
  '<https://e.com/a[b]>',
  '<https://e.com/ü>',
])('keeps the authored destination in %s', source => {
  expect(markdownToCarve(source)).toBe(source)
})

it('keeps non-ASCII hrefs and a complete fidelity report', () => {
  const source = '[a](/ü.png) and ![b](/ü.png) and [c](/%C3%BC)'
  const result = migrateMarkdown(source)
  expect(result.value).toBe(source)
  expect(result.report.diagnostics.map(row => [row.code, row.severity, row.fidelity, row.confidence, row.path])).toEqual([
    ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
    ['markdown-link', 'info', 'preserved', 'exact', 'line:1'],
    ['markdown-image', 'info', 'preserved', 'exact', 'line:1'],
    ['markdown-link', 'info', 'preserved', 'exact', 'line:1'],
  ])
  expect(carveToHtml('[a](/ü.png)')).toContain('href="/ü.png"')
  const image = migrateMarkdown('![x](/ü.png)\n')
  expect(image.value).toBe('![x](/ü.png)\n')
  expect(image.report.diagnostics.map(row => [row.code, row.severity, row.fidelity, row.confidence, row.path])).toEqual([
    ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
    ['markdown-image', 'info', 'preserved', 'exact', 'line:1'],
  ])
})

it('encodes Unicode whitespace and controls while keeping ordinary Unicode', () => {
  for (const [source, output] of [
    ['[x](/ö\u00a0ü)', '[x](/ö%C2%A0ü)'],
    ['[x](/ö\u202fü)', '[x](/ö%E2%80%AFü)'],
    ['[x](/ö\u0085ü)', '[x](/ö%C2%85ü)'],
    ['[x](/ö&#127;ü)', '[x](/ö%7Fü)'],
  ]) expect(markdownToCarve(source)).toBe(output)
})

it('rewrites a Unicode heading fragment and reports its authored path', () => {
  const result = migrateMarkdown('# Über Uns\n\nSee [a](#über-uns).\n')
  expect(result.value).toBe('# Über Uns\n\nSee [a](#Über-Uns).\n')
  expect(result.report.diagnostics.at(-1)).toMatchObject({
    code: 'link-fragment-case-rewritten',
    message: 'Rewrote link fragment #über-uns to #Über-Uns, the one heading id it matches without regard to case.',
    path: 'link:#über-uns',
  })
})

it('keeps Unicode destinations during directory migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-unicode-'))
  roots.push(root)
  const source = join(root, 'source')
  const output = join(root, 'output')
  mkdirSync(source)
  writeFileSync(join(source, 'a.md'), 'See [b](b.md#über-uns) and ![x](/ü.png).\n')
  writeFileSync(join(source, 'b.md'), '# Über Uns\n')
  const result = migrateMarkdownDirectory(source, output)
  expect(readFileSync(join(output, 'a.crv'), 'utf8')).toBe('See [b](b.crv#Über-Uns) and ![x](/ü.png).\n')
  const report = JSON.parse(readFileSync(result.report, 'utf8'))
  expect(report.files.find((file: { source: string }) => file.source === 'a.md').diagnostics).toContainEqual(expect.objectContaining({
    code: 'link-fragment-case-rewritten', path: 'link:b.md#über-uns',
  }))
})
