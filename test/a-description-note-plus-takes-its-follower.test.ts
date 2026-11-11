import { expect, test } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (source: string) => renderHtml(parse(source))

// carve-js#4966: the description's `:` is blanked in the prefix written before the note's follower.
test("a note's first-block plus on a description marker line takes the next line", () => {
  const out = html(':: t\n: [^q]: +\nx\n\nr[^q]\n')
  expect(out).not.toContain(':   x')
  expect(out).toContain('<dd></dd>\n</dl>')
  expect(out).toMatch(/<li id="fn1">\s*<p>x<a /)
})

test("a quote left of the note's own quote column is not the note's follower", () => {
  const out = html(':: t\n: > [^q]: +\n> z\n\nr[^q]\n')
  expect(out).toContain('</dl>\n<blockquote><p>z</p></blockquote>')
})

test("a quote right of the note's own quote column still follows the note", () => {
  expect(html('> [^b]: +\n  > para\n\nr[^b]\n')).toMatch(/<li id="fn1">\s*<p>para<a /)
})
