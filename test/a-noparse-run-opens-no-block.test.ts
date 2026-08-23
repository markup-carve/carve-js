import { describe, it, expect } from 'vitest'
import { bbcodeToCarve, carveToHtml } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

/**
 * A run whose content is LITERAL still re-entered the document as document
 * structure.
 *
 * carve-js#1384 the body is hidden behind a ONE-LINE key while `convertQuotes`
 *   runs, so a quote holding a six-line `[code]` run got one `> ` for six lines
 *   of content. The rest arrived at column 0, leaving both the quote and the
 *   fence the importer had just written, and the literal code text then built a
 *   list the source never spelled.
 * carve-js#1386 `escapePlainCarveInlineSyntax` covers INLINE syntax only, so a
 *   line-initial `- `, `1. ` or `> ` in a `[noparse]` body was never protected.
 *   The blank run the author happened to type inside it then decided how MANY
 *   lists came out, because PART 9 section 11 N1a reads three or more blank
 *   lines before a marker as a hard list boundary.
 *
 * Both are the same missing knowledge: the stash hands its body back without
 * saying what column it lands in or that it is literal at all.
 */
describe('a literal run re-enters the document at its own column', () => {
  it('keeps a code run inside the quote that holds it', () => {
    // carve-js#1384. The fence opener and closer were quoted and the four lines
    // between them were not.
    const carve = bbcodeToCarve('[quote]\n[code]\n- a\n\n\n\n- b\n[/code]\n[/quote]\n')

    expect(carve).toBe('> ```\n> - a\n>\n>\n>\n> - b\n> ```\n')
    expect(carveToHtml(carve)).toBe(
      '<blockquote>\n  <pre><code>- a\n\n\n\n- b\n</code></pre>\n</blockquote>',
    )
  })

  it('keeps the literal blank run the fence is there to carry', () => {
    // The blank run is CONTENT here, and a quote's own blank line is spelled
    // `>`, so the run survives without ending the quote and without becoming
    // N1a's list boundary.
    const html = carveToHtml(bbcodeToCarve('[quote]\n[code]\n- a\n\n\n\n- b\n[/code]\n[/quote]\n'))

    expect(html.match(/<blockquote>/g)).toHaveLength(1)
    expect(html.match(/<pre>/g)).toHaveLength(1)
    expect(html).not.toContain('<ul>')
  })

  it('writes the quote marker at every depth the quote is nested to', () => {
    expect(bbcodeToCarve('[quote][quote]\n[code]\na\nb\n[/code]\n[/quote][/quote]\n')).toBe(
      '> > ```\n> > a\n> > b\n> > ```\n',
    )
  })

  it('opens no list out of a noparse body, whatever blank run it holds', () => {
    // carve-js#1386. The same six lines used to come back as two real lists,
    // and the count depended on a blank run inside a run the author had asked
    // NOT to be parsed.
    const carve = bbcodeToCarve('[noparse]\n- a\n\n\n\n\n- b\n[/noparse]\n')
    const html = carveToHtml(carve)

    expect(carve).toContain('\\- a')
    expect(carve).toContain('\\- b')
    expect(html).not.toContain('<ul>')
    expect(html).not.toContain('<li>')
    expect(html).toBe('<p>- a</p>\n<p>- b</p>')
  })

  it('escapes the marker that happened to fold into a paragraph too', () => {
    // The ticket's second input rendered correctly by luck: the run was short
    // enough that the unescaped `- a` folded into the paragraph above it. Same
    // unescaped marker, one blank line away from being a list.
    const carve = bbcodeToCarve('[noparse]\n*not bold*\n- a\n[/noparse]\n')

    expect(carve).toBe('\n\\*not bold*\n\\- a\n\n')
    expect(carveToHtml(carve)).toBe('<p>*not bold*\n- a</p>')
  })
})

/**
 * Every line-initial spelling is the WRITER's, checked form by form.
 *
 * `renderCarve` is this engine's authority for its own output, and the spec
 * asks an importer to emit the source `carve fluent fmt` emits. So rather than
 * asserting a table written by hand, each form below is compared against what
 * the writer writes for a paragraph carrying exactly that text: a rule that
 * moves in the writer moves this check with it, in either direction.
 */
