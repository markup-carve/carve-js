import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A valid `{%` run holds its block-shaped lines (CARVE-P2-035), so a blank
// before the comment-only paragraph still loosens the list, as a `%%` line does
// (markup-carve/carve#5848, corpus 87-compact-list-blocks-6). Expected HTML is
// the spec model's at carve 5d43fe56.
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const MIDDLES = ['m', '- m', '1. m', '- [ ] m', '---', '* * *', '# m', '> m', '| a |', '%% c', '::: x', '```', '~~~']

describe('a block-shaped line inside a comment-only run keeps the list loose', () => {
  for (const middle of MIDDLES) {
    for (const opener of ['{% a', '{%']) {
      const source = ['- p', '', '  ' + opener, '   ' + middle, '   z %}', '- q'].join('\n') + '\n'
      it(JSON.stringify(source), () => expect(html(source)).toBe('<ul><li><p>p</p></li><li><p>q</p></li></ul>'))
    }
  }

  it.each([
    ['1. p\n\n   {% a\n    - m\n    z %}\n2. q\n', '<ol><li><p>p</p></li><li><p>q</p></li></ol>'],
    ['> - p\n>\n>   {% a\n>    ```\n>    z %}\n> - q\n', '<blockquote><ul><li><p>p</p></li><li><p>q</p></li></ul></blockquote>'],
    ['- x\n  - p\n\n    {% a\n     # m\n     z %}\n  - q\n', '<ul><li>x<ul><li><p>p</p></li><li><p>q</p></li></ul></li></ul>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
