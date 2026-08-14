import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { carveToHtml, semanticSpan } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

// PART 9 §10 gives seven names a wrapper meaning on an ordinary span. Neither
// rule here describes an engine defect - carve-js, carve-php and carve-rs
// render every shape below byte-identically, and exactly as the clause says.
// They report the two places where the clause's own scope loses something the
// author wrote, with nothing else marking it
// (markup-carve/carve#1131, markup-carve/carve#1132).
//
// Of the 23 cases, 14 fail without the rules and 9 pass either way. The 9 are
// the "stays quiet" bounds plus the render assertions - they pin what must NOT
// change, and they are what a rule written too wide would break. The
// block-quote `cite` bound is the one that actually caught something: a first
// draft reported it.

const rules = (source: string, extensions?: CarveExtension[]): string[] =>
  lintCarve(source, extensions ? { extensions } : {})
    .map((w) => w.rule)
    .filter((r) => r.startsWith('semantic-'))

describe('a value on a wrapper-only semantic attribute is reported', () => {
  // PART 9 §9 splits the names by tier, so which of them lose a value depends
  // on the render the caller configured, and the rules take the extension set
  // to answer for that render rather than for a fixed list
  // (markup-carve/carve#1167). These four become elements only with the
  // SemanticSpan extension enabled.
  it.each(['samp', 'var', 'cite'])(
    'reports a value on %s once the extension makes it an element',
    (name) => {
      expect(rules(`[x]{${name}="V"}\n`, [semanticSpan()])).toEqual([
        'semantic-attribute-value-ignored',
      ])
    },
  )

  it('reports a value on kbd, which core renders as an element on its own', () => {
    expect(rules('[x]{kbd="V"}\n')).toEqual(['semantic-attribute-value-ignored'])
  })

  // The other half of the same rule, and the reason it needs the extension set:
  // in a CORE render these stay ordinary attributes and their value reaches the
  // output intact, so reporting it would report a loss that is not happening.
  it.each(['samp', 'var', 'cite'])(
    'stays quiet for %s in a core render, where the value survives',
    (name) => {
      expect(rules(`[x]{${name}="V"}\n`)).toEqual([])
      expect(carveToHtml(`[x]{${name}="V"}\n`).trim()).toBe(`<p><span ${name}="V">x</span></p>`)
    },
  )

  // `code` and `mark` left the registry (PART 9 §9), so there is no wrapper to
  // select and no value to lose: both are ordinary attributes that reach the
  // output. A rule still firing here would report a loss that is not happening.
  it.each(['code', 'mark'])('stays quiet for %s, which is no longer a semantic name', (name) => {
    expect(rules(`[x]{${name}="V"}\n`)).toEqual([])
    expect(carveToHtml(`[x]{${name}="V"}\n`).trim()).toBe(`<p><span ${name}="V">x</span></p>`)
  })

  // The claim behind the rule: where the name IS consumed, the value reaches no
  // output at all. `cite` is the extension's now, so the claim is checked with
  // it registered - unregistered the attribute survives, which is a different
  // (and lossless) outcome.
  it('the reported value is absent from the rendered HTML', () => {
    expect(carveToHtml('[x]{cite="https://example.org/dune"}\n', { extensions: [semanticSpan()] }).trim())
      .toBe('<p><cite>x</cite></p>')
    expect(carveToHtml('[x]{cite="https://example.org/dune"}\n').trim())
      .toBe('<p><span cite="https://example.org/dune">x</span></p>')
  })

  it.each(['abbr', 'dfn'])('stays quiet for %s, which maps its value to title', (name) => {
    expect(rules(`[x]{${name}="V"}\n`)).toEqual([])
    expect(carveToHtml(`[x]{${name}="V"}\n`, { extensions: [semanticSpan()] })).toContain('title="V"')
  })

  it('stays quiet for time, which maps its value to datetime', () => {
    expect(rules('[x]{time="2020-01-01"}\n')).toEqual([])
    expect(carveToHtml('[x]{time="2020-01-01"}\n')).toContain('datetime="2020-01-01"')
  })

  it('stays quiet when there is no value to lose', () => {
    expect(rules('[x]{kbd}\n')).toEqual([])
  })
})