describe('a noparse run opens no block, spelled the way the writer spells it', () => {
  const asParagraph = (line: string): string =>
    renderCarve({
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: line }] }],
    } as never)

  /** Line-initial forms that DO open a block, so a literal run must neutralize them. */
  const OPENERS = [
    '- a',
    '* a',
    '1. a',
    '1) a',
    '. a',
    '> a',
    '>',
    '# a',
    '## a',
    '~~~x',
    '---',
    '***',
    '___',
    ':::',
    '::: d',
    '| a |',
    '%% c',
    '%%x',
    '[a]: /x',
    '[^1]: x',
    '*[a]: x',
  ]

  /**
   * Forms that LOOK like a marker and open nothing.
   *
   * THE BOUND. A literal run that backslashed every leading punctuation
   * character would put escapes in front of ordinary forum text, and each of
   * these is a line a forum post really carries.
   */
  const LOOKALIKES = [
    '-a',
    '1.a',
    '>a',
    '>>a',
    '>> a',
    '#',
    '+ a',
    '^ cap',
    '.a',
    '-',
    '*',
    '1)',
    '|',
    '|a',
    '::',
    '.',
    ') a',
    '####### a',
    '[b]x[/b]',
    '~~x',
    'ok text',
  ]

  it.each([...OPENERS, ...LOOKALIKES])('spells %j the way the writer does', (line) => {
    expect(bbcodeToCarve(`[noparse]${line}[/noparse]`)).toBe(asParagraph(line))
  })

  it.each(OPENERS)('opens no block out of %j', (line) => {
    expect(carveToHtml(bbcodeToCarve(`[noparse]${line}[/noparse]`)).startsWith('<p>')).toBe(true)
  })

  it.each(LOOKALIKES)('writes %j with no escape at all', (line) => {
    expect(bbcodeToCarve(`[noparse]${line}[/noparse]`)).toBe(`${line}\n`)
  })

  it('leaves the two forms the inline escaper already owned where they were', () => {
    // `#a` is the hashtag rule this converter has had since carve-php#1191, and
    // `# ` keeps its trailing space where the writer trims one. Neither is a
    // block opener, both are what the converter answered before this change,
    // and they are named here so the agreement list above cannot quietly grow
    // to cover them.
    expect(bbcodeToCarve('[noparse]#a[/noparse]')).toBe('\\#a\n')
    expect(bbcodeToCarve('[noparse]##a[/noparse]')).toBe('#\\#a\n')
    expect(bbcodeToCarve('[noparse]# [/noparse]')).toBe('# \n')
  })
})

describe('the stash leaves alone what it is not writing into', () => {
  it('splices a body at column 0 when its key stands at column 0', () => {
    // THE BOUND ON THE COLUMN. A code run outside any container converts byte
    // for byte as before.
    expect(bbcodeToCarve('[code]\na\nb\n[/code]')).toBe('```\na\nb\n```\n')
    expect(bbcodeToCarve('[code=php]\n$x = 1;\n[/code]')).toBe('```php\n$x = 1;\n```\n')
  })

  it('splices a body verbatim when its key follows prose rather than a container', () => {
    expect(bbcodeToCarve('see [c]a\nb[/c] here')).toBe('see `a\nb` here\n')
  })

  it('puts no escape into the code the author asked to be shown', () => {
    // THE BOUND ON THE ESCAPING. A `[code]` body is literal by construction
    // inside its fence, so the block escaper must not reach it.
    expect(bbcodeToCarve('[code]\n- a\n1. b\n> c\n[/code]')).toBe('```\n- a\n1. b\n> c\n```\n')
  })

  it('keeps every answer the noparse rule already gave', () => {
    expect(bbcodeToCarve('[noparse]*x*[/noparse]')).toBe('\\*x*\n')
    expect(bbcodeToCarve('[noparse][b]x[/b][/noparse]')).toBe('[b]x[/b]\n')
    expect(bbcodeToCarve('[noparse]unclosed')).toBe('[noparse]unclosed\n')
    expect(bbcodeToCarve('[noparse][code]x[/code][/noparse]')).toBe('[code]x[/code]\n')
  })
})
