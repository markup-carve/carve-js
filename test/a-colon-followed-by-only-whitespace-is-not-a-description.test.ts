import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

/**
 * A description marker takes a separator space AND non-empty content, so a `:`
 * line carrying nothing but whitespace opens no description
 * (markup-carve/carve#1830).
 *
 * It is a plain line under the open term, which folds it as a soft break, and
 * the line's own trailing whitespace run is dropped. That makes all four
 * whitespace spellings identical to the bare `:` line rather than merely
 * similar.
 *
 * THREE CLAUSES LAND IN THE SAME PLACE:
 *
 *  - MARKER REQUIRES CONTENT (PART 2) - a marker that takes a separator space
 *    opens its block only when followed by that space and non-empty content,
 *    and the rule ignores trailing whitespace. It governs EVERY such marker.
 *  - MARKER SEPARATORS AND PADDING SLOTS (PART 1) - a marker separator is
 *    spelled `space` and a tab never satisfies it, which refuses the tab
 *    spelling one step earlier, for a second reason.
 *  - NO TRAILING WHITESPACE (PART 2) - the run before a soft break in a
 *    definition term or description is dropped, over both space and tab.
 */
describe('a colon followed by only whitespace is not a description', () => {
  const FOLDED = '<dl>\n  <dt>t\n:</dt>\n</dl>\n<p>flush</p>'

  it.each([
    ['one space', ':: t\n: \n\nflush\n'],
    ['two spaces', ':: t\n:  \n\nflush\n'],
    ['three spaces', ':: t\n:   \n\nflush\n'],
    ['a tab', ':: t\n:\t\n\nflush\n'],
  ])('folds a colon plus %s into the term', (_name, source) => {
    expect(carveToHtml(source)).toBe(FOLDED)
  })

  /**
   * THE CONTROL THAT MAKES THE ROWS ABOVE MEAN SOMETHING. The bare marker
   * already read this way, so the four spellings are being routed to a branch
   * that exists rather than to a new one - and they must land on the SAME
   * output, byte for byte, not merely on a definition list.
   */
  it('reads exactly as the bare colon line does', () => {
    expect(carveToHtml(':: t\n:\n\nflush\n')).toBe(FOLDED)
  })

  /**
   * THE OTHER CONTROL. A marker with content still opens a description, so the
   * content test is what decides and not the colon.
   */
  it('leaves a marker that has content alone', () => {
    expect(carveToHtml(':: t\n: {}\n\nflush\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>{}</dd>\n</dl>\n<p>flush</p>',
    )
  })

  /**
   * THE TRAILING RUN IS DROPPED, and the TREE is where that shows. The HTML
   * above cannot tell `:` from `: ` folded, because a trailing run before a
   * soft break does not reach the output either way - so an HTML-only
   * assertion here would pass on a term that kept the run.
   */
  it.each([
    ['one space', ':: t\n: \n'],
    ['two spaces', ':: t\n:  \n'],
    ['three spaces', ':: t\n:   \n'],
    ['a tab', ':: t\n:\t\n'],
    ['nothing', ':: t\n:\n'],
  ])('folds a colon plus %s as text that is exactly the colon', (_name, source) => {
    const list = parse(source).children[0]!
    expect(list.type).toBe('definition_list')
    const term = (list as { items: Array<{ terms: Array<Array<{ type: string; value?: string }>> }> })
      .items[0]!.terms[0]!
    expect(term.map((node) => node.type)).toEqual(['text', 'soft_break', 'text'])
    expect(term[0]!.value).toBe('t')
    expect(term[2]!.value).toBe(':')
  })

  /**
   * A DESCRIPTION IS THE OTHER HOST. The line folds into whatever block is open
   * under the term, so an already-open description takes it too.
   */
  it('folds into an open description', () => {
    expect(carveToHtml(':: t\n: d\n: \n\nflush\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d\n:</dd>\n</dl>\n<p>flush</p>',
    )
  })

  it('is a paragraph with no term open above it', () => {
    expect(carveToHtml(': \n\nflush\n')).toBe('<p>:</p>\n<p>flush</p>')
  })

  /**
   * THE TERM MARKER IS NOT AFFECTED. `::` plus whitespace still closes the list
   * and emits its own paragraph - carve-php reads it that way and no clause here
   * moves it, so narrowing the content-less pattern must not reach it.
   */
  it('leaves a content-less TERM marker closing the list', () => {
    expect(carveToHtml(':: t\n:: \n\nflush\n')).toBe(
      '<dl>\n  <dt>t</dt>\n</dl>\n<p>::</p>\n<p>flush</p>',
    )
    expect(carveToHtml(':: t\n::  \n\nflush\n')).toBe(
      '<dl>\n  <dt>t</dt>\n</dl>\n<p>::</p>\n<p>flush</p>',
    )
  })

  it('folds a bare double colon into the term, as before', () => {
    expect(carveToHtml(':: t\n::\n\nflush\n')).toBe('<dl>\n  <dt>t\n::</dt>\n</dl>\n<p>flush</p>')
  })
})