describe('a reserved semantic name off-span is reported', () => {
  it.each([
    ['a code span', '`c`{kbd}\n'],
    ['a link', '[t](http://e.com){kbd}\n'],
    ['an image', '![a](i.png){kbd}\n'],
    ['a block attribute line on a paragraph', '{kbd}\nPara\n'],
    ['a block attribute line on a heading', '{kbd}\n# H\n'],
    ['a table row', '| a |\n| --- |\n| c |{kbd}\n'],
  ])('reports %s', (_label, source) => {
    expect(rules(source)).toEqual(['semantic-attribute-outside-span'])
  })

  // The claim behind the rule: it really does stay a raw attribute.
  it('the reported name renders as an empty raw attribute', () => {
    expect(carveToHtml('`c`{kbd}\n').trim()).toBe('<p><code kbd="">c</code></p>')
  })

  it('stays quiet on the span the clause is scoped to', () => {
    expect(rules('[x]{kbd}\n')).toEqual([])
  })

  // `cite` IS a URL attribute of blockquote and q in HTML, so this is the
  // author getting what they asked for. Reporting it would be telling them
  // their correct markup is wrong. Not a shape either ticket listed.
  it('stays quiet for cite on a block quote, where it is valid HTML', () => {
    expect(rules('{cite="https://example.org/dune"}\n> q\n')).toEqual([])
    expect(carveToHtml('{cite="https://example.org/dune"}\n> q\n'))
      .toContain('<blockquote cite="https://example.org/dune">')
  })

  it('still reports a name that is NOT valid on a block quote', () => {
    expect(rules('{kbd}\n> q\n')).toEqual(['semantic-attribute-outside-span'])
  })

  it('stays quiet for an ordinary attribute that is not a reserved name', () => {
    expect(rules('`c`{foo="bar"}\n')).toEqual([])
  })
})

// markup-carve/carve-js#1058. The message ends `renders as name="…"`, and the
// value it named used to be a fixed empty string. That reads true for the
// BOOLEAN form and false for every authored value, which is the half of the
// input space the sentence exists to explain.
//
// The load-bearing test is the first one below. It does not compare the message
// against a second copy of the expected value; it reads the value back OUT of
// the message and checks the rendered HTML actually contains it. A message
// quoting anything the renderer does not write fails it, whatever the reason.
describe('the off-span message quotes the value the renderer emits', () => {
  const outsideSpanMessage = (source: string): string => {
    const found = lintCarve(source)
      .filter((w) => w.rule === 'semantic-attribute-outside-span')
      .map((w) => w.message)
    expect(found).toHaveLength(1)

    return found[0]!
  }

  it.each([
    ['a code span', '`c`{kbd="K"}\n'],
    ['a link', '[t](http://e.com){kbd="K"}\n'],
    ['an image', '![a](i.png){kbd="K"}\n'],
    ['a block attribute line on a paragraph', '{kbd="K"}\nPara\n'],
    ['a block attribute line on a heading', '{kbd="K"}\n# H\n'],
    ['a table row', '| a |\n| --- |\n| c |{kbd="K"}\n'],
    ['a block quote, for a name not valid there', '{kbd="K"}\n> q\n'],
    ['a code span carrying no value at all', '`c`{kbd}\n'],
    ['a code span whose value the sanitizer blanks', '`c`{kbd="javascript:alert(1)"}\n'],
    ['a code span whose value needs escaping', '`c`{kbd="a\\"&<b>\'c"}\n'],
  ])('names what the render of %s contains', (_label, source) => {
    const quoted = /renders as (kbd="[^"]*")\.$/.exec(outsideSpanMessage(source))
    expect(quoted).not.toBeNull()
    expect(carveToHtml(source)).toContain(quoted![1])
  })

  // The exact bytes, so a later edit cannot satisfy the reader above by quoting
  // something merely present in the output - an `alt` or an `href` would pass a
  // containment check too.
  const message = (rendered: string): string =>
    '"kbd" is a semantic span attribute (PART 9 §10) and only applies to an ordinary ' +
    '[content]{attrs} span; on code it stays a raw attribute and renders as ' +
    `kbd="${rendered}".`

  it('reports an empty value for the boolean form, which is what it renders', () => {
    expect(outsideSpanMessage('`c`{kbd}\n')).toBe(message(''))
    expect(carveToHtml('`c`{kbd}\n').trim()).toBe('<p><code kbd="">c</code></p>')
  })

  it('reports the authored value, which used to be reported as empty', () => {
    expect(outsideSpanMessage('`c`{kbd="keyboard"}\n')).toBe(message('keyboard'))
    expect(carveToHtml('`c`{kbd="keyboard"}\n').trim()).toBe('<p><code kbd="keyboard">c</code></p>')
  })

  it('escapes the value the way the renderer escapes it', () => {
    expect(outsideSpanMessage('`c`{kbd="a\\"&<b>\'c"}\n')).toBe(
      message('a&quot;&amp;&lt;b&gt;&apos;c'),
    )
    expect(carveToHtml('`c`{kbd="a\\"&<b>\'c"}\n').trim()).toBe(
      '<p><code kbd="a&quot;&amp;&lt;b&gt;&apos;c">c</code></p>',
    )
  })

  // The sanitizer blanks a dangerous scheme BEFORE the attribute is written, so
  // the empty value is the true one here. Quoting the authored text would be
  // the same defect in the other direction.
  it('reports the empty value the sanitizer leaves, not the authored scheme', () => {
    expect(outsideSpanMessage('`c`{kbd="javascript:alert(1)"}\n')).toBe(message(''))
    expect(carveToHtml('`c`{kbd="javascript:alert(1)"}\n').trim()).toBe(
      '<p><code kbd="">c</code></p>',
    )
  })

  it('reports in full a value the sanitizer leaves alone', () => {
    expect(outsideSpanMessage('`c`{kbd="url(x)"}\n')).toBe(message('url(x)'))
  })

  it('quotes a value of exactly the limit whole', () => {
    const value = 'x'.repeat(120)
    expect(outsideSpanMessage(`\`c\`{kbd="${value}"}\n`)).toBe(message(value))
  })

  it('cuts one character past the limit and marks the cut', () => {
    expect(outsideSpanMessage(`\`c\`{kbd="${'x'.repeat(121)}"}\n`)).toBe(
      message(`${'x'.repeat(120)}…`),
    )
  })

  // Cutting the ESCAPED text could land inside an entity. Each character here
  // escapes to five, so a cut applied after escaping shows entity wreckage
  // instead of 120 ampersands.
  it('cuts before escaping, so no entity is split', () => {
    expect(outsideSpanMessage(`\`c\`{kbd="${'&'.repeat(200)}"}\n`)).toBe(
      message(`${'&amp;'.repeat(120)}…`),
    )
  })

  // Cutting BEFORE sanitizing would quote a long `javascript:` payload back as
  // a prefix that reads like an ordinary value, while the output holds nothing.
  //
  // THE PADDING GOES IN FRONT, and this test is worthless without it. A scheme
  // written at the START sits inside the 120-codepoint cut, so both orders
  // sanitize the same string and reach the same message - the check cannot
  // fail. Pushing the scheme PAST the cut is what tells the two apart: the cut
  // prefix is 120 spaces with no colon in it, which the sanitizer leaves alone,
  // so cutting first would quote the padding and an ellipsis instead of the
  // empty value the output holds. The sanitizer strips whitespace before
  // reading the scheme (`SCHEME_PROBE_STRIP_RE`), so the padded value is still
  // blanked whole.
  //
  // Built rather than pasted, and asserted byte for byte, because a fixture
  // whose entire meaning is a run of spaces is exactly what a formatter or an
  // editor trimming trailing whitespace destroys without a trace.
  const PADDING = ' '.repeat(200)

  it('pads with spaces that actually push the scheme past the cut', () => {
    expect(PADDING.length).toBe(200)
    expect([...new Set(PADDING)]).toEqual([' '])
    expect(PADDING.charCodeAt(0)).toBe(0x20)
    // 120 is `QUOTED_VALUE_LIMIT`; the assertion is that the padding clears it
    // with room to spare, not that it equals any particular length.
    expect(PADDING.length).toBeGreaterThan(120)
  })

  it('sanitizes the whole value before cutting, not the cut prefix', () => {
    const source = `\`c\`{kbd="${PADDING}javascript:alert(1)"}\n`
    expect(outsideSpanMessage(source)).toBe(message(''))
    // The output really does hold the empty value the message names, so the
    // assertion above is not describing a render of its own invention.
    expect(carveToHtml(source).trim()).toBe('<p><code kbd="">c</code></p>')
  })

  // An astral character is one codepoint and two UTF-16 units. Cutting by units
  // would split the pair and quote half a character.
  it('cuts by codepoints, so a surrogate pair survives whole', () => {
    expect(outsideSpanMessage(`\`c\`{kbd="${'\u{1f600}'.repeat(200)}"}\n`)).toBe(
      message(`${'\u{1f600}'.repeat(120)}…`),
    )
  })
})

