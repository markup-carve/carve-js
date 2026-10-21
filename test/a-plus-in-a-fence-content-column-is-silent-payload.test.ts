import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const refusedMarkers = (source: string) =>
  lintCarve(source).filter(finding => finding.rule === 'continuation-marker-refused')

describe('a plus in a fence content column', () => {
  it('keeps the shared vector silent and renders its payload', () => {
    const source = '- ```\n  +\n\n  x\n  ```\n'
    expect(refusedMarkers(source)).toEqual([])
    expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <pre><code>+\n\nx\n</code></pre>\n  </li>\n</ul>')
  })

  it('stays silent when the fence column is also the list marker column', () => {
    const source = '- a\n+\n```\n+\n```\n'
    const document = parse(source)
    expect(document.children[0]).toMatchObject({
      type: 'list',
      items: [{ children: [{ type: 'paragraph' }, { type: 'code_block', content: '+\n', pos: { startColumn: 1 } }] }],
    })
    expect(refusedMarkers(source)).toEqual([])
    expect(carveToHtml(source)).toBe('<ul>\n  <li>a\n    <pre><code>+\n</code></pre>\n  </li>\n</ul>')
  })

  it('still reports a plus at another column under an open fence', () => {
    const source = '- ```\n+\n\ntail\n'
    expect(refusedMarkers(source)).toEqual([
      expect.objectContaining({ line: 2, column: 1 }),
    ])
    expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>+</p>\n<p>tail</p>')
  })

  it('still reports the shared other-column nested fence case', () => {
    const source = '- a\n  - ```\n  +\n'
    expect(refusedMarkers(source)).toEqual([
      expect.objectContaining({ line: 3, column: 3 }),
    ])
    expect(carveToHtml(source)).toBe('<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    +\n  </li>\n</ul>')
  })
})
