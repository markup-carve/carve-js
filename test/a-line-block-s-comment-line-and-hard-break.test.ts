import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

// markup-carve/carve#1333 (PART 9 §23) and markup-carve/carve#1334 (PART 11
// §7c), plus carve-js#1170, which is the same file and the same invariant.
//
// EVERY ASSERTION BELOW IS ON THE INVARIANT, not on the HTML, except where the
// HTML is the ruling. That is deliberate: `carveToHtml` cannot fail on the
// writer defects here, because a comment renders to nothing and a dropped
// trailing space is invisible in a `<br>`. Rendering is exactly what let three
// of these survive - `parse(fmt(x)) == parse(x)` is the check that sees them.
//
// The one HTML row that IS a ruling is the unclosed-run case: the comment line
// is removed at the BLOCK layer, before any inline content exists, so a run
// opened on an earlier line cannot claim it and publish the text.

const strip = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, node) =>
      key === 'pos' || key === 'srcByteLength' ? undefined : node,
    ),
  )

/** `parse(fmt(x)) == parse(x)`, and fmt is idempotent (PART 11 §1). */
const holdsTheInvariant = (source: string): void => {
  const once = carveToCarve(source)
  expect(strip(parse(once))).toEqual(strip(parse(source)))
  expect(carveToCarve(once)).toBe(once)
}

