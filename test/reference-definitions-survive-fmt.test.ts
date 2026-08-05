import { describe, it, expect } from 'vitest'
import { parse, carveToCarve, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

/**
 * A resolved reference stays a reference, and its definition line is written back.
 *
 * PART 12 §10 (NORMATIVE) gave a link reference definition a NODE precisely so a
 * writer can reproduce it. Before that it was the one construct with nowhere in the
 * tree to live, which is what forced the writer to INLINE every resolved
 * reference - `[intro][x]` plus `[x]: /intro` came back as `[intro](/intro)` with
 * the definition gone.
 *
 * That broke two things at once. `ref`/`rawRef` - which §3a keeps so `[a][r]` and
 * `[a](/u)` stay distinguishable - were absent from the reparse, and one
 * destination became N after a single pass, which is exactly the duplication the
 * definition form exists to avoid (carve-js#690, carve#642).
 *
 * An UNUSED definition survives for the same reason: it is a node now, so there is
 * something to write.
 *
 * Checked against carve-php byte-for-byte, which landed this first. Corpus-wide,
 * the `carve` target went from 30 differing documents to 2 - and in both of those
 * carve-php is the one losing content (it drops an `#id` from a definition's
 * attribute block), so they are deliberately not matched here.
 */

const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('a link reference definition', () => {
  it('is a node in the parsed tree', () => {
    const doc = parse('Read the [intro][x] first.\n\n[x]: /intro\n')
    expect(doc.children.map((c) => c.type)).toEqual(['paragraph', 'link_reference_definition'])
    const def = doc.children[1] as never as { label: string; href: string; pos?: object }
    expect(def.label).toBe('x')
    expect(def.href).toBe('/intro')
    // §4 wants a pos on every node but the root, and §10 says a hoisted
    // definition's span still points at the line the author wrote it on.
    expect(def.pos).toBeDefined()
  })

  it('is written back, with the reference left as a reference', () => {
    const src = 'Read the [intro][x]{.ext} first.\n\n[x]: /intro\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives when nothing references it', () => {
    const src = 'text\n\n[unused]: /u\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('keeps its title and its own attribute block', () => {
    for (const src of ['[t][x]\n\n[x]: /u "T"\n', '[t][x]\n\n[x]: /u {.c}\n']) {
      expect(carveToCarve(src), src).toBe(src)
      expect(roundTrips(src), src).toBe(true)
    }
  })

  it('keeps a collapsed reference collapsed', () => {
    // `[intro][]` must not become `[intro][intro]` or `[intro](/i)`.
    const src = 'See [intro][].\n\n[intro]: /i\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('keeps a reference IMAGE a reference', () => {
    const src = '![a][x]\n\n[x]: /p.png\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('does not duplicate the destination on repeated passes', () => {
    // The concrete harm of inlining: two references to one definition wrote the
    // URL twice, and every later pass kept it that way.
    const src = '[a][x] and [b][x]\n\n[x]: /u\n'
    const once = carveToCarve(src)
    expect(once).toBe(src)
    expect(carveToCarve(once)).toBe(once)
    expect((once.match(/\/u/g) ?? []).length).toBe(1)
  })

  it('renders nothing on the html, markdown and plain targets', () => {
    // The node feeds every link that resolves the label (PART 9R R1); the line
    // itself is not content. carve-php emits nothing for it on these targets too,
    // which is what keeps the two in agreement there.
    const src = 'text\n\n[unused]: /u\n'
    expect(carveToHtml(src).trim()).toBe('<p>text</p>')
    expect(carveToMarkdown(src).trim()).toBe('text')
    expect(carveToPlainText(src).trim()).toBe('text')
  })

  it('leaves an inline link alone', () => {
    // The boundary: nothing here should turn an ordinary link into a reference.
    expect(carveToCarve('[t](/u)\n')).toBe('[t](/u)\n')
  })

  it('leaves an unresolved reference as its verbatim source', () => {
    // No definition, so no node, and the reference stays literal.
    const src = '[t][none]\n'
    expect(carveToCarve(src)).toBe(src)
    expect(parse(src).children.map((c) => c.type)).toEqual(['paragraph'])
  })
})
