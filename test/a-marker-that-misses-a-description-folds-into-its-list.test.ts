import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, ' ').replace(/> /g, '>').replace(/ </g, '<')

// carve#4479: a marker at a column no description reaches is lazy text of the list inside it.
describe('a marker that misses a description folds into its list', () => {
  it.each([
    [':: t\n: - a\n- b\n', '<dl><dt>t</dt><dd><ul><li>a - b</li></ul></dd></dl>'],
    [':: t\n: 1. a\n2. b\n', '<dl><dt>t</dt><dd><ol><li>a 2. b</li></ol></dd></dl>'],
    [':: t\n: - a\n* b\n', '<dl><dt>t</dt><dd><ul><li>a * b</li></ul></dd></dl>'],
    [':: t\n: - a\n  - b\n', '<dl><dt>t</dt><dd><ul><li>a</li><li>b</li></ul></dd></dl>'],
    ['- :: t\n  : - a\n  - b\n', '<ul><li><dl><dt>t</dt><dd><ul><li>a</li></ul></dd></dl><ul><li>b</li></ul></li></ul>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