describe("a comment-only line in a line block is removed before any inline run", () => {
  it('is gone before an unclosed run opened on an earlier line can claim it', () => {
    // The whole of carve#1333: one stray backtick above the comment, and the
    // pinned engines published `%% secret` inside the code span. The empty
    // verse line the removal leaves reaches the run as a NEWLINE, like every
    // other break an open run swallows (carve#1282).
    const html = carveToHtml('::: |\na `b\n%% secret\nc\n:::\n')

    expect(html).toBe('<div class="line-block">\n  <p>a <code>b\n\nc</code></p>\n</div>')
    expect(html).not.toContain('secret')
  })

  it('writes the emptied line back as the only spelling verse has for one', () => {
    // A blank line ENDS a stanza, so the empty line the run now carries as a
    // newline cannot be written as one. A comment line is the single construct
    // that leaves an empty verse line instead of rewriting it, so it is what
    // the writer emits - and it re-reads to exactly the line it replaced.
    //
    // The note's own text does not survive a run that ate its line: what §23
    // says the run carries across is a NEWLINE, and there is no boundary left
    // in the tree for a `comment` node to sit on.
    const source = '::: |\na `b\n%% secret\nc\n:::\n'

    expect(carveToCarve(source)).toBe('::: |\na `b\n%%\nc`\n:::\n')
    expect(carveToCarve(source)).not.toContain('secret')
    holdsTheInvariant(source)
  })

  it('leaves an empty verse line when no run is open', () => {
    expect(carveToHtml('::: |\na\n%% secret\nc\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a<br>\n<br>\nc</p>\n</div>',
    )
  })

  it('adds nothing after the break already below it when it ends the stanza', () => {
    // AN EMPTY VERSE LINE IS A LINE, NOT A BREAK: it contributes a `<br>` only
    // through the boundary ABOVE it, so `a` over `%% c` is `a<br>` and no more.
    expect(carveToHtml('::: |\na\n%% c\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a<br>\n</p>\n</div>',
    )
  })

  it('preserves the empty verse line before a terminal comment after an open run', () => {
    expect(carveToHtml('::: |\n`\n%%\n:::\n')).toBe(
      '<div class="line-block">\n  <p><code>\n</code></p>\n</div>',
    )
  })

  it('does not leave a synthesized empty text node over a terminal comment', () => {
    const paragraph = (parse('::: |\na\n%%\n:::\n').children[0] as never as {
      children: { children: { type: string; value?: string }[] }[]
    }).children[0]!

    expect(paragraph.children.some((node) => node.type === 'text' && node.value === '')).toBe(false)
  })

  it('keeps the author’s line, at the author’s column, on the first body line', () => {
    // carve-js#1170. The renderer wrote every inline comment with an
    // unconditional leading separator space; in verse a leading run is CONTENT,
    // so the space pushed `%%` off column 0 and the reparse published the note
    // as text. This engine had it on the first body line and on later ones,
    // where carve-php only had it on later ones.
    expect(carveToCarve('::: |\n%% secret\na\n:::\n')).toBe('::: |\n%% secret\na\n:::\n')
    holdsTheInvariant('::: |\n%% secret\na\n:::\n')
  })

  it('keeps it on a later body line too', () => {
    expect(carveToCarve('::: |\na\n%% secret\nc\n:::\n')).toBe('::: |\na\n%% secret\nc\n:::\n')
    holdsTheInvariant('::: |\na\n%% secret\nc\n:::\n')
  })

  it('keeps it where the comment ends the stanza', () => {
    expect(carveToCarve('::: |\na\n%% c\n:::\n')).toBe('::: |\na\n%% c\n:::\n')
    holdsTheInvariant('::: |\na\n%% c\n:::\n')
  })

  it('leaves an INDENTED marker as ordinary verse text', () => {
    // The boundary the fix must not buy its way past. Leading whitespace is
    // content here, so `comment_line`'s optional whitespace prefix has nothing
    // to consume: only a body line whose FIRST character is `%` is a comment
    // line. A fix that publishes nothing but also swallows this line would pass
    // a one-sided test.
    expect(carveToHtml('::: |\na\n %% secret\nc\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a<br>\n&nbsp;%% secret<br>\nc</p>\n</div>',
    )
    holdsTheInvariant('::: |\na\n %% secret\nc\n:::\n')
  })

  it('leaves a TRAILING marker inside an open run as content', () => {
    // A different construct: `x %% secret` is `inline_comment` (PART 3, §21),
    // not `comment_line`, and inside a verbatim run there is no comment there
    // at all. The asymmetry is deliberate - an engine may leave a `%%` standing
    // inside a run, and may never delete author bytes out of one.
    expect(carveToHtml('::: |\na `b\nx %% secret\nc\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <code>b\nx %% secret\nc</code></p>\n</div>',
    )
  })

  it('writes an EMPTY comment line back as an empty comment line', () => {
    // The writer emits ` %% ` for a comment with no content, and PART 2 strips
    // the trailing space again - harmless until §7c, which read that same lone
    // trailing space as a break worth protecting and turned `%%` into `%% \`,
    // making the note's content a backslash.
    expect(carveToCarve('::: |\na\n%%\nb\n:::\n')).toBe('::: |\na\n%%\nb\n:::\n')
    holdsTheInvariant('::: |\na\n%%\nb\n:::\n')

    // Same shape where the marker has whitespace after it and no content: the
    // parser reads an empty comment either way.
    expect(carveToCarve('::: |\na\n%% \nb\n:::\n')).toBe('::: |\na\n%%\nb\n:::\n')
    holdsTheInvariant('::: |\na\n%% \nb\n:::\n')

    // `%%%` is a comment whose content is `%`, and joins the opener rather than
    // being separated from it (PART 11 §2).
    expect(carveToCarve('::: |\na\n%%%\nb\n:::\n')).toBe('::: |\na\n%%%\nb\n:::\n')
  })

  it('keeps a last-line comment under a boundary the author spelled with `\\`', () => {
    // The two spellings of the same boundary have to answer the same. A `\` is
    // not a soft break and never reaches the hardening conversion, so reading
    // the surviving boundaries off that conversion alone said no boundary ended
    // the line above and deleted the note - on `a \` but not on `a`.
    expect(carveToCarve('::: |\na \\\n%% secret\n:::\n')).toBe('::: |\na \\\n%% secret\n:::\n')
    holdsTheInvariant('::: |\na \\\n%% secret\n:::\n')
    holdsTheInvariant('::: |\n\\\n%% secret\n:::\n')
  })

  it('gives the break after an emptied line a span its own columns agree with', () => {
    // The break is measured from the SOURCE line, not from the empty text the
    // block layer left: reading the parsed length put its start at column 1
    // while its `startColumn` said column 10, so one span had two answers and
    // covered the `comment` node sitting on those same bytes.
    const paragraph = (parse('::: |\na\n%% secret\nc\n:::\n').children[0] as never as {
      children: { children: { type: string; pos?: Record<string, number> }[] }[]
    }).children[0]!.children
    const comment = paragraph.find((node) => node.type === 'comment')!
    const breakAfter = paragraph[paragraph.indexOf(comment) + 1]!

    expect(breakAfter.type).toBe('hard_break')
    expect(breakAfter.pos!.startOffset).toBe(comment.pos!.endOffset)
    expect(breakAfter.pos!.startColumn).toBe(comment.pos!.endColumn)
  })

  it('never writes a backslash into a comment’s own content', () => {
    // §7c protects a lone trailing space because PART 2 would take it and
    // change the tree. On a line that ENDS in a comment there is no such
    // trade: `%%` runs to end of line, so the space is inside the note, and
    // PART 2 taking it leaves the note. The backslash does not leave it - the
    // block layer claims the whole line before the inline parser sees it, so
    // the `\` is read back as part of the content.
    //
    // The trailing space itself is not recovered here; that is PART 2's
    // pre-existing strip and predates both rulings. What must not happen is
    // the writer ADDING a character to a note the author wrote.
    const source = '::: |\na\n%% x \nb\n:::\n'
    const formatted = carveToCarve(source)

    expect(formatted).not.toContain('\\')
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('does not add a separator space to a comment that follows content', () => {
    // The other side of the same writer change: where there IS something to
    // separate from, the space stays.
    expect(carveToCarve('a %% c\n')).toBe('a %% c\n')
    expect(carveToCarve('# h %% c\n')).toBe('# h %% c\n')
  })
})

describe("a line block's hard break keeps its backslash", () => {
  it('keeps the lone trailing space the backslash was holding interior', () => {
    // The reported failure. PART 7 makes the run before a line-break backslash
    // INTERIOR, so the parser does NOT discard it - which is exactly the
    // precondition PART 11 §7 relies on to strip a trailing run.
    expect(carveToCarve('::: |\na \\\nb\n:::\n')).toBe('::: |\na \\\nb\n:::\n')
    holdsTheInvariant('::: |\na \\\nb\n:::\n')
  })

  it('keeps a backslash-only line, which a blank line cannot spell', () => {
    // A blank line ENDS the stanza, so the bare newline returned one stanza as
    // two - a structural loss, not a cosmetic one.
    expect(carveToCarve('::: |\na\n\\\nb\n:::\n')).toBe('::: |\na\n\\\nb\n:::\n')
    holdsTheInvariant('::: |\na\n\\\nb\n:::\n')
    expect(carveToHtml(carveToCarve('::: |\na\n\\\nb\n:::\n'))).toBe(
      '<div class="line-block">\n  <p>a<br>\n<br>\nb</p>\n</div>',
    )
  })

  it('keeps a trailing break on the last body line with no space at all', () => {
    // §7c's third sentence excuses a line with no trailing whitespace because
    // its "tree is identical either way". That holds INSIDE a stanza, where the
    // boundary hardens with or without the backslash, and fails at the stanza's
    // END, where the next newline belongs to the closing fence. Same loss as
    // the row below, with no space involved in it.
    expect(carveToCarve('::: |\na\\\n:::\n')).toBe('::: |\na\\\n:::\n')
    holdsTheInvariant('::: |\na\\\n:::\n')

    // And with a run of two columns, which MEDIAL GAPS already keeps as NBSP
    // content: the spaces were never the reason, the break is.
    expect(carveToCarve('::: |\na  \\\n:::\n')).toBe('::: |\na  \\\n:::\n')
    holdsTheInvariant('::: |\na  \\\n:::\n')

    // A stanza that is not the last one ends the same way - the blank line
    // after it is the stanza separator, not a line boundary.
    holdsTheInvariant('::: |\na\\\n\nb\n:::\n')
  })

  it('keeps a trailing break on the last body line', () => {
    // The third failure, and the one the closing fence caused: the writer put
    // the closer's newline on a body that had already ended its line, leaving a
    // BLANK line before the fence that ended the stanza early.
    expect(carveToCarve('::: |\na \\\n:::\n')).toBe('::: |\na \\\n:::\n')
    holdsTheInvariant('::: |\na \\\n:::\n')
    expect(carveToHtml(carveToCarve('::: |\na \\\n:::\n'))).toBe(
      '<div class="line-block">\n  <p>a <br>\n</p>\n</div>',
    )
  })

  it('writes no backslash where the bare newline is already right', () => {
    // A line with no trailing whitespace has an identical tree either way, and
    // a run of TWO OR MORE columns is already NBSP content (§23 MEDIAL GAPS),
    // so neither needs the backslash. §1a asks for the SMALLEST departure, so
    // the writer does not spend one where the spelling costs nothing.
    expect(carveToCarve('::: |\na\nb\n:::\n')).toBe('::: |\na\nb\n:::\n')
    expect(carveToCarve('::: |\na  \\\nb\n:::\n')).toBe('::: |\na  \nb\n:::\n')
    holdsTheInvariant('::: |\na  \\\nb\n:::\n')
  })

  it('produces ONE break per boundary, however the boundary is spelled', () => {
    // A BACKSLASH BREAK IS NOT ADDITIVE (PART 9 §23). `hard_break` consumes its
    // own newline, so no soft break survives for the container to harden.
    expect(carveToHtml('::: |\na \\\nb\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <br>\nb</p>\n</div>',
    )
    expect(carveToHtml('::: |\na\nb\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a<br>\nb</p>\n</div>',
    )
  })

  it('leaves a paragraph’s hard break spelled with its backslash', () => {
    // The control: outside the container nothing changes, because outside it
    // the backslash was never optional.
    expect(carveToCarve('a \\\nb\n')).toBe('a \\\nb\n')
  })
})
