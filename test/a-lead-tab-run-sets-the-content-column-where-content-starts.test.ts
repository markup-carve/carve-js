import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

// CARVE-P2-010 (carve#4610): the tab run after the separator is content, so the content
// column is the column after the separator space and the text keeps the run.
describe('a lead tab run sets the content column where the content starts', () => {
  it.each([
    ['- \t e\n\n\tf\n', '<ul><li><p>\t e</p><p>f</p></li></ul>'],
    ['- \te\n\t> q\n', '<ul><li>\te<blockquote><p>q</p></blockquote></li></ul>'],
    ['- \te\n    # h\n', '<ul><li>\te<h1 id="h">h</h1></li></ul>'],
    ['- \te\n\n    # h\n', '<ul><li>\te<h1 id="h">h</h1></li></ul>'],
    ['1. \te\n    > q\n', '<ol><li>\te<blockquote><p>q</p></blockquote></li></ol>'],
    ['- \te\n  > q\n', '<ul><li>\te<blockquote><p>q</p></blockquote></li></ul>'],
    ['- \te\n  - s\n', '<ul><li>\te<ul><li>s</li></ul></li></ul>'],
    ['- \te\n    > q\n', '<ul><li>\te<blockquote><p>q</p></blockquote></li></ul>'],
    ['- \t e\n     > q\n', '<ul><li>\t e<blockquote><p>q</p></blockquote></li></ul>'],
    ['- \t\te\n\n        f\n', '<ul><li><p>\t\te</p><p>f</p></li></ul>'],
    ['1. \te\n\n    f\n', '<ol><li><p>\te</p><p>f</p></li></ol>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
