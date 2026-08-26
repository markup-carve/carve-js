import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * A DEFINITION BODY'S SEPARATOR IS ANY RUN OF SPACES, ITS WIDTH SETS THE BODY'S
 * CONTENT COLUMN, AND ONE SPACE IS CANONICAL (PART 9 §16, ruled in
 * markup-carve/carve#1757).
 *
 * The body marker used to demand TWO spaces and hand every width the same fixed
 * column 3. That made the definition body the only marker in the language that
 * would not take a single separator space - `- item`, `1. item`, `> quote` and
 * `:: term` all do - and the only one that measured its separator against a
 * fixed width rather than its own. A bullet has always answered this way:
 * `-   first` puts its content column at 4 and a continuation at 2 does not
 * reach it.
 *
 * THESE ARE THE SPEC'S OWN SEVEN DOCUMENTS, written out rather than read from
 * the submodule. They were the only place this coverage could live while the pin
 * predated category `424-a-definition-body-s-separator-width-sets-its-content-
 * column`: `corpus.test.ts` cannot run a category the pinned corpus does not
 * carry, and `AHEAD_OF_PIN` there refuses a slug that is not in it. The pin has
 * since reached it and the category is in the corpus runner's IMPLEMENTED list,
 * so these are now the second reading of a rule the corpus also checks - the
 * state every other ruling in this engine is already in. Each `it` below names
 * the document it carries.
 */

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()

describe("a definition body's separator width sets its content column", () => {
  it('takes a one-space separator (424)', () => {
    expect(flat(carveToHtml(':: term\n: definition\n'))).toBe(
      '<dl> <dt>term</dt> <dd>definition</dd> </dl>',
    )
  })

  it('folds a continuation that reaches the one-space body at column 2 (424-2)', () => {
    expect(flat(carveToHtml(':: term\n: first\n\n  second\n'))).toBe(
      '<dl> <dt>term</dt> <dd> <p>first</p> <p>second</p> </dd> </dl>',
    )
  })

  it('leaves the body when the continuation does not reach column 2 (424-3)', () => {
    expect(flat(carveToHtml(':: term\n: first\n\n second\n'))).toBe(
      '<dl> <dt>term</dt> <dd>first</dd> </dl> <p>second</p>',
    )
  })

  /*
   * THE CONTROL, and it is the row the whole rule turns on.
   *
   * The document is 424-2's continuation under a TWO-space separator, so the
   * body's column is 3 and the line at 2 no longer reaches it. An engine that
   * shipped the one-space reading by moving every separator to column 2 passes
   * the three rows above and fails here; one that left the column hard-coded at
   * 3 passes here and fails those. Only a column derived from the separator's
   * own width answers both, which is why this document keeps the answer it had
   * before carve#1757 and must go on keeping it.
   */
  it('CONTROL: a two-space separator keeps column 3, so the same line leaves (424-4)', () => {
    expect(flat(carveToHtml(':: term\n:  first\n\n  second\n'))).toBe(
      '<dl> <dt>term</dt> <dd>first</dd> </dl> <p>second</p>',
    )
  })

  it('accepts both spellings in one list (424-5)', () => {
    expect(flat(carveToHtml(':: term\n: one\n:  two\n'))).toBe(
      '<dl> <dt>term</dt> <dd>one</dd> <dd>two</dd> </dl>',
    )
  })

  it('takes the first-block `+` form on the narrow width (424-6)', () => {
    expect(flat(carveToHtml(':: term\n: +\nflush block\n'))).toBe(
      '<dl> <dt>term</dt> <dd>flush block</dd> </dl>',
    )
  })

  it('reads a colon line below a folding term as the body (424-7)', () => {
    expect(flat(carveToHtml(':: term\nwrapped on\n: definition\n'))).toBe(
      '<dl> <dt>term wrapped on</dt> <dd>definition</dd> </dl>',
    )
  })

  /*
   * THE COLUMN IS DERIVED, NOT PICKED FROM A SET OF TWO. `:    x` is column 5,
   * which no corpus document reaches - the category stops at two spaces, so a
   * pair of hard-coded branches would satisfy every row above.
   */
  it('derives the column from the width at every run length', () => {
    for (const width of [1, 2, 3, 4, 7]) {
      const sep = ' '.repeat(width)
      const reaches = ' '.repeat(1 + width)
      const short = ' '.repeat(width)

      expect(flat(carveToHtml(`:: t\n:${sep}first\n\n${reaches}second\n`)), `width ${width}`).toBe(
        '<dl> <dt>t</dt> <dd> <p>first</p> <p>second</p> </dd> </dl>',
      )
      expect(flat(carveToHtml(`:: t\n:${sep}first\n\n${short}second\n`)), `width ${width}`).toBe(
        '<dl> <dt>t</dt> <dd>first</dd> </dl> <p>second</p>',
      )
    }
  })

  /*
   * A CONTENT-LESS MARKER LINE IS CONTENT-LESS AT EVERY WIDTH, and being
   * content-less it opens nothing: the line is plain text under the open term,
   * which folds it as a soft break and drops its trailing run
   * (markup-carve/carve#1830).
   *
   * Written down because the answer used to depend on the width: `:` plus three
   * or more spaces backtracked into a body of one space, which trims to an empty
   * `<dd>`, while `:` plus exactly two did not. Nothing pinned either. The
   * greedy separator settled the width question, and the ruling settled what the
   * content-less line then does.
   */
  it('reads a marker line of nothing but spaces as content-less at every width', () => {
    for (const width of [1, 2, 3, 4]) {
      expect(flat(carveToHtml(`:: t\n:${' '.repeat(width)}\nx\n`)), `width ${width}`).toBe(
        '<dl> <dt>t : x</dt> </dl>',
      )
    }
  })

  /*
   * A COLON LINE OPENS A BODY ONLY INSIDE A LIST. Without a `:: term` above it
   * the line is prose, exactly as it was before the narrow separator had a
   * meaning - which is what keeps the writer's declared loss for a `<dd>` with
   * no `<dt>` true (`structure-unspellable`, `html-import.test.ts`).
   */
  it('opens nothing at document level', () => {
    expect(flat(carveToHtml(': not a definition\n'))).toBe('<p>: not a definition</p>')
  })
})

/*
 * THE WRITER'S HALF. One space is canonical, and narrowing the separator
 * narrows the body's column - so a rewrite carries every continuation inside
 * that body down by the same amount. A writer that trims the separator and
 * leaves the body where it sat writes a document that says something else: the
 * payload no longer reaches the column its own marker hands out, and it leaves
 * the `<dd>`.
 */
describe('the writer emits one space and moves the body with it', () => {
  const NARROWS: Array<[string, string, string]> = [
    ['a one-line body', ':: term\n:  definition\n', ':: term\n: definition\n'],
    ['a second paragraph', ':: t\n:  a\n\n   b\n', ':: t\n: a\n\n  b\n'],
    ['a fenced block', ':: t\n:  d\n\n   ```\n   a\n   ```\n', ':: t\n: d\n\n  ```\n  a\n  ```\n'],
    ['a sub-list', ':: t\n:  - a\n\n   - b\n', ':: t\n: - a\n\n  - b\n'],
    ['a hoisted definition on the line', ':: term\n:  [r]: /u\n\nsee [t][r]\n', ':: term\n: [r]: /u\n\nsee [t][r]\n'],
    ['a wider run than canonical', ':: t\n:    d\n\n     e\n', ':: t\n: d\n\n  e\n'],
  ]

  for (const [name, source, expected] of NARROWS) {
    it(`narrows ${name}`, () => {
      expect(carveToCarve(source)).toBe(expected)
      // PART 11 §1: the rewrite says the same thing and is a fixed point.
      expect(carveToHtml(expected)).toBe(carveToHtml(source))
      expect(carveToCarve(expected)).toBe(expected)
    })
  }

  /*
   * THE PROPERTY THE BYTES ARE ABOUT, stated once over every width rather than
   * per row: whatever the author wrote, the written form renders the same
   * document. This is what a writer that narrowed the separator and left the
   * body behind would fail - the continuation would fall out of the `<dd>` -
   * and it is not visible in a single canonical-bytes assertion.
   */
  it('preserves the document at every separator width', () => {
    for (const width of [1, 2, 3, 4, 7]) {
      const source = `:: t\n:${' '.repeat(width)}a\n\n${' '.repeat(1 + width)}b\n`
      const written = carveToCarve(source)

      expect(written, `width ${width}`).toBe(':: t\n: a\n\n  b\n')
      expect(carveToHtml(written), `width ${width}`).toBe(carveToHtml(source))
      expect(flat(carveToHtml(written)), `width ${width}`).toBe(
        '<dl> <dt>t</dt> <dd> <p>a</p> <p>b</p> </dd> </dl>',
      )
    }
  })
})
