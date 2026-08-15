/*
 * The writer does not escape into a run whose content is RAW.
 *
 * An image's alt text, a colon-fence or code-fence `[label]` and a footnote's
 * `[^id]` are all read verbatim: the reader resolves no escape inside them, so
 * a backslash the writer emits to neutralize a bracket arrives as two more
 * characters of the value. `![t[z]](/i.png)` came back as `alt="t\[z\]"`, and
 * it compounded - each pass escaped the backslash the last pass wrote
 * (markup-carve/carve#1197).
 *
 * markup-carve/carve#1206 settled the READ side: an alt text closes at the
 * MATCHING `]`, by the balanced, escape- and literal-span-aware scan a link's
 * text closes by. This engine already read it that way; only the writer did
 * not, so the corpus documents that pin the rule rendered byte for byte and
 * failed the formatter sweeps.
 *
 * IDEMPOTENCE IS ASSERTED EXPLICITLY, not left to the round trip. A single
 * `toHtml(fmt(x)) == toHtml(x)` pass is exactly what this defect survived
 * where it was cheapest to notice: the first pass of an alt with no bracket at
 * all is unchanged, and the second pass is where a written backslash starts
 * eating itself.
 */

import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve } from '../src/index.js'
import type { Document } from '../src/ast.js'

const fmt = (src: string): string => carveToCarve(src)

/** Every value of `key` in the parsed tree, in document order. */
function labelsIn(src: string, key: 'label' | 'id'): unknown[] {
  const found: unknown[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record[key] === 'string') found.push(record[key])
    for (const value of Object.values(record)) walk(value)
  }
  walk(parse(src))
  return found
}

describe('a raw bracketed run is written verbatim', () => {
  // The four documents markup-carve/carve#1206 had to declare in the spec's
  // `resources/engine-fmt-drift.txt`, as their authored bytes.
  const declared: Array<[string, string]> = [
    ['a balanced bracket in alt text', 'a ![t[z]](/i.png) b\n'],
    ['an escaped bracket in alt text', 'a ![t\\]z](/i.png) b\n'],
    ['a bracket inside a code span in alt text', 'a ![t`]`z](/i.png) b\n'],
    ['a bracket inside an editorial comment in alt text', 'a ![t{# ] #}z](/i.png) b\n'],
  ]

  for (const [name, src] of declared) {
    it(`${name}: writes the source back byte for byte`, () => {
      expect(fmt(src)).toBe(src)
    })

    it(`${name}: is idempotent`, () => {
      const once = fmt(src)
      expect(fmt(once)).toBe(once)
    })

    it(`${name}: preserves what the document says`, () => {
      expect(carveToHtml(fmt(src))).toBe(carveToHtml(src))
    })
  }

  it('keeps the alt value out of the escape, not merely the shape', () => {
    // The assertion the round trip alone would not make: the attribute the
    // reader hands the renderer, in full.
    expect(carveToHtml(fmt('a ![t[z]](/i.png) b\n'))).toBe(
      '<p>a <img src="/i.png" alt="t[z]"> b</p>',
    )
  })

  it('does not grow a backslash on the second pass', () => {
    // The compounding, isolated: an alt whose only special character is a
    // backslash. One pass already looked correct here before the fix - the
    // input has no bracket - and the second pass is where it broke.
    const src = 'a ![t\\z](/i.png) b\n'
    expect(fmt(src)).toBe(src)
    expect(fmt(fmt(src))).toBe(src)
  })
})

describe('a flat raw bracketed run is written verbatim too', () => {
  // The same rule at the other four call sites. These readers scan `[^\]]*`
  // and stop at the first `]`, so the run holds no bracket - but it does hold
  // a backslash, and every one of these grew one per format pass.
  //
  // The third assertion reads the VALUE back out of the tree rather than
  // comparing HTML. A footnote id and a code-fence label are not rendered, so
  // `toHtml(fmt(x)) == toHtml(x)` holds for them however mangled the label
  // gets - it is an assertion that cannot fail, and the two constructs whose
  // drift is invisible are exactly the ones that need a check that can.
  const flat: Array<[string, string, (src: string) => unknown]> = [
    ['a footnote label', 'a[^n\\m]\n\n[^n\\m]: body\n', (s) => labelsIn(s, 'id')],
    ['an admonition label', '::: note [a\\b]\nx\n:::\n', (s) => labelsIn(s, 'label')],
    ['a div label', '::: [a\\b]\nx\n:::\n', (s) => labelsIn(s, 'label')],
    ['a code-fence label', '```js [a\\b]\nx\n```\n', (s) => labelsIn(s, 'label')],
  ]

  for (const [name, src, value] of flat) {
    it(`${name}: writes the source back byte for byte`, () => {
      expect(fmt(src)).toBe(src)
    })

    it(`${name}: is idempotent`, () => {
      const once = fmt(src)
      expect(fmt(once)).toBe(once)
    })

    it(`${name}: keeps the value the reader gives back`, () => {
      expect(value(fmt(src))).toEqual(value(src))
      expect(value(fmt(src))).not.toEqual([])
    })
  }
})

describe('the escape stays where the reader resolves it', () => {
  // CONTROLS. A link's text, an inline note's content and a span's are inline
  // content: an escape inside them IS resolved, so the writer has to put it
  // back or the `]` closes the run early. A fix that reached these would have
  // traded one silent corruption for another.
  const inlineContent: Array<[string, string]> = [
    ['link text', 'a [t\\]z](/u) b\n'],
    ['inline note content', 'a ^[t\\]z] b\n'],
    ['span text', 'a [t\\]z]{.c} b\n'],
  ]

  for (const [name, src] of inlineContent) {
    it(`${name}: keeps the backslash the reader consumes`, () => {
      expect(fmt(src)).toBe(src)
      expect(carveToHtml(fmt(src))).toBe(carveToHtml(src))
    })
  }

  it('an abbreviation definition is untouched', () => {
    const src = '*[HTML]: HyperText Markup Language\n\nHTML\n'
    expect(fmt(src)).toBe(src)
  })
})

describe('an alt text with no Carve spelling', () => {
  // `parse` cannot produce one - an unbalanced `]` ends the run, so the image
  // never forms - but an ingested AST can. The escape is not a representation
  // of that value either; what it buys is a well-formed image instead of a
  // stray `]` splitting the line, and it SETTLES, because the escaped alt is
  // itself representable.
  const doc = (alt: string): Document =>
    ({
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'image', alt, src: '/i.png' }] }],
    }) as unknown as Document

  it('falls back to the escape', () => {
    expect(renderCarve(doc('t]z'))).toBe('![t\\]z](/i.png)\n')
  })

  it('settles on the pass after the fallback', () => {
    const once = renderCarve(doc('t]z'))
    expect(fmt(once)).toBe(once)
  })

  it('does not take the fallback for a run that closes', () => {
    // The other side of the branch, so a fallback that swallowed every input
    // would fail here rather than pass everything.
    expect(renderCarve(doc('t[z]'))).toBe('![t[z]](/i.png)\n')
  })
})
