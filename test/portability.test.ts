/*
 * The portability check, and the reason it replaced a lint rule.
 *
 * carve-js#546 recorded a withdrawn rule that tried to REASON about when a
 * Carve document reads differently in Djot, and three ways that reasoning came
 * apart. The cases below are that issue's own tables, turned into assertions:
 * every shape it named as a false positive must now come out portable, and
 * every shape it named as a genuine divergence must still be reported.
 *
 * The point of the rewrite is that these are no longer the rule's correctness
 * argument - they are just examples. The check runs both engines, so it cannot
 * be wrong about whether they differ. What CAN still be wrong is the
 * normalization that decides which differences are about meaning, so that is
 * tested directly and fuzzed.
 */
import { describe, it, expect } from 'vitest'
import { parse as djotParse, renderHTML as djotRender } from '@djot/djot'
import { checkPortability, normalizeHtml, type DjotEngine } from '../src/portability.js'
import { carveToHtml } from '../src/index.js'

const djot: DjotEngine = { parse: djotParse, renderHTML: (d) => djotRender(d as never) }
const render = (src: string) => carveToHtml(src, { sourceLine: true })
const check = (src: string) => checkPortability(src, djot, render)
const portable = (src: string) => check(src).portable

describe('checkPortability — the divergences carve-js#546 documented', () => {
  it('agrees on a paragraph line followed by a block opener', () => {
    expect(portable('Some intro prose.\n> A quote.\n')).toBe(true)
  })

  it('reports a multi-line Djot heading absorbing the next line', () => {
    expect(portable('# Title\nSome intro prose.\n> A quote.\n')).toBe(false)
  })

  it('reports a `: term` definition list absorbing the next line', () => {
    expect(portable(': term\nSome intro prose.\n> A quote.\n')).toBe(false)
  })

  it('reports a footnote definition taking a lazy continuation', () => {
    expect(portable('[^a]: note\nSome intro prose.\n> A quote.\n')).toBe(false)
  })

  it('reports a heading inside a blockquote', () => {
    // The rule's remedy defect: its advice ("add a blank line above it") split
    // one blockquote into two. The check reports the divergence and prescribes
    // nothing, so there is no advice left to be wrong.
    expect(portable('> text\n> # H\n')).toBe(true)
  })

  it('reports an unterminated `:::` opener', () => {
    expect(portable('Some prose.\n:::\nstuff\n')).toBe(true)
  })
})

describe('checkPortability — the shapes the withdrawn rule got wrong', () => {
  /*
   * The rule's opener set assumed every flagged opener interrupts a paragraph
   * in Carve too. Per PART 9 section 10 several do not: the engines already
   * agree, so every firing was a false positive AND the advised blank line
   * changed the Carve document. Each of these must be portable.
   */
  it('a bullet under a paragraph line is portable', () => {
    expect(portable('Some prose.\n- item\n')).toBe(true)
  })

  it('an ordered marker under a paragraph line is portable', () => {
    expect(portable('Some prose.\n1. item\n')).toBe(true)
  })

  it('an unterminated code fence under a paragraph line is portable', () => {
    expect(portable('Some prose.\n```\ncode\n')).toBe(true)
  })

  it('a bare image line under a paragraph line is portable', () => {
    // The issue listed this as a divergence. It is not: both engines produce
    // the same <img>, and the difference it saw was the two renderers writing
    // `src` and `alt` in different orders.
    expect(portable('Some prose.\n![alt](i.png)\n')).toBe(true)
  })

  it('plain prose is portable', () => {
    expect(portable('Just a paragraph.\n\nAnd another one.\n')).toBe(true)
  })
})

describe('checkPortability — report shape', () => {
  it('names the line the divergence is attributed to', () => {
    const r = check('a *b* =c=\n')
    expect(r.portable).toBe(false)
    expect(r.divergence!.line).toBe(1)
  })

  it('carries both renderings from the first differing point', () => {
    const r = check('a *b* =c=\n')
    expect(r.divergence!.carve).not.toBe(r.divergence!.djot)
  })

  it('keeps the enclosing line across an inline element', () => {
    // `</strong>` must not unwind the paragraph's line: the divergence here is
    // after it, and reporting it without a line makes the check unusable in an
    // editor. Only the element that introduced a line may end it.
    const r = check('a *b* =c=\n')
    expect(r.portable).toBe(false)
    expect(r.divergence!.line).toBe(1)
  })

  it('a portable document carries no divergence', () => {
    expect(check('Plain prose.\n')).toEqual({ portable: true })
  })

  it('takes the Djot engine as a parameter rather than importing it', () => {
    // The package has no djot dependency; the engine is injected. A stub is
    // enough to drive the whole comparison, which is what makes that possible.
    const stub: DjotEngine = { parse: (s) => s, renderHTML: () => '<p>different</p>' }
    expect(checkPortability('x', stub, () => '<p>x</p>').portable).toBe(false)
    const same: DjotEngine = { parse: (s) => s, renderHTML: () => '<p>x</p>' }
    expect(checkPortability('x', same, () => '<p>x</p>').portable).toBe(true)
  })
})

