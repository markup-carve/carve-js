import { describe, it, expect } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/**
 * carve-js#1364: a `footnote` reached over a reference definition hoisted out
 * of its own body.
 *
 * PART 12 §7 hoists a definition to the document wherever it was written, so it
 * becomes the note's SIBLING - and the note went on covering the line it was
 * written on, which put the same offsets in two document-level nodes at once.
 *
 * NOT A RULING QUESTION, AND THAT WAS THE SURPRISE. The ticket read it as one,
 * because the definition is not a child and "stop at the last placed child"
 * therefore looks inapplicable. But the engine ALREADY answers this arrangement
 * for a `block_quote` - the control below - so the answer was settled and this
 * one construct was not asking it. The definition not being a child is what
 * makes the answer obvious rather than what makes it hard: a span ends at the
 * last thing it holds, and it holds no definition.
 *
 * markup-carve/carve#1571's overlap exemption is untouched and still needed. It
 * covers a definition claiming source INSIDE the container it was authored in,
 * which is what a note whose body continues past the definition still does.
 */
describe('a footnote ends at its last placed child', () => {
  const spanOf = (src: string, type: string): string => {
    const found: Array<{ startOffset: number; endOffset: number }> = []
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const it = node as Record<string, unknown> & { type?: string; pos?: { startOffset: number; endOffset: number } }
      if (it.type === type && it.pos) found.push(it.pos)
      for (const [key, value] of Object.entries(it)) {
        if (key === 'pos' || key === 'attrs') continue
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') walk(value)
      }
    }
    walk(carveToAstJson(src))
    expect(found.length, `exactly one ${type}`).toBe(1)

    return src.slice(found[0]!.startOffset, found[0]!.endOffset)
  }

  // Corpus `202-a-definition-on-a-footnote-body-s-continuation-line-is-collected`,
  // the last of the 135 `DECLARED_OVER_REACH` findings still standing after
  // markup-carve/carve#1596 re-measured them.
  const corpus202 = '[^a]: note\n  [r]: /u\n\nsee[^a] and [t][r]\n'

  it('stops before a definition hoisted off its last line', () => {
    expect(spanOf(corpus202, 'footnote')).toBe('[^a]: note')
  })

  it('leaves the hoisted definition outside it entirely', () => {
    // The point of the rule, not a restatement of it: the two are document-level
    // siblings, and before the fix offsets 11..20 were inside both.
    const note = spanOf(corpus202, 'footnote')
    const definition = spanOf(corpus202, 'link_reference_definition')
    expect(definition).toBe('  [r]: /u')
    expect(corpus202.indexOf(definition)).toBeGreaterThan(note.length)
  })

  it('answers a block quote the same way, which is where the answer came from', () => {
    // The control. `attachBlockPos` has applied this to a quote since
    // markup-carve/carve#1522, so the arrangement was already settled and the
    // footnote was recording its extent somewhere else - it takes its START from
    // the `[^label]:` marker, which is part of no child, so it never went
    // through that function and never picked up the END rule with it.
    const quote = '> note\n> [r]: /u\n\n[t][r]\n'
    expect(spanOf(quote, 'block_quote')).toBe('> note')
    expect(spanOf(quote, 'link_reference_definition')).toBe('> [r]: /u')
  })

  it('still reaches over a definition its body continues past', () => {
    // markup-carve/carve#1571's exemption, and the bound on this fix. Here the
    // note's last placed child is BELOW the definition, so the note legitimately
    // covers it - that is a hoisted definition claiming source inside the
    // container it was authored in, which §4 exempts by name. Only the TRAILING
    // reach was the defect.
    const middle = '[^a]: note\n  [r]: /u\n  tail\n\nsee[^a] and [t][r]\n'
    expect(spanOf(middle, 'footnote')).toBe('[^a]: note\n  [r]: /u\n  tail')
  })

  it('leaves an emptied note alone, which is a different arrangement', () => {
    // A note whose whole body is the definition has no placed child to end at.
    // markup-carve/carve#1522 rules that case for a container and the 20
    // emptied-container rows were reached separately, so answering it here would
    // settle a question this fix does not ask.
    expect(spanOf('[^a]: [r]: /u\n\nsee[^a] and [t][r]\n', 'footnote')).toBe('[^a]: [r]: /u')
  })

  it('leaves a note with no definition in it unchanged', () => {
    expect(spanOf('[^a]: note\n\nsee[^a]\n', 'footnote')).toBe('[^a]: note')
    expect(spanOf('[^a]: note\n  more\n\nsee[^a]\n', 'footnote')).toBe('[^a]: note\n  more')
  })
})
