import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, parse } from '../src/index.js'

// PART 9 §17 L1 after carve#5015: the item owns this blank and the child block.
const expected = `<ul>
  <li><p>a</p>
    <ul>
      <li>b</li>
    </ul>
  </li>
  <li><p>c</p></li>
</ul>`

describe('a blank before a direct child block', () => {
  it('loosens the entire list through the HTML fast path', () => {
    const source = '- a\n\n  - b\n- c\n'
    expect(parse(source).children[0]).toMatchObject({ type: 'list', tight: false })
    expect(carveToHtml(source)).toBe(expected)
  })

  it('keeps the list tight when the blank belongs to a nested item', () => {
    const source = '- a\n  - b\n\n    > q\n'
    expect(parse(source).children[0]).toMatchObject({ type: 'list', tight: true })
    expect(carveToHtml(source)).toContain('<li>a\n    <ul>')
    expect(carveToHtml(source)).toContain('<li><p>b</p>')
  })

  it('writes a nested tight item so it reads back tight', () => {
    const source = '- - > q\n+\nZ\n'
    const written = carveToCarve(source)
    expect(written).toBe(source)
    expect(parse(written).children[0]).toMatchObject({ type: 'list', tight: true })
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('loosens after a closed div containing inline code', () => {
    const source = '- :::\n  `x`\n  :::\n\n  > q\n- z\n'
    for (const positions of [false, true]) {
      expect(parse(source, { positions }).children[0]).toMatchObject({ type: 'list', tight: false })
    }
    expect(carveToHtml(source)).toContain('<li><p>z</p></li>')
  })

  it('loosens the parent after a closed fence in its child list', () => {
    const source = '- outer\n  - inner\n    ```\n    x\n    ```\n\n  > q\n'
    for (const positions of [false, true]) {
      expect(parse(source, { positions }).children[0]).toMatchObject({ type: 'list', tight: false })
    }
    expect(carveToHtml(source)).toContain('<li><p>outer</p>')
  })

  it('keeps an open child fence blank inside that child list', () => {
    const source = '- outer\n  - para\n    ```\n    code\n\n  # h\n    ```\n'
    expect(parse(source, { positions: false }).children[0]).toMatchObject({ type: 'list', tight: true })
    expect(carveToHtml(source)).toContain('<li>outer\n    <ul>')
  })

  it('keeps an open nested fence blank with the deepest child in both parse modes', () => {
    const source = '- outer\n  - head1\n    - head2\n\n      ```\n\n  ```\n\n  tail\n  ```\n'
    for (const positions of [false, true]) {
      expect(parse(source, { positions }).children[0]).toMatchObject({ type: 'list', tight: true })
    }
    expect(carveToHtml(source)).toContain('<li>outer\n    <ul>')
  })

  it('keeps a tight parent between sibling lists separated by an attribute line', () => {
    const source = '- head\n  > q\n  - a\n  {.x}\n  - a\n'
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(parse(written).children[0]).toMatchObject({ type: 'list', tight: true })
  })

  it('keeps a tight parent when a nested list precedes a fence and thematic break', () => {
    const source = '- head\n  - a\n  ```\n  x\n  ```\n  ---\n'
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(parse(written).children[0]).toMatchObject({ type: 'list', tight: true })
  })

  it('keeps a loose list with a literal plus and later div at its original boundaries', () => {
    const source = '- a\n  - +\n\n  :::note\n  q\n  :::\n\n  - b\n'
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })

  it('escapes a refused nested plus and preserves an outer loose list', () => {
    const source = '- - +\n\n  > q\n'
    const written = carveToCarve(source)
    expect(written).toBe('{loose}\n- - \\+\n  > q\n')
    expect(carveToCarve(written)).toBe(written)
    expect(parse(written).children[0]).toMatchObject({ type: 'list', tight: false })
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('reports tightness loss inside a quoted HTML list', () => {
    const html = '<blockquote><ul><li><ul><li>a</li></ul><ul><li>b</li></ul></li><li>z</li></ul></blockquote>'
    const imported = htmlToCarve(html)
    expect(imported.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'structure-unspellable', severity: 'warning' }),
    ]))
    expect(carveToCarve(imported.value)).toBe(imported.value)
  })

  it('reports an HTML tightness loss when sibling nested lists need a blank boundary', () => {
    const html = '<ul><li><ul><li>a</li></ul><ul><li>b</li></ul></li><li>z</li></ul>'
    expect(htmlToAst(html).value.children[0]).toMatchObject({ type: 'list', tight: true })
    const imported = htmlToCarve(html)
    expect(parse(imported.value).children[0]).toMatchObject({ type: 'list', tight: false })
    expect(imported.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'structure-unspellable', severity: 'warning', fidelity: 'dropped' }),
    ]))
    expect(carveToCarve(imported.value)).toBe(imported.value)
  })

})
