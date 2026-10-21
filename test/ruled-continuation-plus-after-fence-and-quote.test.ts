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

describe('ruled continuation markers', () => {
  it.each(fenceCases)('keeps the second refused plus in the %s item after an open fence', (_name, source) => {
    const html = carveToHtml(source)
    expect(html).toMatch(/<pre><code><\/code><\/pre>\n\s*\+\n\s*<\/li>/)
    expect(html).toContain('<p>tail</p>')
    expect(html).not.toContain('</ul>\n<p>+</p>')
    expect(carveToHtml(carveToCarve(source))).toBe(html)
    const plusLines = source.split('\n')
    const firstPlus = plusLines.findIndex(line => line.trim() === '+')
    expect(lintCarve(source).filter(w => w.rule === 'continuation-marker-refused')).toEqual([
      expect.objectContaining({ line: firstPlus + 2, column: plusLines[firstPlus]!.indexOf('+') + 1 }),
    ])
  })

  it.each(quoteCases)('reads a quoted plus as a marker for its list', source => {
    const html = carveToHtml(source)
    expect(html).toContain('<li>a\n')
    expect(html).toMatch(/<li>a\n\s*tail\n\s*<\/li>/)
    expect(html).not.toContain('a\n+\ntail')
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })
})