// The ticket asked whether the sibling rule carries the same assumption. It
// does not: its message interpolates only the NAME, twice, and never a value.
// What it does assert is that the value reaches no output, so that is what is
// pinned here - for every reserved name that loses one, rather than the single
// name the rule was written against.
describe('the value-ignored message asserts a loss that really happens', () => {
  const valueIgnoredMessages = (source: string, extensions?: CarveExtension[]): string[] =>
    lintCarve(source, extensions ? { extensions } : {})
      .filter((w) => w.rule === 'semantic-attribute-value-ignored')
      .map((w) => w.message)

  it.each([
    ['kbd', false],
    ['samp', true],
    ['var', true],
    ['cite', true],
  ])('names %s and no value, and the value is absent from the render', (name, needsExtension) => {
    const source = `[x]{${name}="LOSTVALUE"}\n`
    const options = needsExtension ? { extensions: [semanticSpan()] } : {}
    expect(valueIgnoredMessages(source, needsExtension ? [semanticSpan()] : undefined)).toEqual([
      `Value on the semantic attribute "${name}" is discarded: it selects the <${name}> element ` +
        'and reaches no output. Only abbr, dfn and time carry a value (as title or datetime).',
    ])
    expect(carveToHtml(source, options)).not.toContain('LOSTVALUE')
  })
})

describe('both rules are default-on', () => {
  // Every other rule here reports a silent failure in Carve and needs no
  // opting in; only the platform rules are target-specific. These two are not.
  it('needs no options', () => {
    expect(lintCarve('`c`{kbd}\n').some((w) => w.rule === 'semantic-attribute-outside-span'))
      .toBe(true)
  })
})
