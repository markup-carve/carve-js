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
 * The map is empty right now. Its four entries were the sidecars
 * markup-carve/carve#1757 rewrote when it made ONE SPACE the canonical
 * definition separator - narrowing the separator narrows the body's content
 * column, so 279 also carried its fenced block down two columns. Upstream
 * re-cut all four, both suites now read the pinned bytes directly, and the
 * entries went out with the bump that reached them.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map()
