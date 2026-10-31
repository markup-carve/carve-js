import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

// PART 9 §24 C5: tab stops count in the frame the line is read in, so a tab past `- o` reaches column 2 + 4.
describe('a tab below a nested item counts from the item frame', () => {
  it.each([
    ['- o\n  -   e\n  \t> q\n', '<ul><li>o<ul><li>e<blockquote><p>q</p></blockquote></li></ul></li></ul>'],
    ['- o\n  -   e\n\n  \t> q\n', '<ul><li>o<ul><li>e<blockquote><p>q</p></blockquote></li></ul></li></ul>'],
    ['- o\n  -   e\n  \t# h\n', '<ul><li>o<ul><li>e<h1 id="h">h</h1></li></ul></li></ul>'],
    ['- o\n  -   e\n  \t- z\n', '<ul><li>o<ul><li>e<ul><li>z</li></ul></li></ul></li></ul>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))

  it('reads as its space twin', () => expect(html('- o\n  -   e\n  \t> q\n')).toBe(html('- o\n  -   e\n      > q\n')))
})
