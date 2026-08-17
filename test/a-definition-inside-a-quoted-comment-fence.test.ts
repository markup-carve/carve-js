import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A DEFINITION WRITTEN INSIDE A COMMENT FENCE REGISTERS NOTHING, AT EVERY
 * COLUMN A FENCE CAN SIT AT (markup-carve/carve#1309). The corpus pinned the
 * column-0 and list-item spellings; the QUOTED one was unpinned, and all three
 * engines leaked through it while the executable spec oracle answered it
 * correctly (markup-carve/carve#1341).
 *
 * ````
 * > %%%
 * > [r]: /url
 * > %%%
 *
 * See [r][].
 * ````
 *
 * The quote renders EMPTY - so the fence really was consumed as a comment - and
 * the reference resolved anyway. Both halves of the answer were on screen at
 * once and they contradicted each other.
 *
 * THE TELL THAT IT WAS LEAKAGE AND NOT A READING OF THE RULE: IT SORTED
 * DEFINITIONS BY KIND. In the same quoted fence carve-js left `[^f]: note`
 * literal and registered `[r]: /url`. Nothing in §5 distinguishes the two, so a
 * rule being followed could not produce that split; two code paths disagreeing
 * about the same fence could, and did. The footnote form is collected during
 * block parsing, which reads the fence for itself; the link reference and
 * abbreviation forms are collected by the definition prepass, which asked the
 * document-wide closer index - and that index reads RAW lines, where a `> %%%`
 * closer carries its quote marker and matches nothing. So the quoted fence read
 * as unterminated to the prepass alone.
 *
 * THE CAUSE IS THE INDEX, NOT THE MARKER, which is why the fix is the same one
 * carve-rs made for the indented spelling in markup-carve/carve-rs#1052: read
 * the opener past its container prefix, BOUNDED BY THE CONTAINER. Widening the
 * opener without the bound regressed there, so the bound is part of the change,
 * and this file asserts both directions - the fence that closes inside its
 * quote hides its definitions, the one that does not still degrades.
 */

const resolved = (doc: string) => carveToHtml(doc).includes('href="/url"')

describe('a definition inside a quoted comment fence', () => {
  it('the reported document leaves the reference literal', () => {
    const out = carveToHtml('> %%%\n> [r]: /url\n> %%%\n\nSee [r][].\n')
    expect(out).toContain('<p>See [r][].</p>')
    expect(out).not.toContain('href="/url"')
  })

  it('the fence is still CONSUMED as a comment, so the quote stays empty', () => {
    // The registration is the only thing that moves. A fix that stopped opening
    // the region would also pass the assertion above - and would publish the
    // commented-out body into the quote, which is the worse defect. This is the
    // row that separates the two.
    const out = carveToHtml('> %%%\n> [r]: /url\n> hidden prose\n> %%%\n\nSee [r][].\n')
    expect(out).not.toContain('hidden prose')
    expect(out).toContain('<blockquote>')
    expect(out).not.toContain('href="/url"')
  })

  it('every definition KIND is treated alike', () => {
    // The asymmetry was the tell, so it gets a row per kind rather than one for
    // the kind that happened to be reported.
    //
    // A link reference definition: was registered, now literal.
    expect(carveToHtml('> %%%\n> [r]: /url\n> %%%\n\nSee [r][].\n')).not.toContain('href=')
    // A footnote definition: was already literal, and must stay so.
    const fn = carveToHtml('> %%%\n> [^f]: note\n> %%%\n\nSee[^f].\n')
    expect(fn).not.toContain('doc-endnotes')
    expect(fn).toContain('See[^f].')
    // An abbreviation definition: no expansion reaches the text.
    expect(carveToHtml('> %%%\n> *[ab]: abbrev\n> %%%\n\nThe ab here.\n')).not.toContain('<abbr')
  })

  it('the definitions still register when the same lines are NOT commented', () => {
    // The control for the kind row above: each definition is well-formed and a
    // quote is not itself opaque, so the only thing suppressing them is the
    // comment. Without this the row above passes for a document that never had
    // a definition in it at all.
    expect(carveToHtml('> [r]: /url\n\nSee [r][].\n')).toContain('href="/url"')
    expect(carveToHtml('> [^f]: note\n\nSee[^f].\n')).toContain('doc-endnotes')
    expect(carveToHtml('*[ab]: abbrev\n\nThe ab here.\n')).toContain('<abbr')
  })

  it('the closer has to arrive inside the quote', () => {
    // The bound. A `> %%%` is not closed by a bare `%%%` written after the
    // quote has ended, so that opener degrades to a line comment and the
    // definition under it is ordinary. Widening the opener without this is the
    // regression carve-rs hit on the indented spelling.
    expect(resolved('> %%%\n> [r]: /url\n\nSee [r][].\n')).toBe(true)
    expect(resolved('> %%%\n> [r]: /url\n\n%%%\n\nSee [r][].\n')).toBe(true)
  })

  it('width nests inside a quote the way it does anywhere else', () => {
    // A `> %%%` does not close a `> %%%%`, so the inner run is body text of the
    // outer comment and the definition beside it is inside the region.
    expect(resolved('> %%%%\n> %%%\n> [r]: /url\n> %%%%\n\nSee [r][].\n')).toBe(false)
    // And a wider closer does not close a narrower opener either, so this one
    // never closes inside the quote and degrades.
    expect(resolved('> %%%\n> [r]: /url\n> %%%%\n\nSee [r][].\n')).toBe(true)
  })

  it('a deeper quote is its own container', () => {
    expect(resolved('> > %%%\n> > [r]: /url\n> > %%%\n\nSee [r][].\n')).toBe(false)
    // A `> %%%` at depth one does not close a fence opened at depth two: the
    // inner quote is already over by then, so that opener degrades.
    expect(resolved('> > %%%\n> > [r]: /url\n> %%%\n\nSee [r][].\n')).toBe(true)
    // And it does not close the other way either. A `> > %%%` is inside a quote
    // of its own, and the block parser reads it as one, so the depth-one opener
    // degrades to a line comment - its body RENDERS - and the definition beside
    // it is ordinary. Accepting it suppressed a definition the parser publishes,
    // which is this ticket's own shape one quote deeper (raised by codex review).
    expect(resolved('> %%%\n> [r]: /url\n> > %%%\n\nSee [r][].\n')).toBe(true)
    expect(carveToHtml('> %%%\n> shown\n> > %%%\n\nSee [r][].\n')).toContain('shown')
  })

  it('a blank line ends the quote, so a run after it closes nothing', () => {
    // A blockquote does not survive a blank line, so these are TWO quotes and
    // the fence in the first one never closed. Measuring the following line's
    // depth alone said otherwise - it carries the same marker - and the region
    // opened over a definition the parser publishes.
    expect(resolved('> %%%\n> [r]: /url\n\n> %%%\n\nSee [r][].\n')).toBe(true)
    expect(resolved('> > %%%\n> > [r]: /url\n\n> > %%%\n\nSee [r][].\n')).toBe(true)
    // The body renders, which is the other half of that answer.
    expect(carveToHtml('> %%%\n> shown\n\n> %%%\n\ntail\n')).toContain('shown')
  })

  it('an item-scoped fence answers the same way whatever the closer wears', () => {
    // KNOWN DIVERGENCE, STATED RATHER THAN HIDDEN. Without a blank line above
    // it, a line that leaves a LIST ITEM still closes an item-scoped fence in
    // this engine - `a closer with NO blank line above it still closes, which
    // this does not move` pins that, and the oracle registers where this engine
    // does not. That row is not moved here.
    //
    // What moves is that the answer no longer depends on how the closer is
    // SPELLED. The old document-wide index read raw lines, so a closer wearing
    // a quote marker or a list marker was invisible to it and the same question
    // came back the other way. All four of these are now the one answer the row
    // above pins, rather than three accidents and a rule.
    expect(resolved('- item\n  %%%\n  [r]: /url\n%%%\n\nSee [r][].\n')).toBe(false)
    expect(resolved('- %%%\n  [r]: /url\n- %%%\n\nSee [r][].\n')).toBe(false)
    expect(resolved('> - %%%\n> - [r]: /url\n> %%%\n\nSee [r][].\n')).toBe(false)
    expect(resolved('- %%%%\n  [r]: /url\n- %%%%\n\nSee [r][].\n')).toBe(false)
  })

  it('CONTROL: the pinned column-0 and indented spellings do not move', () => {
    // These two are unanimous across the engines and pinned by the corpus. A
    // fix to the quoted spelling that disturbs either is worse than the gap it
    // closes, so they are asserted here rather than only in the corpus run.
    expect(resolved('%%%\n[r]: /url\n%%%\n\nSee [r][].\n')).toBe(false)
    expect(resolved('- %%%\n  [r]: /url\n  %%%\n\nSee [r][].\n')).toBe(false)
    // And the ordinary definition outside any comment still resolves.
    expect(resolved('[r]: /url\n\nSee [r][].\n')).toBe(true)
  })
})
