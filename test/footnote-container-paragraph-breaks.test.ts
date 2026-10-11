import { expect, it } from 'vitest'
import { carveToHtml, parse, renderCarveWithReport, renderHtml, resolve } from '../src/index.js'
import controls from './fixtures/footnote-container-paragraph-breaks.json'

function payloads(root: unknown): unknown[] {
  const records: Record<string, unknown>[] = []
  const seen = new WeakSet<object>()
  const stack: { node: unknown; path: string }[] = [{ node: root, path: '' }]
  while (stack.length > 0) {
    const entry = stack.pop()!
    if (entry.node === null || typeof entry.node !== 'object' || seen.has(entry.node)) continue
    seen.add(entry.node)
    const node = entry.node as Record<string, unknown>
    if (typeof node.type === 'string' && ['code', 'raw_inline', 'literal_inline', 'math', 'code_block', 'raw_block'].includes(node.type)) {
      records.push({ path: entry.path, type: node.type, payload: node.content ?? node.value, format: node.format, display: node.display })
    }
    for (const [key, value] of Object.entries(node).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== null && typeof value === 'object') stack.push({ node: value, path: `${entry.path}.${key}` })
    }
  }
  return records.sort((a, b) => String(a.path).localeCompare(String(b.path)))
}

// Structure follows Native Carve; opaque private-use payloads retain literal Unicode.
it.each(controls)('keeps paragraph breaks inside a footnote list: $source', ({ source, html }) => {
  const ast = resolve(parse(source))
  expect(carveToHtml(source)).toBe(html)
  expect(renderHtml(ast)).toBe(html)
  const result = renderCarveWithReport(ast)
  expect(result.losses).toEqual([])
  expect(result.totalLosses).toBe(0)
  expect(result.truncated).toBe(false)
  expect(carveToHtml(result.value)).toBe(html)
  expect(payloads(resolve(parse(result.value)))).toEqual(payloads(ast))
})
