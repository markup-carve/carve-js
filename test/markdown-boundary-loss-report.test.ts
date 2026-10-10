import { expect, it } from 'vitest'
import { markdownToCarve, migrateMarkdown } from '../src/index.js'

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
