import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Every whitespace slot on a colon-fence opener is a literal space.
 *
 * `resources/grammar.ebnf` PART 7, MARKER SEPARATORS AND PADDING SLOTS, decides
 * the terminal by POSITION rather than by role: "A tab is syntax ONLY in a
 * line's LEADING INDENTATION RUN. From the first non-whitespace character of the
 * line onward a tab is not relevant to syntax at all." Every slot on this line
 * sits after the fence run, so every slot is `space`, and `admonition_open` is
 * spelled `colon_fence:open, space, admonition_type, [space+, quoted_title],
 * [space+, label]`.
 *
 * The two ROLES still exist, but only to decide what a FAILED match means:
 *
 *   - The slot immediately after the fence run is a MARKER SEPARATOR, because
 *     the token after it selects which of the four blocks the line opens. A
 *     failed match leaves the line unrecognized as that construct.
 *   - The admonition opener's title and label slots are PADDING, because the
 *     type word has already decided the block. A failed match leaves a token
 *     unconsumed and the surrounding production then rejects the line.
 *
 * Both failures land on prose, so both halves are pinned here. carve#886 read
 * the padding slots as `whitespace` (a space or a tab); carve#905 reverted that
 * reading, because the question is not what a slot recognizes but where it sits.
 */

describe('the separator after the fence run is a literal space', () => {
  const openers: Array<[string, string]> = [
    ['admonition', 'note'],
    ['div label', '[lbl]'],
    ['line block', '|'],
    ['local hard break', '\\'],
  ]

  for (const [label, token] of openers) {
    it(`a tab there opens nothing: ${label}`, () => {
      // Asserted as "the opener line survives as text", not "there is a <p>":
      // a div and a line block BOTH wrap a paragraph, so a `<p>` check passes
      // for a container that should not have opened at all.
      const tabbed = carveToHtml(`:::\t${token}\nx\n:::\n`)

      expect(tabbed).toContain(':::')
      expect(tabbed).not.toContain('<aside')
      expect(tabbed).not.toContain('<div')
    })

    it(`a space there still opens it: ${label}`, () => {
      // The control for each row: narrowing the class must not close the door
      // on the spelling the grammar does admit.
      const spaced = carveToHtml(`::: ${token}\nx\n:::\n`)

      expect(spaced).not.toBe(carveToHtml(`:::\t${token}\nx\n:::\n`))
    })
  }
})

describe('the admonition metadata slots are a literal space too', () => {
  /*
   * ONE FIXTURE PER SLOT, and each one isolates its own slot: the title rows
   * carry no label at all, and the label rows put a SPACE before the title so
   * only the label slot is under test. A fixture with a tab at BOTH slots
   * cannot discriminate - narrowing either slot alone already rejects the
   * line, so it would pass while the other slot was still wrong. That case is
   * kept below only as a shape check, and it says so.
   *
   * MIXED RUNS, per slot. The rule is about a RUN (`space+`), not about the
   * first whitespace character after the token, so a fix that only inspected
   * that first character would still let `::: note<SP><TAB>"T"` through.
   */
  const tabbedRows: Array<[string, string]> = [
    ['title slot, a tab', '::: note\t"T"'],
    ['title slot, a space then a tab', '::: note \t"T"'],
    ['title slot, a tab then a space', '::: note\t "T"'],
    ['label slot with no title, a tab', '::: note\t[lbl]'],
    ['label slot after a spaced title, a tab', '::: note "T"\t[lbl]'],
    ['label slot after a spaced title, a space then a tab', '::: note "T" \t[lbl]'],
    ['label slot after a spaced title, a tab then a space', '::: note "T"\t [lbl]'],
  ]

  for (const [label, opener] of tabbedRows) {
    it(`a tab in the run leaves the line as prose: ${label}`, () => {
      const out = carveToHtml(`${opener}\nx\n:::\n`)

      expect(out).toContain(':::')
      expect(out).not.toContain('<aside')
      expect(out).not.toContain('admonition-title')
    })
  }

  const spacedRows: Array<[string, string, string]> = [
    ['title slot', '::: note "T"', 'admonition-title'],
    ['title slot, a run of spaces', '::: note   "T"', 'admonition-title'],
    ['label slot with no title', '::: note [lbl]', 'div-label'],
    ['label slot after a title', '::: note "T" [lbl]', 'div-label'],
    ['label slot, a run of spaces', '::: note "T"   [lbl]', 'div-label'],
  ]

  for (const [label, opener, marker] of spacedRows) {
    it(`a run of spaces still fills the slot: ${label}`, () => {
      const out = carveToHtml(`${opener}\nx\n:::\n`)

      expect(out).toContain('<aside')
      expect(out).toContain(marker)
    })
  }

  it('a tab at both slots is prose, but it proves nothing on its own', () => {
    // Kept for the shape, NOT as evidence: narrowing either slot alone already
    // rejects this line, so it would pass with the other slot still wrong.
    // The per-slot rows above are what discriminate; the count guard below is
    // what keeps a row from being deleted without anyone noticing.
    expect(carveToHtml('::: note\t"T"\t[lbl]\nx\n:::\n')).not.toContain('<aside')
  })

  it('every tabbed row is checked, and none of them opens an admonition', () => {
    // A row silently dropped from the table would take its slot's coverage
    // with it and nothing else would fail.
    expect(tabbedRows).toHaveLength(7)
    expect(spacedRows).toHaveLength(5)

    const stillOpening = tabbedRows.filter(([, opener]) =>
      carveToHtml(`${opener}\nx\n:::\n`).includes('<aside'),
    )

    expect(stillOpening).toStrictEqual([])
  })
})

describe('nothing but a space fills a metadata slot', () => {
  // The slots were once spelled `\s`, which in JavaScript also admits a form
  // feed, a vertical tab, U+FEFF and every Unicode space - none of which the
  // grammar names at any position. Now that the slot is `space` these are a
  // fortiori excluded, and they stay pinned so a future widening has to argue
  // with a test rather than slip through.
  for (const [label, ws] of [
    ['form feed', '\f'],
    ['vertical tab', '\v'],
    ['en quad', ' '],
    ['no-break space', ' '],
  ] as const) {
    it(`a ${label} before the title does not pad`, () => {
      const out = carveToHtml(`::: note${ws}"Title"\nx\n:::\n`)

      expect(out).not.toContain('admonition-title')
    })
  }
})
