import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A valid `{%` run holds a fence-shaped continuation as comment text
// (CARVE-P2-035), so a lazy line after the run continues the item exactly as
// it does with a plain word in that place (markup-carve/carve-js#4856).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const HOSTS: Array<(middle: string) => string[]> = [
  (m) => ['- {% a', '   ' + m, '   z %}', 'plain'],
  (m) => ['1. {% a', '    ' + m, '    z %}', 'plain'],
  (m) => ['- [ ] {% a', '       ' + m, '       z %}', 'plain'],
  (m) => ['- x', '  {% a', '   ' + m, '   z %}', 'plain'],
  (m) => ['- x', '  - {% a', '     ' + m, '     z %}', 'plain'],
  (m) => ['> - {% a', '>    ' + m, '>    z %}', 'plain'],
  (m) => ['> > - {% a', '> >    ' + m, '> >    z %}', 'plain'],
]

describe('a fence line held by a comment run keeps the lazy line', () => {
  for (const host of HOSTS) {
    for (const middle of ['```', '~~~', '``` js', '````']) {
      const source = host(middle).join('\n') + '\n'
      const twin = host('b').join('\n') + '\n'
      it(JSON.stringify(source), () => expect(html(source)).toBe(html(twin)))
    }
  }

  it.each([
    ['- {% a\n   ```\n   z %}\nplain\n', '<ul><li>plain</li></ul>'],
    ['- {% a\n   ```\n   z %}\n- s\n', '<ul><li></li><li>s</li></ul>'],
    // A `{%` line inside fence payload is payload, so the fence still closes.
    ['- x\n  ```\n  {% a\n   ```\n  ```\nplain\n', '<ul><li>x<pre><code>{% a\n ```</code></pre></li></ul><p>plain</p>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
