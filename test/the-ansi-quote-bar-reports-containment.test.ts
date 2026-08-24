import { describe, it, expect } from 'vitest'
import { carveToAnsi } from '../src/index.js'

/**
 * markup-carve/carve#1689: the ANSI blockquote bar reports CONTAINMENT, not
 * node kind. Everything a quote contains carries the bar, so the ANSI reader
 * is never told a block was unquoted where the HTML says it was.
 *
 * WHY THESE FIXTURES CAN FAIL. Before the ruling the bar was applied by each
 * block's own case in the renderer, and only three ever asked for it
 * (paragraph, admonition title, div label). So every assertion below that
 * expects a bar on a heading, a code block, a list or a flush image failed on
 * the previous implementation, and the two-spellings-agree assertion failed
 * because the flush spelling had no bar at all while the indented one did.
 *
 * The blank-line assertion is the NEAR MISS: prefixing a quote's whole
 * rendered body indiscriminately would draw a gutter through the space
 * between its blocks and past its end. It is the one shape a naive reading of
 * this fix would also change, and it must not.
 */

const BAR = '\x1b[36m\x1b[2m│\x1b[0m '

describe('the ANSI quote bar reports containment, not node kind', () => {
  it('gives both spellings of a lone quoted image the same bar', () => {
    // Identical HTML, different trees: `block_quote > image` against
    // `block_quote > paragraph > image`. Corpus category
    // 411-a-lone-indented-image-is-a-paragraph-and-its-html-cannot-say-so.
    const flush = carveToAnsi('> ![Apollo](a.jpg)\n')
    const indented = carveToAnsi('>   ![Apollo](a.jpg)\n')

    // Asserting BOTH spellings is the point of the ruling: a test on the flush
    // case alone cannot show that the two now agree.
    expect(flush).toBe(indented)
    expect(flush.startsWith(BAR)).toBe(true)
  })

  it('gives a quoted heading the bar, on its underline too', () => {
    const out = carveToAnsi('> # Heading\n')
    const lines = out.split('\n').filter((l) => l !== '')
    expect(lines.length).toBe(2)
    for (const line of lines) expect(line.startsWith(BAR)).toBe(true)
  })

  it('gives a quoted code block the bar on every payload line', () => {
    const out = carveToAnsi('> ```\n> alpha\n> beta\n> ```\n')
    const lines = out.split('\n').filter((l) => l !== '')
    expect(lines.length).toBe(2)
    for (const line of lines) expect(line.startsWith(BAR)).toBe(true)
    expect(out).toContain('alpha')
    expect(out).toContain('beta')
  })

  it('puts the bar OUTSIDE a quoted list marker, not between marker and text', () => {
    // The old per-node design prefixed the item's PARAGRAPH, so the bullet -
    // added by the list case afterwards - landed to the LEFT of the bar and
    // the output read `• │ item`. Containment puts the quote outermost.
    const out = carveToAnsi('> - item\n')
    expect(out.startsWith(BAR)).toBe(true)
    expect(out.indexOf('│')).toBeLessThan(out.indexOf('•'))
  })

  it('composes one bar per quote level when quotes nest', () => {
    expect(carveToAnsi('> > nested\n').startsWith(BAR + BAR)).toBe(true)
  })

  it('leaves the blank line BETWEEN two quoted blocks bare', () => {
    // Near miss: the shape a naive "prefix the whole body" fix would also
    // change. A bar here would draw a gutter through the gap and past the end.
    const out = carveToAnsi('> one\n>\n> two\n')
    const barred = out.split('\n').filter((l) => l.startsWith(BAR))
    expect(barred.length).toBe(2)
    for (const line of out.split('\n')) {
      if (!line.startsWith(BAR)) expect(line).toBe('')
    }
  })

  it('leaves an UNQUOTED heading and code block with no bar at all', () => {
    // Control: the bar tracks containment, so outside a quote there is none.
    expect(carveToAnsi('# Heading\n')).not.toContain('│')
    expect(carveToAnsi('```\ncode\n```\n')).not.toContain('│')
  })
})
