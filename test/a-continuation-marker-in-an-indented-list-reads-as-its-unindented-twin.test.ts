import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

// CARVE-P0-024 S3: an indented list is measured from its own line, so a `+` at a marker column attaches as unindented.
describe('a continuation marker in an indented list reads as its unindented twin', () => {
  it.each([
    ['  - - x\n\n    +\n    y\n', '<ul><li><ul><li>xy</li></ul></li></ul>'],
    [' - - x\n\n   +\n   y\n', '<ul><li><ul><li>xy</li></ul></li></ul>'],
    ['  - - x\n\n    +\n    y\n- z\n', '<ul><li><ul><li>xy</li></ul></li><li><p>z</p></li></ul>'],
    ['   1. - x\n\n      +\n      > q\n', '<ol><li><ul><li>x<blockquote><p>q</p></blockquote></li></ul></li></ol>'],
    [' :: t\n : > a\n   +\n   para\n', '<dl><dt>t</dt><dd><blockquote><p>a</p><p>para</p></blockquote></dd></dl>'],
    ['  :: t\n  : > a\n    +\n    para\n', '<dl><dt>t</dt><dd><blockquote><p>a</p><p>para</p></blockquote></dd></dl>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))

  it.each([
    ['  - - x\n\n    +\n    y\n', '- - x\n\n  +\n  y\n'],
    [' :: t\n : > a\n   +\n   para\n', ':: t\n: > a\n  +\n  para\n'],
  ])('%j reads as %j', (indented, flush) => expect(html(indented)).toBe(html(flush)))
})
