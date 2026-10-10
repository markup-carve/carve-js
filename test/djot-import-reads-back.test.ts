import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

const headingText = (html: string): string => /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/.exec(html)![2]!

/** The text djot.js puts inside the first heading, which is the contract a heading import owes. */
const djotHeadingText = (source: string): string => headingText(renderHTML(parse(source)))

const carveHeadingText = (carve: string): string => headingText(carveToHtml(carve))

// carve-js#2680: the at-sign escape belongs only where the angle run is NOT an
// autolink. Escaping it inside one costs the link, and smart typography then
// turns the bare dash run into an en dash.
it.each([
  ['<a--@b.c>\n', 'a--@b.c'],
  ['<a-@b.c>\n', 'a-@b.c'],
  ['<a...@b.c>\n', 'a...@b.c'],
])('reads a dash-run address autolink back as a link: %j', (source, address) => {
  const converted = djotToCarve(source)
  expect(converted).toBe(source)
  expect(carveToHtml(converted).trim()).toBe(`<p><a href="mailto:${address}">${address}</a></p>`)
})

it.each(['<mailto:a@b.c>\n', '<a@b.c>\n', '<http://u@x/y>\n'])('leaves an autolink body unescaped: %j', (source) => {
  const converted = djotToCarve(source)
  expect(converted).toBe(source)
  expect(carveToHtml(converted)).toMatch(/^<p><a href="[^"]+">/)
})

it('still escapes the at sign where the angle run holds a lifted comment', () => {
  // carve-php#3037: without the escape this re-reads as a mention and the
  // address is gone, because the `@` follows a brace rather than a word
  // character. The Djot source is plain text - the space rules out an autolink.
  const converted = djotToCarve('<mailto:a{ }@b.c>\n')
  expect(converted).toBe('<mailto:a{%%}\\@b.c>\n')
  expect(carveToHtml(converted)).not.toContain('class="mention"')
  expect(carveToHtml(converted).trim()).toBe('<p>&lt;mailto:a@b.c&gt;</p>')
})

it('still reads an authored mention as a mention', () => {
  expect(carveToHtml('Hi @alice there\n')).toContain('class="mention"')
})

// carve-js#2681: Carve whitespace is space and tab, so a vertical tab or a form
// feed is ordinary heading content. `String.prototype.trim` strips both.
it.each(['# \u000b\n', '# \u000c\n', '# \u000b x\n', '# a\u000bb\n', '# x\u000b\n'])(
  'keeps heading content that is not Carve whitespace: %j',
  (source) => {
    const converted = djotToCarve(source)
    expect(converted).toBe(source)
    expect(carveHeadingText(converted)).toBe(djotHeadingText(source))
  },
)

it.each(['#  a\n', '#\ta\n', '# a\n'])('still trims a space or a tab from a heading: %j', (source) => {
  expect(djotToCarve(source)).toBe('# a\n')
})

// carve-js#2682: djot.js ends the heading at a line that opens a brace run and
// starts a new block there, so the collapsed comment never belongs to the
// heading line. The importer lifts the brace run to a NUL-delimited placeholder
// before the fold scan runs, so the guard has to test the byte.
it.each(['# a\n{% c %}\n', '# a\n{% x\ny %}\n', '## a\n{% x\ny %}\n'])(
  'puts a collapsed comment after a heading on its own line: %j',
  (source) => {
    const converted = djotToCarve(source)
    expect(converted).toBe(source.split('\n')[0] + '\n{%%}\n')
    expect(carveHeadingText(converted)).toBe(djotHeadingText(source))
  },
)

it('does not swallow the block after a collapsed comment into the heading', () => {
  expect(djotToCarve('# a\n{% x\ny %}\nhi\n')).toBe('# a\n{%%}\nhi\n')
  expect(djotToCarve('# a\n{% x\ny %}\n# b\n')).toBe('# a\n{%%}\n# b\n')
  expect(carveHeadingText('# a\n{%%}\n# b\n')).toBe(djotHeadingText('# a\n{% x\ny %}\n# b\n'))
})

it('keeps a real attribute line off the heading line too', () => {
  expect(djotToCarve('# a\n{.x}\n')).toBe('# a\n')
  expect(djotToCarve('# a {% c %}\n')).toBe('# a {%%}\n')
})

// carve#2854: the angle form promises display text = destination, and a Carve
// destination holds a square bracket literally, so encoding one changes the href
// against a body djot.js emits verbatim.
it.each([
  ['<mailto:a[x][missing]@b.c>\n', 'mailto:a[x][missing]@b.c'],
  ['para <mailto:a[x][missing]@b.c> tail\n', 'mailto:a[x][missing]@b.c'],
  ['<mailto:a[r][]@b.c>\n', 'mailto:a[r][]@b.c'],
  ['para <mailto:a[r][]@b.c> tail\n', 'mailto:a[r][]@b.c'],
  ['<http://u/a[1]b>\n', 'http://u/a[1]b'],
  ['<http://u/a[@b.c>\n', 'http://u/a[@b.c'],
  ['<http://u/a]b>\n', 'http://u/a]b'],
  ['<http://[::1]/[x]>\n', 'http://[::1]/[x]'],
])('carries a destination bracket through the Djot import unencoded: %j', (source, destination) => {
  const converted = djotToCarve(source)
  expect(converted).not.toContain('%5B')
  expect(converted).not.toContain('%5D')
  expect(carveToHtml(converted)).toContain(`<a href="${destination}">${destination}</a>`)
})

it.each([
  // A real percent sign stays one byte, never `%25`, and an encoded space stays encoded.
  ['<http://u/100%25?a=b%20c>\n', 'http://u/100%25?a=b%20c'],
  ['<http://u/a%20b>\n', 'http://u/a%20b'],
  ['<mailto:a@b.c>\n', 'mailto:a@b.c'],
])('leaves a destination with no bracket byte for byte: %j', (source, destination) => {
  expect(carveToHtml(djotToCarve(source))).toContain(`href="${destination}"`)
})

it('still encodes the destination bytes a Carve destination cannot hold', () => {
  // One body carries both: the parens would close the destination and stay encoded,
  // the brackets do not and stay literal.
  expect(djotToCarve('<http://u/a(b)[c]>\n')).toContain('(http://u/a%28b%29[c])')
  expect(djotToCarve('<http://u/a`b>\n')).toContain('(http://u/a%60b)')
  expect(djotToCarve('<http://u/a|b>\n')).toContain('(http://u/a%7Cb)')
})
