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
import { expectedCorpusSize } from './helpers/corpus-population.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

/**
 * Documents whose source is NOT preserved through the AST today.
 *
 * A RATCHET, not a verdict. Each entry is a document where writing the resolved
 * tree back differs from writing the parsed tree back - which is what an editor
 * does when it round-trips through the published AST.
 *
 * WAS 41, NOW 2. The 39 generated-heading-id documents are gone: publishing the
 * id is right (PART 12 §5), and 7f86472 stopped the WRITER emitting it, because
 * an authored id carries its `#id` slot in `attrs.order` and a generated one
 * does not. carve-php#901 established that mechanism.
 *
 * What remains is one cause, and it is an open spec question rather than a bug
 * anyone has declined to fix:
 *
 *    2  A NESTED LINK or an AUTOLINK inside a link label is flattened into text
 *       on the wire, so `[[x](y)](z)` comes back as `[x](z)` - the inner
 *       destination is not in the tree at all - and `[pre <http://h> post](/u)`
 *       comes back with a bare URL where an autolink was. All three engines
 *       flatten identically; markup-carve/carve#817 asks what §3a requires.
 *
 * The value is the boundary: a document joining this list means a change started
 * losing source that did not before, and a THIRD cause appearing is the thing
 * most worth knowing.
 */
const KNOWN_LOSSES = new Set<string>([
  "03-links-11.crv",
  "03-links-12.crv",
  // The write-back that keeps a definition on its own description line
  // (carve-js#748) reads `definitionLines` off the definition-list item, and
  // that field does not cross the wire: PART 12 §8 publishes the entry as
  // `definition_term` / `definition_description` nodes, so a DECODED item has
  // the description but not the line it was written on. Formatting from source
  // is byte-exact for these two; formatting a decoded tree is not.
  //
  // The list-item case next to it does survive, because it is derived from the
  // surrounding blocks' own positions rather than from a side table
  // (carve-js#754). Reconstructing `definitionLines` from the wire's
  // `definition_description` position would close this the same way.
  "227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace.crv",
  "227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace-2.crv",
])

describe('a document round-tripped through the AST', () => {
  const sources = existsSync(corpusDir)
    ? readdirSync(corpusDir).filter((f) => f.endsWith('.crv'))
    : []

  it('finds the corpus', () => {
    expect(sources.length).toBe(expectedCorpusSize(resolve(__dirname, '../spec')))
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