describe('normalizeHtml — what is not a difference in meaning', () => {
  const n = (h: string) => normalizeHtml(h).html

  it('sorts attributes', () => {
    expect(n('<img src="a" alt="b">')).toBe(n('<img alt="b" src="a">'))
  })

  it('treats a boolean attribute and its empty-string spelling as one', () => {
    expect(n('<input disabled>')).toBe(n('<input disabled="">'))
  })

  it('ignores a self-closing slash', () => {
    expect(n('<img src="a" />')).toBe(n('<img src="a">'))
  })

  it('trims whitespace at a block boundary', () => {
    expect(n('<li>one</li>')).toBe(n('<li> one </li>'))
    expect(n('<p>a</p><p>b</p>')).toBe(n('<p>a</p>\n<p>b</p>'))
  })

  it('keeps whitespace between inline siblings, where it is content', () => {
    expect(n('<p>a<em>b</em></p>')).not.toBe(n('<p>a <em>b</em></p>'))
  })

  it('keeps whitespace inside <pre>, where it is the content', () => {
    expect(n('<pre><code>a\n  b</code></pre>')).not.toBe(n('<pre><code>a b</code></pre>'))
  })

  it('does not compare data-source-line, which the check injects itself', () => {
    expect(n('<p data-source-line="3">a</p>')).toBe(n('<p>a</p>'))
  })

  it('attributes every offset in a block to that block, past inline closers', () => {
    const { html, lines } = normalizeHtml(
      '<p data-source-line="7">a <em>b</em> c</p><p data-source-line="9">d</p>',
    )
    // Every offset inside the first paragraph, including everything after
    // `</em>`, belongs to line 7; the second paragraph switches to 9.
    const at = (needle: string) => lines[html.indexOf(needle)]
    expect(at('a ')).toBe(7)
    expect(at('<em>')).toBe(7)
    expect(at(' c')).toBe(7)
    expect(at('d')).toBe(9)
  })

  it('ends a void element’s line with the element', () => {
    const { html, lines } = normalizeHtml(
      '<p data-source-line="2"><img data-source-line="3" src="a">tail</p>',
    )
    expect(lines[html.indexOf('tail')]).toBe(2)
  })

  it('is idempotent', () => {
    const once = n('<ul>\n  <li> a </li>\n  <li><img src="x" alt="y" /></li>\n</ul>')
    expect(n(once)).toBe(once)
  })
})

/*
 * The property, not the examples.
 *
 * carve-js#546 closed by saying the test that matters is a generated one
 * asserting the check's actual contract, because both of the rule's defects
 * were invisible to hand-written cases. For a differential the contract is the
 * normalization: it must not equate documents the two engines genuinely
 * disagree about. So generate line soup, and for every document the check
 * calls PORTABLE, assert the two engines really did produce the same sequence
 * of elements - the one thing normalization could have hidden.
 */
describe('checkPortability — generated', () => {
  const LINES = [
    'Some prose.',
    'more prose',
    '',
    '# Heading',
    '## Heading two',
    '> A quote.',
    '- item',
    '1. item',
    // Task items earn their place: Djot puts `class="task-list"` on the <ul>
    // and Carve does not, so they are the shape where the ONLY difference
    // between the engines is an attribute. Without them the generator cannot
    // catch a normalizer that starts ignoring one.
    '- [ ] todo',
    '- [x] done',
    '```',
    'code',
    ':::',
    '::: note',
    ': term',
    '[^a]: note',
    '[ref]: /url',
    '![alt](i.png)',
    '| a | b |',
    '|---|---|',
    '^ Caption',
    '{#id}',
    '---',
    '  indented',
    'text with *bold* and /italic/',
  ]

  /*
   * A canonical form computed WITHOUT normalizeHtml, on purpose.
   *
   * Checking a portable verdict with the same code that produced it proves
   * nothing: any over-normalization would be applied to both sides and cancel
   * out. This is deliberately a second, cruder implementation - every element
   * with its attribute NAMES, plus all text with whitespace removed entirely -
   * so a normalizer that started ignoring an attribute, or dissolving an
   * element, disagrees with it.
   */
  const canonical = (html: string): string => {
    const elements = Array.from(
      html.matchAll(/<(\/?)([a-zA-Z][-\w]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)/g),
    ).map(([, slash, name, attrs]) => {
      const names = (attrs ?? '')
        .split(/\s+/)
        .map((a) => a.split('=')[0])
        .filter((a): a is string => Boolean(a))
        .sort()
      return `${slash}${name!.toLowerCase()}[${names.join(',')}]`
    })
    const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
    return `${elements.join(' ')}||${text}`
  }

  // Deterministic: a failing seed is reproducible from the test name alone.
  let seed = 0x2545f491
  const rnd = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return Math.abs(seed) / 0x7fffffff
  }

  it('never calls a document portable when the engines really disagree', () => {
    let portableCount = 0
    for (let doc = 0; doc < 600; doc++) {
      const n = 2 + Math.floor(rnd() * 6)
      const src =
        Array.from({ length: n }, () => LINES[Math.floor(rnd() * LINES.length)]!).join('\n') + '\n'
      let report
      try {
        report = check(src)
      } catch {
        continue // a document neither engine has to accept is not this test's business
      }
      if (!report.portable) continue
      portableCount++
      expect(canonical(carveToHtml(src)), `reported portable but the engines differ:\n${src}`).toBe(
        canonical(djotRender(djotParse(src))),
      )
    }
    // Guard against the assertion above passing because nothing was portable.
    expect(portableCount).toBeGreaterThan(20)
  })
})
