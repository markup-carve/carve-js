import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve, migrateMarkdown } from '../src/index.js'

it.each([["``` f&ouml;&ouml;\nfoo\n```\n", 1], ["````;\n````\n", 1], ["[foo]: <>\n\n[foo]\n", 3], ["[link]()\n", 1], ["[link](<>)\n", 1], ["[]()\n", 1], ["[foo]()\n\n[foo]: /url1\n", 1], ["before\n\n> ```föö\n> x\n> ```\n", 3], ["before\n\n- ```föö\n  x\n  ```\n", 3], ["before\n\n![alt](<> \"title\")\n", 3], ["before\n\nfirst\n[link]()\n", 4]])('reports an unspellable Markdown construct at its source line: %s', (source, line) => {
  const result = migrateMarkdown(source)
  expect(result.value).toBe(markdownToCarve(source))
  const losses = result.report.diagnostics.filter(row => row.code === 'structure-unspellable')
  expect(losses).toHaveLength(1)
  expect(losses[0]).toMatchObject({ fidelity: 'dropped', confidence: 'exact', severity: 'warning', path: `line:${line}` })
})

it.each(['[link](url)', '![alt](image.png)', '`[link]()`', '\\[link]()', '```c++ metadata\nx\n```', '```&#99;\nx\n```', '```\nx\n```'])('does not report a boundary loss for %s', source => {
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'structure-unspellable')).toEqual([])
})

it.each([["- | h |\n  |---|\n  | [x]() |\n", 3], ["> | h |\n> |---|\n> | [x]() |\n", 3], ["a `c\nd`\n[x]()\n", 3], ["a\n[x]()\n===\n", 2]])('reports a folded source construct once at its original line: %s', (source, line) => {
  const losses = migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'structure-unspellable')
  expect(losses).toHaveLength(1)
  expect(losses[0]?.path).toBe(`line:${line}`)
})

it.each(['<span title="[x]()">a</span>', '<http://a/[x]()>', '![a [b]() c](img.png)', '[foo]: <>\n\n![x [foo] y](i.png)'])('does not confuse opaque syntax or image descriptions with links: %s', source => {
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'structure-unspellable')).toEqual([])
})

it.each([["> a\n> [x]()\n> ---\n", 2], ["- a\n  [x]()\n  ---\n", 2], ["> a\n> ```\n> x\n> ```\n> b\n> [x]()\n", 6], ["[a][a] z\n\n[a]: <> \"t\"\n", 1], ["<a@[x]()>", 1]])('keeps contained and reference diagnostics exact: %s', (source, line) => {
  const losses = migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'structure-unspellable')
  expect(losses).toHaveLength(1)
  expect(losses[0]?.path).toBe(`line:${line}`)
})

it('does not read a link across nested table cells', () => {
  const source = '- | h | i |\n  |---|---|\n  | [a | b]() |\n'
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'structure-unspellable')).toEqual([])
})

it.each([
  ['- a [x]()', 1],
  ['- a\n- b [x]()\n  c', 2],
  ['> <code>a</code>\n> [x]()', 2],
  ['<code>a</code>\n[x]()\n===', 2],
])('keeps first item lines and protected HTML offsets: %s', (source, line) => {
  const loss = migrateMarkdown(source).report.diagnostics.find(row => row.code === 'structure-unspellable')
  expect(loss?.path).toBe(`line:${line}`)
})


it.each([
  ["[foo]: /u '[l]()'\n\n[foo]", '[l]()'],
  ['[foo]: /u "![l]()"\n\n[foo]', '![l]()'],
  ["[foo]: /u '[l]()'\n\n" + '\n'.repeat(8) + '[foo]', '[l]()'],
])('keeps moved reference titles literal without loss diagnostics: %s', (source, title) => {
  const result = migrateMarkdown(source)
  expect(result.report.diagnostics.filter(row => row.code === 'structure-unspellable')).toEqual([])
  expect(carveToHtml(result.value)).toContain(`title="${title}"`)
})
