import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, parse, renderCarve, renderCarveWithConversionReport, renderCarveWithReport } from '../src/index.js'

const structure = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(structure)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pos' && key !== 'srcByteLength').map(([key, child]) => [key, structure(child)]))
}

describe('nested tight list writer', () => {
  it('preserves a child with two fences before an outer fence', () => {
    const source = '- outer\n  - head\n\n    ```\n    a\n    ```\n\n    ```\n    b\n  ```\n\n  tail\n  ```\n- next'
    const written = renderCarve(parse(source))
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(renderCarve(parse(written))).toBe(written)
  })

  it.each([
    '- a\n  - > q\n\n    > r',
    '- a\n  - b\n    - > q\n\n      > r',
  ])('keeps nested block children at their content column', source => {
    const written = renderCarve(parse(source))
    expect(written).not.toMatch(/^\s+\+[ \t]*$/m)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(structure(carveToAstJson(written))).toEqual(structure(carveToAstJson(source)))
    expect(renderCarve(parse(written))).toBe(written)
  })

  it.each([
    '- a\n  - > q\n\n    later',
    '- a\n  - b\n    - c\n\n    later',
  ])('reports a nested item that needs to become loose', source => {
    const document = parse(source)
    const outer = document.children[0]
    if (outer?.type !== 'list') throw new Error('expected outer list')
    const nested = outer.items[0]?.children.find(child => child.type === 'list')
    if (nested?.type !== 'list') throw new Error('expected nested list')
    nested.tight = true
    const result = renderCarveWithReport(document)
    expect(result.losses.map(loss => loss.code)).toContain('list-tightness-lost')
    expect(renderCarveWithConversionReport(document).report.diagnostics.map(diagnostic => diagnostic.node)).toContain('list_item')
  })

  it.each([
    ':: t\n: - > q\n\n    > r',
    '[^a]: - > q\n\n    > r\n\nref[^a]',
  ])('writes hosted list blocks without an indented marker', source => {
    const written = renderCarve(parse(source))
    expect(written).not.toMatch(/^\s+\+[ \t]*$/m)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })
})
