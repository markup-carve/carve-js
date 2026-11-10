import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `%%%` or fence-shaped continuation of a valid `{%` run is comment text of
// the run (CARVE-P2-035), in every host that takes lazy lines, so a lazy line
// after the run continues the host exactly as with a plain word in that place
// (markup-carve/carve#5853).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const HOSTS: Array<(middle: string) => string[]> = [
  (m) => ['- {% a', '   ' + m, '   z %}', 'plain'],
  (m) => ['1. {% a', '    ' + m, '    z %}', 'plain'],
  (m) => ['- x', '  - {% a', '     ' + m, '     z %}', 'plain'],
  (m) => ['> - {% a', '>    ' + m, '>    z %}', 'plain'],
  (m) => ['[^n]: {% a', '       ' + m, '       z %}', 'plain', '', 'x[^n]'],
  (m) => ['> [^n]: {% a', '>        ' + m, '>        z %}', 'plain', '', 'x[^n]'],
  (m) => ['- [^n]: {% a', '         ' + m, '         z %}', 'plain', '', 'x[^n]'],
  (m) => [':: t', ': {% a', '   ' + m, '   z %}', 'plain'],
]

describe('a percent line held by a comment run keeps the lazy line', () => {
  for (const host of HOSTS) {
    for (const middle of ['%%%', '%%% x', '%%%%', '```']) {
      const source = host(middle).join('\n') + '\n'
      const twin = host('b').join('\n') + '\n'
      it(JSON.stringify(source), () => expect(html(source)).toBe(html(twin)))
    }
  }

  it.each([
    ['- {% a\n   %%%\n   z %}\nplain\n', '<ul><li>plain</li></ul>'],
    [':: t\n: {% a\n   %%%\n   z %}\nplain\n', '<dl><dt>t</dt><dd>plain</dd></dl>'],
    // Not a valid run (the continuation is at the brace), so `%%%` stays a comment opener.
    ['- {% a\n  %%%\n  z %}\nplain\n', '<ul><li>{% a</li></ul><p>plain</p>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
