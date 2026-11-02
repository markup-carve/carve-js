import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A paragraph of only braced comments renders nothing at any line count, so list
// tightness, the sibling skip and the `+` read it as they read `%%` lines
// (markup-carve/carve#4799, corpus 928).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const COMMENTS = [['{% c %}'], ['{% c', 'd %}'], ['{% a', 'b', 'c %}'], ['{% a %} {% b %}']]
const SHAPES: Array<(body: string[]) => string[]> = [
  (b) => ['- ' + b[0], ...b.slice(1).map((l) => '  ' + l), '', '  Body.'],
  (b) => ['- a', '', ...b.map((l) => '  ' + l)],
  (b) => ['- a', '', ...b.map((l) => '  ' + l), '# H'],
  (b) => ['- a', '', ...b.map((l) => '  ' + l), '', '  text'],
  (b) => ['- a', '', ...b.map((l) => '  ' + l), '- b'],
  (b) => ['- a', '', ...b, '', '- b'],
  (b) => ['1. a', '', ...b, '', '2. b'],
  (b) => ['- a', '  - b', '', ...b.map((l) => '  ' + l), '', '  - c'],
  (b) => [':: t', ': a', '', ...b, '', ':: u', ': b'],
  (b) => [':: t', ': a', '', ...b, '', ': b'],
  (b) => ['- +', ...b, '', '# H'],
  (b) => ['> +', ...b, '', 'x'],
  (b) => ['- +', ...b, '# H'],
]

describe('a comment-only paragraph reads as its %% twin in lists', () => {
  for (const comment of COMMENTS) {
    for (const shape of SHAPES) {
      const source = shape(comment).join('\n') + '\n'
      const twin = shape(comment.map(() => '%% c')).join('\n') + '\n'
      it(JSON.stringify(source), () => expect(html(source)).toBe(html(twin)))
    }
  }

  it.each([
    ['- a\n\n{% c %}\n\n- b\n', '<ul><li><p>a</p></li><li><p>b</p></li></ul>'],
    [':: t\n: a\n\n{% c %}\n\n: b\n', '<dl><dt>t</dt><dd>a</dd><dd>b</dd></dl>'],
    ['- +\n{% c %}\n\n# H\n', '<ul><li>+</li></ul><section id="H"><h1>H</h1></section>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
