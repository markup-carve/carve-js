/**
 * Corpus `.fmt` sidecars this engine has DELIBERATELY moved PAST the pinned
 * corpus on.
 *
 * The same declaration `corpus.test.ts` and `html-import-conformance.test.ts`
 * carry, for the same reason: an engine ahead of a pinned fixture is a normal
 * state between two pin bumps, and what is not normal is not knowing which
 * window you are in. Each entry FAILS IN BOTH DIRECTIONS - the writer must
 * produce exactly what the CURRENT spec states, so a regression is caught as
 * the sidecar would have caught it, and the pinned bytes must still DIFFER, so
 * the entry has to be deleted in the commit that moves the pin.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE TWO SUITES READ THESE SIDECARS.
 * `corpus-canonical-form.test.ts` reads them as PART 11 §2's canonical bytes and
 * `corpus-render-fixtures.test.ts` reads them as one of four render targets.
 * Declared inside either one, the other would still fail on the same documents
 * for the same reason - one rule with two spellings, which is the shape
 * markup-carve/carve#755 catalogs and the shape this whole ruling came out of.
 * That is why the file stays when the map is empty: the next window has one
 * home rather than two.
 *
 * The four entries are the tables PART 11 §6h [CARVE-P11-066] reaches
 * (markup-carve/carve#2894): `table.separatorWidths` records that the author
 * wrote a separator row, and the writer reproduces it instead of rewriting the
 * header as `|=` cells. Each pinned sidecar is the `|=` form the clause
 * replaces, so each of these four now round-trips its source EXACTLY - which is
 * the clause's whole point and why the pinned bytes are the stale half here.
 *
 * An earlier window held four entries for markup-carve/carve#1757, when ONE
 * SPACE became the canonical definition separator; upstream re-cut those and
 * they went out with the bump that reached them. These go out the same way.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  [
    '284-a-ragged-table-keeps-each-row-s-cell-count-2',
    {
      reason: 'the authored separator row is written where the author wrote one ([CARVE-P11-066])',
      fmt: '| | x |\n|---|\n| y |\n',
    },
  ],
  [
    '284-a-ragged-table-keeps-each-row-s-cell-count-3',
    {
      reason: 'the authored separator row is written where the author wrote one ([CARVE-P11-066])',
      fmt: '| h |\n|---|\n| | x |\n',
    },
  ],
  [
    '285-adjacent-block-openers-in-an-attached-run-stay-separate-2',
    {
      reason: 'the authored separator row is written where the author wrote one ([CARVE-P11-066])',
      fmt: '- x\n+\n| a |\n|---|\n| b |\n+\n| a |\n|---|\n| b |\n',
    },
  ],
  [
    '99-table-cell-attributes',
    {
      reason: 'the authored separator row is written where the author wrote one ([CARVE-P11-066])',
      fmt: '|{.highlight} Total | 99 |\n|---|---|\n| a | b |\n',
    },
  ],
])
