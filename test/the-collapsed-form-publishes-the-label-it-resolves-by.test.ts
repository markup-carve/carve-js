import { describe, it, expect } from 'vitest'
import {
  parse,
  resolve,
  carveToHtml,
  carveToCarve,
  lintCarve,
  toAstJson,
  fromAstJson,
} from '../src/index.js'
import type { Link, Paragraph, Section } from '../src/ast.js'

/*
 * PART 12 §3a, THE COLLAPSED FORM PUBLISHES THE LABEL IT RESOLVES BY
 * (markup-carve/carve#962, markup-carve/carve-js#874):
 *
 *   For the collapsed form `[getting started][]`, `ref` is the DERIVED label
 *   (`getting started`) - the label the reference resolves by. `rawRef` holds
 *   the authored spelling, so the empty brackets are not lost.
 *
 * carve-js published the AUTHORED spelling in `ref`, which is what `rawRef` is
 * already for. Two fields carried one string, and the one field §3a defines as
 * the resolution key named something the reference did not resolve by - a
 * consumer reading it would have had to re-derive the key the engine had just
 * computed. The corpus pins the result: `275-...-2` renders
 * `href="#code-heading"`, a slug of the heading's RENDERED text `code()
 * heading`, and the category is named after it.
 *
 * WHICH KEY ANSWERED IS THE WHOLE RULE. R1 offers the heading index two keys in
 * order - the label AS WRITTEN, then its rendered plain text - and `ref` follows
 * the one that answered. So the derivation fires for exactly the references
 * whose authored spelling is NOT what reached the heading, and for no others:
 *
 *   - a linkDefs match keys on the label as written, so it never derives
 *     (corpus 193 and 275-3, both of which this engine already agreed on with
 *     carve-php, and both of which a blanket strip would have inverted);
 *   - an unresolved reference resolves by nothing, so it never derives;
 *   - a FULL `[text][label]` does not reach the index at all
 *     (markup-carve/carve#742), so it never derives;
 *   - a label with no markup derives to itself byte for byte, so the plain case
 *     is a genuine control rather than a case that merely happens to pass.
 */
const linkOf = (source: string): Link => {
  const doc = resolve(parse(source))
  const blocks = doc.children.flatMap((n) =>
    n.type === 'section' ? (n as Section).children : [n],
  )
  const para = blocks.find((n) => n.type === 'paragraph') as Paragraph
  const link = para.children.find((n) => n.type === 'link') as Link
  expect(link).toBeDefined()
  return link
}

