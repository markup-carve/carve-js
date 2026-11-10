import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { trackWrappedAttributeRun } from '../src/parse/block/parse-quote-core.js'
import { expectBuiltInputScansLinearly, expectScansLinearly, perfIt } from './helpers/scaling.js'

// carve#5859: every line of an open `{%` run re-read the growing run text.
describe('a paragraph of `{%` opener lines in a container', () => {
  it('hides the run the last opener closes', () => {
    expect(carveToHtml('- x\n\n  {% a\n  {% a\n   z %}\n- s\n')).toBe(
      '<ul>\n  <li><p>x</p>\n    <p>{% a\n</p>\n  </li>\n  <li><p>s</p></li>\n</ul>')
  })

  it('keeps a comment run open across brace lines until `%}`', () => {
    const state = { attrRun: null as string | null }
    expect(trackWrappedAttributeRun(state, '{% a')).toBe(false)
    expect(trackWrappedAttributeRun(state, 'b }')).toBe(false)
    expect(state.attrRun).toBe('{% a\nb }')
    trackWrappedAttributeRun(state, 'z %}')
    expect(state.attrRun).toBe(null)
  })

  perfIt('tracks the brace lines of a comment run in linear time', () => {
    expectBuiltInputScansLinearly((input) => {
      const state = { attrRun: null as string | null }
      for (const line of input.split('\n')) trackWrappedAttributeRun(state, line)
    }, (repeats) => '{% a\n' + 'b }\n'.repeat(repeats) + 'z %}', { label: 'tracker brace lines', smallRepeats: 4000 })
  })

  const shapes: Record<string, [prefix: string, line: string, suffix: string]> = {
    item: ['- x\n\n', '  {% a\n', '   z %}\n- s\n'],
    'nested item': ['- x\n  - y\n\n', '    {% a\n', '     z %}\n- s\n'],
    'brace line': ['- x\n\n  {% a\n', '  b }\n', '   z %}\n- s\n'],
  }
  for (const [label, [prefix, line, suffix]] of Object.entries(shapes)) {
    perfIt(`parses the ${label} lines in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), line, { label, prefix, suffix, smallRepeats: 4000 })
    })
  }
})
