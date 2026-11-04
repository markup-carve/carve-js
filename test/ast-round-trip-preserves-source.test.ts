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
 * WAS 41, THEN 2, NOW 0.
 *
 * The 39 generated-heading-id documents went first: publishing the id is right
 * (PART 12 §5), and 7f86472 stopped the WRITER emitting it, because an authored
 * id carries its `#id` slot in `attrs.order` and a generated one does not.
 * carve-php#901 established that mechanism.
 *
 * The last four went WITHOUT ANYONE NOTICING, and that is the reason the guard
 * below exists. Two named nested-link flattening (markup-carve/carve#817) and
 * two named a definition-list `definitionLines` side table that does not cross
 * the wire (carve-js#748, carve-js#754). Re-measured on the pinned corpus,
 * every one of the four round-tripped byte-identically - the set could have
 * been emptied at whatever commit fixed them, and instead it sat here reading
 * as a live, reasoned carve-out (markup-carve/carve-js#1447).
 *
 * Nothing could have said so. The sweep consulted this set in ONE direction: a
 * document that STOPS losing was silently excused, because `has(name)` only
 * ever suppressed a failure and never demanded one. Deleting the four rows
 * makes the ledger honest today; `still loses what it says it loses` below is
 * what stops the same finding recurring the next time a document is renumbered
 * or a writer fix lands quietly.
 *
 * The value is the boundary: a document joining this list means a change
 * started losing source that did not before, and a document LEAVING it without
 * its entry going too is the failure this file could not previously report.
 */
const KNOWN_LOSSES = new Set<string>([
  '226-a-definition-attached-by-a-continuation-marker-is-collected-and-the-item-keeps-no-trace.crv',
  '327-a-continuation-marker-attaches-one-block-and-the-boundary-is-that-block-s-extent-5.crv',
  '384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-3.crv',
  '384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-5.crv',
  '384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-7.crv',
  '384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-11.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-13.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-16.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-17.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-2.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-4.crv',
  '435-the-continuation-marker-s-column-gate-reaches-every-container-7.crv',
  '436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-7.crv',
  '437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-2.crv',
  '437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-3.crv',
  '437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-5.crv',
  '437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-6.crv',
  '498-a-comment-line-s-text-is-content-and-a-block-body-is-payload-3.crv',
  '498-a-comment-line-s-text-is-content-and-a-block-body-is-payload-5.crv',
  '588-a-block-quote-and-a-footnote-body-take-the-first-block-form-3.crv',
  '588-a-block-quote-and-a-footnote-body-take-the-first-block-form-4.crv',
  '588-a-block-quote-and-a-footnote-body-take-the-first-block-form-5.crv',
  '588-a-block-quote-and-a-footnote-body-take-the-first-block-form-7.crv',
  '588-a-block-quote-and-a-footnote-body-take-the-first-block-form-8.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-2.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-3.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-4.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-5.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-6.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-7.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-8.crv',
  '626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-2.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-3.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-4.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-5.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-6.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload-7.crv',
  '627-a-refused-marker-leaves-an-open-fence-s-blank-payload.crv',
  '628-a-column-zero-marker-below-an-open-div-attaches-beside-the-div-2.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-2.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-3.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-4.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-6.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-7.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-8.crv',
  '629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-10.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-13.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-14.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-16.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-18.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-7.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-9.crv',
  '630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener.crv',
  '631-a-task-item-takes-a-first-block-continuation-marker-after-its-checkbox-4.crv',
  '632-a-continuation-marker-uses-its-container-column-11.crv',
  '632-a-continuation-marker-uses-its-container-column-12.crv',
  '632-a-continuation-marker-uses-its-container-column-13.crv',
  '632-a-continuation-marker-uses-its-container-column-18.crv',
  '632-a-continuation-marker-uses-its-container-column-19.crv',
  '632-a-continuation-marker-uses-its-container-column-20.crv',
  '632-a-continuation-marker-uses-its-container-column-28.crv',
  '632-a-continuation-marker-uses-its-container-column-29.crv',
  '632-a-continuation-marker-uses-its-container-column-30.crv',
  '632-a-continuation-marker-uses-its-container-column-31.crv',
  '632-a-continuation-marker-uses-its-container-column-33.crv',
  '632-a-continuation-marker-uses-its-container-column-9.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-10.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-11.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-12.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-14.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-15.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-16.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-18.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-19.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-2.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-20.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-22.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-23.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-24.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-26.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-27.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-28.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-3.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-30.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-31.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-33.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-34.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-35.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-36.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-37.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-38.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-39.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-4.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-5.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-6.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-7.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-8.crv',
  '633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column.crv',
  '634-a-refused-continuation-plus-remains-text-12.crv',
  '634-a-refused-continuation-plus-remains-text-13.crv',
  '634-a-refused-continuation-plus-remains-text-14.crv',
  '634-a-refused-continuation-plus-remains-text-18.crv',
  '634-a-refused-continuation-plus-remains-text-19.crv',
  '634-a-refused-continuation-plus-remains-text-2.crv',
  '634-a-refused-continuation-plus-remains-text-20.crv',
  '634-a-refused-continuation-plus-remains-text-23.crv',
  '634-a-refused-continuation-plus-remains-text-24.crv',
  '634-a-refused-continuation-plus-remains-text-25.crv',
  '634-a-refused-continuation-plus-remains-text-26.crv',
  '634-a-refused-continuation-plus-remains-text-27.crv',
  '634-a-refused-continuation-plus-remains-text-28.crv',
  '634-a-refused-continuation-plus-remains-text-3.crv',
  '634-a-refused-continuation-plus-remains-text-30.crv',
  '634-a-refused-continuation-plus-remains-text-31.crv',
  '634-a-refused-continuation-plus-remains-text-32.crv',
  '634-a-refused-continuation-plus-remains-text-33.crv',
  '634-a-refused-continuation-plus-remains-text-35.crv',
  '634-a-refused-continuation-plus-remains-text-36.crv',
  '634-a-refused-continuation-plus-remains-text-37.crv',
  '634-a-refused-continuation-plus-remains-text-38.crv',
  '634-a-refused-continuation-plus-remains-text-39.crv',
  '634-a-refused-continuation-plus-remains-text-4.crv',
  '634-a-refused-continuation-plus-remains-text-40.crv',
  '634-a-refused-continuation-plus-remains-text-6.crv',
  '634-a-refused-continuation-plus-remains-text.crv',
  '646-a-quote-prefixed-plus-takes-one-space-after-each-quote-marker-and-attaches-a-quote-2.crv',
  '649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-2.crv',
  '649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-3.crv',
  '649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-4.crv',
  '649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-5.crv',
  '649-a-first-block-plus-refuses-a-follower-at-an-intervening-column.crv',
  '650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line-3.crv',
  '651-a-stacked-first-block-plus-takes-a-follower-only-at-its-innermost-opener-s-marker-column-3.crv',
  '651-a-stacked-first-block-plus-takes-a-follower-only-at-its-innermost-opener-s-marker-column.crv',
  '652-a-quote-s-first-block-plus-takes-a-list-that-carries-its-quote-prefixes-at-its-marker-column-2.crv',
  '652-a-quote-s-first-block-plus-takes-a-list-that-carries-its-quote-prefixes-at-its-marker-column-3.crv',
  '654-a-quote-follower-below-stacked-quote-openers-in-an-item-is-read-at-its-raw-column.crv',
  '655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix-2.crv',
  '655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix-3.crv',
  '655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix.crv',
  '656-the-column-of-the-quote-that-owns-a-first-block-plus-stays-eligible-at-every-depth-3.crv',
  '662-a-tab-after-a-comment-marker-stays-in-its-text.crv',
  '726-a-second-plus-starts-its-own-paragraph-after-attachment-2.crv',
  '726-a-second-plus-starts-its-own-paragraph-after-attachment-3.crv',
  '726-a-second-plus-starts-its-own-paragraph-after-attachment-4.crv',
  '726-a-second-plus-starts-its-own-paragraph-after-attachment.crv',
  '728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-2.crv',
  '728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-3.crv',
  '728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-4.crv',
  '728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item.crv',
  '733-consecutive-continuation-markers-in-a-div-hosted-quote.crv',
  '734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-2.crv',
  '734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-3.crv',
  '734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-4.crv',
  '734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-5.crv',
  '734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block.crv',
  '740-lazy-quote-owners-2.crv',
  '745-the-deepest-quoted-paragraph-takes-a-lazy-line-across-missed-prefixes-3.crv',
  '745-the-deepest-quoted-paragraph-takes-a-lazy-line-across-missed-prefixes.crv',
  '751-a-lazy-line-keeps-its-plus-through-three-quote-levels.crv',
  '757-an-intervening-column-refuses-a-description-hosted-first-block.crv',
  '760-a-heading-past-a-body-hosted-item-s-marker-column-refuses-its-plus-and-opens-in-the-description.crv',
  '782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-10.crv',
  '782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-12.crv',
  '782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-5.crv',
  '782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-6.crv',
  '782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-9.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-2.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-3.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-4.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-5.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-6.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column-8.crv',
  '801-a-footnote-body-refuses-a-first-block-at-its-body-column.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-3.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-4.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-5.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-6.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-7.crv',
  '802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block.crv',
  '806-a-marker-folds-into-the-paragraph-a-first-block-plus-took.crv',
  '811-a-first-block-plus-does-not-take-the-closer-of-its-div-3.crv',
  '811-a-first-block-plus-does-not-take-the-closer-of-its-div-4.crv',
  '811-a-first-block-plus-does-not-take-the-closer-of-its-div.crv',
  '811-a-lazy-line-after-a-narrower-list-in-a-note-folds-into-its-item.crv',
  '815-a-line-below-an-empty-div-after-a-first-block-plus-is-not-lazy-4.crv',
  '815-a-line-below-an-empty-div-after-a-first-block-plus-is-not-lazy.crv',
  '821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column-3.crv',
  '821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column.crv',
  '826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-3.crv',
  '826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus.crv',
  '838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-2.crv',
  '838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-3.crv',
  '838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-4.crv',
  '838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload.crv',
  '838-an-item-on-a-body-s-marker-line-refuses-a-column-zero-block-after-its-plus-2.crv',
  '838-an-item-on-a-body-s-marker-line-refuses-a-column-zero-block-after-its-plus.crv',
  '840-a-refused-plus-reads-like-a-letter-2.crv',
  '840-a-refused-plus-reads-like-a-letter-3.crv',
  '842-a-plus-at-a-stacked-item-s-marker-column-reaches-it-2.crv',
  '842-a-plus-at-a-stacked-item-s-marker-column-reaches-it.crv',
  '846-a-description-left-of-its-term-measures-its-own-plus-follower-2.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-2.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-3.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-4.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-7.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-8.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule-9.crv',
  '851-a-first-block-plus-shape-reads-the-one-attach-rule.crv',
  '851-an-accepted-plus-needs-a-follower-that-reaches-its-host-2.crv',
  '851-an-accepted-plus-needs-a-follower-that-reaches-its-host-3.crv',
  '851-an-accepted-plus-needs-a-follower-that-reaches-its-host.crv',
  '852-a-plus-a-second-plus-follows-hands-the-quote-its-next-block-2.crv',
  '852-a-plus-a-second-plus-follows-hands-the-quote-its-next-block-3.crv',
  '852-a-plus-a-second-plus-follows-hands-the-quote-its-next-block.crv',
  '854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-2.crv',
  '854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-3.crv',
  '854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-5.crv',
  '854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter.crv',
  '855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-2.crv',
  '855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-3.crv',
  '855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-4.crv',
  '855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides.crv',
  '866-an-abbreviation-definition-after-a-plus-is-skipped-like-a-link-definition-4.crv',
  '868-a-refused-plus-after-a-block-a-quote-s-plus-attached-folds-into-the-open-paragraph.crv',
  '871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter-2.crv',
  '871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter-3.crv',
  '871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter.crv',
  '881-an-indented-quote-prefix-keeps-an-invisible-plus-follower-in-its-host-2.crv',
  '881-an-indented-quote-prefix-keeps-an-invisible-plus-follower-in-its-host-3.crv',
  '928-a-multi-line-paragraph-of-only-braced-comments-is-an-invisible-line.crv',
  '929-a-refused-plus-is-escaped-when-the-block-below-would-attach-2.crv',
  '929-a-refused-plus-is-escaped-when-the-block-below-would-attach-3.crv',
  '929-a-refused-plus-is-escaped-when-the-block-below-would-attach-4.crv',
  '929-a-refused-plus-is-escaped-when-the-block-below-would-attach-5.crv',
  '929-a-refused-plus-is-escaped-when-the-block-below-would-attach.crv',
  '933-a-list-marker-in-an-item-ends-a-comment-only-paragraph-4.crv',
  '947-a-quote-s-next-is-not-payload-of-an-item-fence-the-last-block-left-open-3.crv',
  '947-a-quote-s-next-is-not-payload-of-an-item-fence-the-last-block-left-open-4.crv',
  '947-a-quote-s-next-is-not-payload-of-an-item-fence-the-last-block-left-open.crv',
])

/*
 * A KNOWN LOSS THAT NAMES NO CORPUS FILE IS NOT A KNOWN LOSS.
 *
 * The sweep below only consults this set for a document it actually walked, so
 * an entry naming a file the corpus no longer has excuses nothing and still
 * reads as a live, reasoned carve-out. Corpus files carry the spec's ordering
 * number, which shifts whenever a section is inserted upstream, so an entry
 * here goes stale without anything in the diff saying so. Same guard shape as
 * AHEAD_OF_PIN in `test/corpus.test.ts`.
 */
describe('KNOWN_LOSSES', () => {
  it('names only corpus files that exist', () => {
    const files = new Set(existsSync(corpusDir) ? readdirSync(corpusDir) : [])
    const orphaned = [...KNOWN_LOSSES].filter((name) => !files.has(name)).sort()
    expect(
      orphaned,
      'renumbered upstream, or already retired - either way the entry excuses nothing',
    ).toEqual([])
  })
})

describe('a document round-tripped through the AST', () => {
  const sources = existsSync(corpusDir)
    ? readdirSync(corpusDir).filter((f) => f.endsWith('.crv'))
    : []

  it('finds the corpus', () => {
    expect(sources.length).toBe(expectedCorpusSize(resolve(__dirname, '../spec')))
  })

  /**
   * ONE PASS, THREE BUCKETS. The pass is shared so the two directions are
   * measured over the SAME run: a forward half and a staleness half computed
   * from different sweeps could disagree about what the corpus even is.
   */
  const sweep = () => {
    const lost: string[] = []
    const recovered: string[] = []
    const refused: string[] = []
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
        //
        // A DECLARED document is the exception, and it is reported on its own
        // rather than folded into either direction. It is not "still losing" -
        // nothing was compared - and calling it "recovered" would tell whoever
        // deletes the entry something false about why. Its entry no longer
        // describes what happens to it, which is its own finding.
        if (KNOWN_LOSSES.has(name)) refused.push(name)
        continue
      }
      // Compared against the formatter's own output for the same document, not
      // against the raw source: `fmt` legitimately normalizes spelling, and what
      // this test is about is whether the AST ROUND TRIP changes anything the
      // formatter would not have changed by itself.
      const direct = renderCarve(parse(src))
      const loses = written !== direct
      if (loses && !KNOWN_LOSSES.has(name)) lost.push(name)
      // THE STALENESS HALF. Without it `has(name)` can only ever suppress a
      // failure, so an entry outlives the loss it names and no run objects -
      // which is exactly how the four this file used to carry survived.
      if (!loses && KNOWN_LOSSES.has(name)) recovered.push(name)
    }
    return { lost, recovered, refused }
  }

  it('comes back as the same source', () => {
    const { lost } = sweep()
    expect(lost, `documents whose source changed through the AST: ${lost.join(', ')}`).toEqual([])
  })

  it('still loses what it says it loses', () => {
    const { recovered, refused } = sweep()
    expect(
      recovered,
      `${recovered.join(', ')} round-trip(s) byte-identically now: delete the KNOWN_LOSSES entry in the same commit that proves it`,
    ).toEqual([])
    expect(
      refused,
      `${refused.join(', ')} is declared a known loss but the codec now refuses it, so the entry describes something that no longer happens`,
    ).toEqual([])
  })
})
