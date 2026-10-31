import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

// CARVE-P2-010: the content column is where the content starts, after the whole whitespace run.
describe('a lead tab run sets the content column where the content starts', () => {
  it.each([
    ['- \t e\n\n\tf\n', '<ul><li>e</li></ul><p>f</p>'],
    ['- \te\n\t> q\n', '<ul><li>e<blockquote><p>q</p></blockquote></li></ul>'],
    ['- \te\n    # h\n', '<ul><li>e<h1 id="h">h</h1></li></ul>'],
    ['- \te\n\n    # h\n', '<ul><li>e<h1 id="h">h</h1></li></ul>'],
    ['1. \te\n    > q\n', '<ol><li>e<blockquote><p>q</p></blockquote></li></ol>'],
    ['- \te\n  > q\n', '<ul><li>e</li></ul><blockquote><p>q</p></blockquote>'],
    ['- \te\n  - s\n', '<ul><li>e</li><li>s</li></ul>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))

  it.each([
    ['- \te\n    > q\n', '-   e\n    > q\n'],
    ['- \t e\n     > q\n', '-    e\n     > q\n'],
    ['- \t\te\n\n        f\n', '-       e\n\n        f\n'],
    ['1. \te\n\n    f\n', '1.  e\n\n    f\n'],
  ])('%j reads as its space twin', (tab, space) => expect(html(tab)).toBe(html(space)))
})
