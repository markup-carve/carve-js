import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { carveToHtml } from '../src/index.js'

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

const rules = (source: string): string[] =>
  lintCarve(source).map((w) => w.rule).filter((r) => r.startsWith('semantic-'))

describe('a value on a wrapper-only semantic attribute is reported', () => {
  it.each(['samp', 'var', 'kbd', 'cite'])(
    'reports a value on %s, which only selects the wrapper',
    (name) => {
      expect(rules(`[x]{${name}="V"}\n`)).toEqual(['semantic-attribute-value-ignored'])
    },
  )

  // `code` and `mark` left the registry (PART 9 §9), so there is no wrapper to
  // select and no value to lose: both are ordinary attributes that reach the
  // output. A rule still firing here would report a loss that is not happening.
  it.each(['code', 'mark'])('stays quiet for %s, which is no longer a semantic name', (name) => {
    expect(rules(`[x]{${name}="V"}\n`)).toEqual([])
    expect(carveToHtml(`[x]{${name}="V"}\n`).trim()).toBe(`<p><span ${name}="V">x</span></p>`)
  })

  // The claim behind the rule: the value reaches no output at all.
  it('the reported value is absent from the rendered HTML', () => {
    expect(carveToHtml('[x]{cite="https://example.org/dune"}\n').trim())
      .toBe('<p><cite>x</cite></p>')
  })

  it.each(['abbr', 'dfn'])('stays quiet for %s, which maps its value to title', (name) => {
    expect(rules(`[x]{${name}="V"}\n`)).toEqual([])
    expect(carveToHtml(`[x]{${name}="V"}\n`)).toContain('title="V"')
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

describe('both rules are default-on', () => {
  // Every other rule here reports a silent failure in Carve and needs no
  // opting in; only the platform rules are target-specific. These two are not.
  it('needs no options', () => {
    expect(lintCarve('`c`{kbd}\n').some((w) => w.rule === 'semantic-attribute-outside-span'))
      .toBe(true)
  })
})
