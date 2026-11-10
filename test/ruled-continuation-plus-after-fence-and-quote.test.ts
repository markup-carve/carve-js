import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const fenceCases = [
  ['bullet', '- a\n\n  ```\n+\n+\n\ntail\n'],
  ['ordered', '1. a\n\n   ```\n+\n+\n\ntail\n'],
  ['nested', '- outer\n  - a\n\n    ```\n  +\n  +\n\ntail\n'],
] as const

const quoteCases = [
  '> - a\n>+\n> tail\n',
  '> > - a\n> >+\n> > tail\n',
  '> > - a\n>> +\n> > tail\n',
] as const

const ruledFenceHtml = new Map<string, string>([
  [
    "- a\n\n  ```\n+\n+\n\ntail\n",
    "<ul>\n  <li><p>a</p>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "1. a\n\n   ```\n+\n+\n\ntail\n",
    "<ol>\n  <li><p>a</p>\n    <pre><code></code></pre>\n  </li>\n</ol>\n<p>tail</p>"
  ],
  [
    "- outer\n  - a\n\n    ```\n  +\n  +\n\ntail\n",
    "<ul>\n  <li>outer\n    <ul>\n      <li><p>a</p>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ]
])

describe('ruled continuation markers', () => {
  it.each(fenceCases)('keeps the second refused plus in the %s item after an open fence', (_name, source) => {
    const html = carveToHtml(source)
    expect(html).toBe(ruledFenceHtml.get(source))
    expect(html).toContain('<p>tail</p>')
    expect(html).not.toContain('</ul>\n<p>+</p>')
    expect(carveToHtml(carveToCarve(source))).toBe(html)
    const plusLines = source.split('\n')
    const firstPlus = plusLines.findIndex(line => line.trim() === '+')
    expect(lintCarve(source).filter(w => w.rule === 'refused-continuation-marker')).toEqual([
      expect.objectContaining({ line: firstPlus + 1, column: plusLines[firstPlus]!.indexOf('+') + 1 }),
      expect.objectContaining({ line: firstPlus + 2, column: plusLines[firstPlus]!.indexOf('+') + 1 }),
    ])
  })

  it.each(quoteCases)('reads a glued quote plus as text in its list', source => {
    const html = carveToHtml(source)
    expect(html).toContain('<li>a\n')
    expect(html).toContain(source.includes('>> +') ? '&gt;&gt; +\ntail</li>' : '&gt;+\ntail</li>')
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })
})
