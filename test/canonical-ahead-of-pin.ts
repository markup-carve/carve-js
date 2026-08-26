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
 * Declared inside either one, the other would still fail on the same four
 * documents for the same reason - one rule with two spellings, which is the
 * shape markup-carve/carve#755 catalogs and the shape this whole ruling came
 * out of.
 *
 * The four below are the sidecars markup-carve/carve#1757 rewrote when it made
 * ONE SPACE the canonical definition separator. Narrowing the separator narrows
 * the body's content column, so 279 also carries its fenced block down two
 * columns - a writer that trimmed the marker and left the fence where it sat
 * would write a document that says something else.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map(
  (
    [
      [
        '227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace',
        ':: term\n: [r]: /u\n\nsee [t][r]\n',
      ],
      [
        '227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace-2',
        ':: term\n: [^f]: x\n\nsee[^f]\n',
      ],
      [
        '279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-3',
        ':: t\n: d\n\n  ```\n  a\n\n  b\n  ```\n',
      ],
      [
        '407-one-consumed-boolean-spells-the-looseness-no-blank-line-can-2',
        '{loose}\n:: Term\n: Definition.\n',
      ],
    ] as const
  ).map(([slug, fmt]): [string, { reason: string; fmt: string }] => [
    slug,
    {
      reason:
        'one space is the canonical definition separator and the body moves with it (markup-carve/carve#1757); the pinned sidecar still spells the two-space form',
      fmt,
    },
  ]),
)
