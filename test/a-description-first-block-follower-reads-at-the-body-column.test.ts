import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A description's first-block follower is read in the body's columns, like every other body line (§17 L3).
const tight = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each([
  [':: t\n: > - +\n  > x\n',
    '<dl><dt>t</dt><dd><blockquote><ul><li>x</li></ul></blockquote></dd></dl>'],
  [':: t\n: > - +\n  > x\n  > q\n',
    '<dl><dt>t</dt><dd><blockquote><ul><li>x\nq</li></ul></blockquote></dd></dl>'],
  [':: t\n: > 1. +\n  > x\n',
    '<dl><dt>t</dt><dd><blockquote><ol><li>x</li></ol></blockquote></dd></dl>'],
  [':: t\n:  > - +\n   > x\n',
    '<dl><dt>t</dt><dd><blockquote><ul><li>x</li></ul></blockquote></dd></dl>'],
  ['- :: t\n  : > - +\n    > x\n',
    '<ul><li><dl><dt>t</dt><dd><blockquote><ul><li>x</li></ul></blockquote></dd></dl></li></ul>'],
  ['> :: t\n> : > - +\n>   > x\n',
    '<blockquote><dl><dt>t</dt><dd><blockquote><ul><li>x</li></ul></blockquote></dd></dl></blockquote>'],
  [':: t\n: - +\n  x\n',
    '<dl><dt>t</dt><dd><ul><li>x</li></ul></dd></dl>'],
])('a description first-block follower reads at the body column: %j', (source, html) => {
  expect(tight(carveToHtml(source))).toBe(html)
})
