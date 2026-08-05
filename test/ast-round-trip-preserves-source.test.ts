/*
 * A document that goes through the published AST and back must come out as the
 * SAME SOURCE, not merely as the same HTML (carve-js#738).
 *
 * The HTML check cannot see this class of change. `to_html(fmt(x)) == to_html(x)`
 * (PART 11 §1) holds while the writer adds an attribute line the author never
 * typed, because the attribute it adds is the id the renderer was going to emit
 * anyway. So the invariant stays true and the author's document is still
 * rewritten.
 *
 * The live example: `resolveHeadingIds` stamps a generated id into the tree and
 * `toAstJson` publishes it, which PART 12 §5 asks for. On the wire the only
 * thing separating a generated id from an authored one is the absence of the
 * `#id` slot in `attrs.order` - and `order` is also absent on a
 * programmatically built tree, so ingest cannot tell them apart and treats the
 * id as authored. `# Notes` twice comes back as `{#Notes}` / `# Notes` and
 * `{#Notes-2}` / `# Notes`.
 *
 * carve-php has this assertion (`AstCodecTest::testEveryCorpusDocumentEncodes
 * IdenticallyAfterARoundTrip`) and it is why the same change is caught there and
 * not here. The spec question - whether the wire should mark a generated id, or
 * ingest should treat it as authored deliberately - is markup-carve/carve#814.
 * This test does not take a side: it fails while source is lost, whatever the
 * eventual answer, and the documents it currently names are listed so the gap is
 * visible rather than silent.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, carveToAstJson, fromAstJson } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

/**
 * Documents whose source is NOT preserved through the AST today.
 *
 * A RATCHET, not a verdict. Each entry is a document where writing the resolved
 * tree back differs from writing the parsed tree back - which is what an editor
 * does when it round-trips through the published AST. The heading-id case is
 * classified (carve-js#738, spec markup-carve/carve#814); the rest are recorded
 * as observed and are NOT all known to be defects, since resolution legitimately
 * changes some nodes and the writer is entitled to reflect that.
 *
 * The value is the boundary: a new document joining this list means a change
 * started losing source that did not before, and that is worth knowing whatever
 * the eventual ruling on the entries already here.
 */
const KNOWN_LOSSES = new Set<string>([
  "02-headings-2.crv",
  "02-headings-4.crv",
  "02-headings-6.crv",
  "02-headings.crv",
  "03-links-11.crv",
  "03-links-12.crv",
  "03-links-13.crv",
  "111-cross-references-resolve-inside-footnote-bodies.crv",
  "118-cyclic-cross-reference-resolves-to-one-level-2.crv",
  "118-cyclic-cross-reference-resolves-to-one-level-3.crv",
  "118-cyclic-cross-reference-resolves-to-one-level.crv",
  "119-trojan-source-heading-ids-are-nfc-normalized-and-strip-invisible-controls-2.crv",
  "119-trojan-source-heading-ids-are-nfc-normalized-and-strip-invisible-controls-3.crv",
  "119-trojan-source-heading-ids-are-nfc-normalized-and-strip-invisible-controls.crv",
  "122-footnotes-placement.crv",
  "15-heading-ids-2.crv",
  "15-heading-ids-3.crv",
  "15-heading-ids-4.crv",
  "15-heading-ids-5.crv",
  "15-heading-ids-6.crv",
  "15-heading-ids.crv",
  "170-headings-inside-containers-are-not-wrapped.crv",
  "173-implicit-heading-references-with-no-definition.crv",
  "204-a-heading-in-a-footnote-body-takes-an-id-but-no-section-wrapper.crv",
  "213-a-tag-inside-a-literal-brace-run-is-still-a-tag.crv",
  "217-a-heading-id-keeps-a-non-ascii-space.crv",
  "221-a-heading-reference-folds-unicode-normalization-but-not-compatibility.crv",
  "26-comments-5.crv",
  "35-cross-reference.crv",
  "71-attribute-edge-cases-13.crv",
  "75-list-nesting-and-looseness-4.crv",
  "75-list-nesting-and-looseness-7.crv",
  "81-paragraph-interruption-18.crv",
  "81-paragraph-interruption.crv",
  "82-blockquote-lazy-continuation-3.crv",
  "82-blockquote-lazy-continuation-4.crv",
  "84-single-line-headings-2.crv",
  "84-single-line-headings-3.crv",
  "84-single-line-headings-4.crv",
  "84-single-line-headings.crv",
  "86-list-lazy-continuation-2.crv",
])

describe('a document round-tripped through the AST', () => {
  const sources = existsSync(corpusDir)
    ? readdirSync(corpusDir).filter((f) => f.endsWith('.crv'))
    : []

  it('finds the corpus', () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  it('comes back as the same source', () => {
    const lost: string[] = []
    for (const name of sources) {
      const src = readFileSync(resolve(corpusDir, name), 'utf8')
      let written: string
      try {
        // `carveToAstJson`, NOT `toAstJson(parse(src))`: the ids this is about
        // are stamped during RESOLVE, and the second form never resolves - so a
        // test written that way passes while the defect it names is live.
        const back = fromAstJson(carveToAstJson(src))
        written = renderCarve(back)
      } catch {
        // A document the codec refuses is a different failure, and the codec's
        // own tests cover it; this assertion is about silent CHANGE, not about
        // errors.
        continue
      }
      // Compared against the formatter's own output for the same document, not
      // against the raw source: `fmt` legitimately normalizes spelling, and what
      // this test is about is whether the AST ROUND TRIP changes anything the
      // formatter would not have changed by itself.
      const direct = renderCarve(parse(src))
      if (written !== direct && !KNOWN_LOSSES.has(name)) lost.push(name)
    }
    expect(lost, `documents whose source changed through the AST: ${lost.join(', ')}`).toEqual([])
  })
})