describe('a collapsed reference that reaches a heading by its rendered text', () => {
  it('publishes the DERIVED label in ref and the authored spelling in rawRef', () => {
    // Corpus 275-2, the document the three-way value comparison reported.
    const link = linkOf('# `code()` heading\n\n[`code()` heading][]\n')
    expect(link.ref).toBe('code() heading')
    expect(link.rawRef).toBe('[`code()` heading][]')
    expect(link.href).toBe('#code-heading')
  })

  it('does it for every inline markup kind, not the one the report showed', () => {
    // A fix keyed to backticks would pass the row above and nothing else.
    const rows: Array<[string, string]> = [
      ['*bold* heading', 'bold heading'],
      ['/italic/ heading', 'italic heading'],
      ['`code()` heading', 'code() heading'],
      ['_underline_ heading', 'underline heading'],
      ['~strike~ heading', 'strike heading'],
      ['=highlight= heading', 'highlight heading'],
      ['[link](/u) heading', 'link heading'],
      ['[span]{.c} heading', 'span heading'],
      ['{^sup^} heading', 'sup heading'],
      ['{,sub,} heading', 'sub heading'],
      ['*/nested/* heading', 'nested heading'],
    ]
    const got = rows.map(([label]) => linkOf(`# ${label}\n\n[${label}][]\n`).ref)
    expect(got).toEqual(rows.map(([, derived]) => derived))
  })

  it('derives escapes and smart punctuation by the same rule', () => {
    // Neither is "inline markup", and both make the authored spelling differ
    // from what the heading index compared, so both derive. One derivation
    // covers all three because all three are the same question: what does the
    // label render as.
    const escaped = linkOf('# \\*bold\\* heading\n\n[\\*bold\\* heading][]\n')
    expect(escaped.ref).toBe('*bold* heading')
    expect(escaped.rawRef).toBe('[\\*bold\\* heading][]')

    const dashed = linkOf('# a -- b\n\n[a -- b][]\n')
    expect(dashed.ref).toBe('a – b')
    expect(dashed.rawRef).toBe('[a -- b][]')
  })

  it('derives the label, it does not NORMALIZE it', () => {
    // Case folding, whitespace collapse, trimming and NFC belong to MATCHING.
    // A fix that published `headingRefKeyFromLabel`'s output would fold the
    // case of every collapsed reference in every document to make this one
    // right - and `[Getting Started][]` under `# getting started` has always
    // published `Getting Started`.
    const link = linkOf('# *bold* heading\n\n[*Bold*  Heading][]\n')
    expect(link.ref).toBe('Bold  Heading')
    expect(link.href).toBe('#bold-heading')
  })

  it('CONTROL a label with no markup publishes the authored spelling unchanged', () => {
    const link = linkOf('# Getting Started\n\n[Getting Started][]\n')
    expect(link.ref).toBe('Getting Started')
    expect(link.rawRef).toBe('[Getting Started][]')
  })

  it('CONTROL a case-folded or whitespace-collapsed plain label is untouched', () => {
    const link = linkOf('#   Getting    Started\n\n[getting started][]\n')
    expect(link.ref).toBe('getting started')
  })

  it('CONTROL a linkDefs match keys on the label AS WRITTEN, so it never derives', () => {
    // Corpus 193: the definition's label carries the markup, and the reference
    // matched it character for character. Deriving here would name a key that
    // resolves nothing.
    const viaDef = linkOf('[*bold*]: /x\n\n[*bold*][]\n')
    expect(viaDef.ref).toBe('*bold*')
    expect(viaDef.href).toBe('/x')

    // Corpus 275-3: a definition and a same-named heading both exist, and the
    // definition wins. The reference resolved by the AUTHORED label.
    const defBeatsHeading = linkOf('[*bold* heading]: /x\n\n# *bold* heading\n\n[*bold* heading][]\n')
    expect(defBeatsHeading.ref).toBe('*bold* heading')
    expect(defBeatsHeading.href).toBe('/x')
  })

  it('CONTROL an unresolved reference resolves by nothing, so it never derives', () => {
    const link = linkOf('[`code()` nothing][]\n')
    expect(link.ref).toBe('`code()` nothing')
    expect(link.rawRef).toBe('[`code()` nothing][]')
    expect(link.href).toBe('')
  })

  it('CONTROL a FULL reference does not reach the index, so it never derives', () => {
    // markup-carve/carve#742: the explicit spelling is an identifier, and an
    // identifier that names nothing names nothing.
    const link = linkOf('# `code()` heading\n\n[`code()` heading][`code()` heading]\n')
    expect(link.ref).toBe('`code()` heading')
    expect(link.href).toBe('')
  })

  it('prefers the heading whose text literally CONTAINS the markup characters', () => {
    // The as-written key answered, so there is nothing to derive - deriving
    // would replace the key that worked with one that does not.
    const link = linkOf('# `*bold* heading`\n\n# bold heading\n\n[*bold* heading][]\n')
    expect(link.href).toBe('#bold-heading')
    expect(link.ref).toBe('*bold* heading')
  })

  it('survives a wire round trip, at either stage, and resolves idempotently', () => {
    // The derivation rewrites a field the tree is SERIALIZED from, so a second
    // resolve() - of the same tree, or of one ingested back off the wire - must
    // reach the same answer. `isCollapsedRef` reads `rawRef`, which the
    // derivation leaves alone, and `href` is already set, so neither pass
    // re-enters. Both stages the schema accepts are checked: the pre-resolve
    // tree carries the authored `ref` and derives on ingest, the post-resolve
    // tree carries the derived one and does not move.
    const src = '# `code()` heading\n\n[`code()` heading][]\n'
    const linkIn = (doc: unknown): Link => {
      let found: Link | undefined
      JSON.stringify(doc, (_k, v) => {
        if (v && (v as Link).type === 'link') found = v as Link
        return v
      })
      expect(found).toBeDefined()
      return found as Link
    }

    const once = resolve(parse(src))
    expect(linkIn(resolve(once)).ref).toBe('code() heading')

    const clone = (v: unknown) => JSON.parse(JSON.stringify(v))
    const postWire = resolve(fromAstJson(clone(toAstJson(once))))
    expect(linkIn(postWire).ref).toBe('code() heading')
    expect(linkIn(postWire).rawRef).toBe('[`code()` heading][]')
    expect(linkIn(postWire).href).toBe('#code-heading')

    const preWire = fromAstJson(clone(toAstJson(parse(src))))
    expect(linkIn(preWire).ref).toBe('`code()` heading')
    expect(linkIn(resolve(preWire)).ref).toBe('code() heading')
  })

  it('CONTROL the rendered HTML and the canonical source are untouched', () => {
    // `ref` is a wire field. The derivation must not reach either renderer:
    // the anchor text comes from the label's own children, and the formatter
    // writes `rawRef`.
    //
    // A CONTROL rather than a guard on this pass, and the mutation run says so:
    // clobbering `rawRef` with the derived label right here did not move either
    // string, because `carveToCarve` is PARSE-ONLY and never runs resolve() at
    // all. The row is worth keeping - it is the invariant a future change to
    // the formatter would break - but it cannot fail for anything done here.
    const src = '# `code()` heading\n\n[`code()` heading][]\n'
    expect(carveToHtml(src)).toBe(
      '<section id="code-heading">\n  <h1><code>code()</code> heading</h1>\n' +
        '  <p><a href="#code-heading"><code>code()</code> heading</a></p>\n</section>',
    )
    expect(carveToCarve(src)).toContain('[`code()` heading][]')
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('CONTROL lint does not mirror the derivation, because it reads the parse tree', () => {
    // `lintCarve` runs on `parse()`, before this pass, and its own mirror only
    // ever asks WHETHER the index answers - never with which key. A rule that
    // predicted the authored spelling would now contradict the engine.
    //
    // The mirror in `lint.ts` was the surface to check: it duplicated the
    // resolver for markup-carve/carve#742 and had to move with it. It does not
    // move for this one, and no mutation of this pass can make this row fail -
    // which is exactly the claim, so it is pinned as a CONTROL.
    expect(lintCarve('# `code()` heading\n\n[`code()` heading][]\n')).toEqual([])
    expect(
      lintCarve('# `code()` heading\n\n[`other()` heading][]\n').map((w) => w.rule),
    ).toEqual(['unresolved-reference-link'])
  })
})
