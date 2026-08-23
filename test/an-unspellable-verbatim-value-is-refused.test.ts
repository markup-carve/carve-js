import { describe, expect, it } from 'vitest'

import { carveToCarve, parse, renderCarve, SourceUnspellableError } from '../src/index.js'
import type { Document, InlineNode } from '../src/ast.js'

/*
 * A VERBATIM VALUE NO SOURCE CAN CARRY IS REFUSED, NOT APPROXIMATED
 * (carve-js#1344; the ruling on that ticket).
 *
 * markup-carve/carve-js#1341 moved the code-span values that survive a write
 * and a reparse from 12 of 25 to 17 of 25. The eight below are the remainder,
 * and they are not a writer defect that a better spelling would fix: the block
 * layer strips a line's trailing run and a continuation line's indent before
 * the inline scanner ever sees a backtick, so the loss happens on the way back
 * IN, and no closed form, no bare opener and no fence width avoids it.
 *
 * The writer therefore throws, which is the rule it already followed for the
 * empty `raw_inline` (carve-js#1209) and already advertised in `renderCarve`'s
 * docblock. Before this it emitted the nearest spellable form, so the caller
 * got back a tree that was not the one it passed in, with nothing said.
 *
 * NOTHING REACHABLE BY PARSING A DOCUMENT CHANGES, and the last two describe
 * blocks measure that rather than assert it: written as source, each of the
 * eight values comes back as something the writer still accepts, in a line
 * block as much as in a paragraph.
 *
 * A BLANK LINE IS NOT ONE OF THE EIGHT, though a first cut of this had it.
 * Corpus 344 is a line block whose swallowed comment line leaves exactly that
 * value, and §23 spells it: the writer emits the emptied line as `%%` and it
 * re-reads. Refusing it turned nine corpus assertions red - which is the whole
 * argument for measuring the corpus instead of reasoning about it. It is a
 * POSITIONAL loss, like the two guards carve-js#1341 pinned, and this predicate
 * is about the value alone.
 *
 * EACH CASE ASSERTS THE ERROR AND ITS REASON, not merely that something threw.
 * A bare `toThrow()` passes on every future error, including a bug, and these
 * eight shapes are the ones a later change is likeliest to break silently.
 */

/** The value in a REALISTIC position: not the first node of its paragraph. */
const inParagraph = (node: InlineNode): Document => ({
  type: 'document',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x ' }, node] }],
})

const code = (value: string): Document => inParagraph({ type: 'code', value })

function refusal(doc: Document): { name: string; nodeType: string; reason: string } {
  try {
    renderCarve(doc)
  } catch (error) {
    const typed = error as SourceUnspellableError
    return { name: typed.name, nodeType: typed.nodeType, reason: typed.reason }
  }
  throw new Error('renderCarve returned instead of refusing')
}

const LINE_END = 'a line of the value ends in whitespace, which the block layer strips'
const LINE_START = 'a line of the value starts with whitespace, which the block layer strips'
const LOST_PAD = 'a padded value ending in a line terminator loses the pad'

const refusedAs = (value: string, reason: string) => {
  expect(() => renderCarve(code(value))).toThrow(SourceUnspellableError)
  expect(refusal(code(value))).toEqual({
    name: 'SourceUnspellableError',
    nodeType: 'code',
    reason,
  })
}

describe('a verbatim value no Carve source can carry is refused', () => {
  describe('whitespace at the END of one of the value lines', () => {
    it('1. refuses a space before an interior line terminator', () => {
      refusedAs('a \nb', LINE_END)
    })

    it('2. refuses a tab before an interior line terminator', () => {
      // The class is Carve's whitespace, not the host's - a tab is stripped
      // exactly as a space is, and reading only `[ ]` would pass this row.
      refusedAs('a\t\nb', LINE_END)
    })

    it('3. refuses a space before the value FINAL terminator', () => {
      // The last line's end is a line end too. A predicate written as "between
      // two lines" would let this one through.
      refusedAs('a \n', LINE_END)
    })
  })

  describe('whitespace at the START of one of the value lines', () => {
    it('4. refuses a space after an interior line terminator', () => {
      refusedAs('a\n b', LINE_START)
    })

    it('5. refuses a tab after an interior line terminator', () => {
      refusedAs('a\n\tb', LINE_START)
    })

    it('6. refuses a value whose LAST line is whitespace only', () => {
      refusedAs('a\n ', LINE_START)
    })
  })

  describe('a padded value ending in a line terminator', () => {
    /*
     * The pad is not optional here: content touching a backtick merges with
     * the delimiter without it. The TRAILING pad then lands at the start of
     * the closing line, where the block layer takes it as that line's indent -
     * so the value comes back holding the leading pad and missing the trailing
     * one, one space longer than it went in.
     */
    it('7. refuses a single-backtick opener ending in a terminator', () => {
      refusedAs('`a\n', LOST_PAD)
    })

    it('8. refuses a backtick RUN opener ending in a terminator', () => {
      // A wider fence does not rescue it: what is lost is the pad, and every
      // width needs the same pad.
      refusedAs('```\n', LOST_PAD)
    })
  })

  describe('the terminator class is every terminator', () => {
    it('reads a CRLF pair as one break', () => {
      refusedAs('a \r\nb', LINE_END)
      refusedAs('a\r\n b', LINE_START)
    })

    it('reads a LONE CR as a break too', () => {
      // PART 2 lists it as a terminator, so the space is lost the same way. An
      // edge rule written as `\r?\n` passes both of these while the pad rule
      // next door catches the CR - one rule answered two ways.
      refusedAs('a \rb', LINE_END)
      refusedAs('a\r b', LINE_START)
    })
  })

  describe('whichever edge comes first, one refusal', () => {
    it('refuses a value carrying whitespace at BOTH edges of one break', () => {
      // Reported by the line-END rule, the first loss on the way back in. The
      // row is here because a predicate reading only one edge would still pass
      // rows 1 and 4 while letting this shape through in the other direction.
      refusedAs('a \n b', LINE_END)
    })
  })

  describe('the value alone decides, not the node kind', () => {
    /*
     * Every verbatim span writes through one function, so the refusal reports
     * whichever node it was asked to write. A second mechanism per node kind
     * is exactly what the empty `raw_inline` did NOT introduce.
     */
    it('names a raw inline', () => {
      const doc = inParagraph({ type: 'raw_inline', format: 'html', content: 'a \nb' })
      expect(refusal(doc)).toEqual({
        name: 'SourceUnspellableError',
        nodeType: 'raw_inline',
        reason: LINE_END,
      })
    })

    it('names a literal inline', () => {
      const doc = inParagraph({ type: 'literal_inline', content: 'a\n b' })
      expect(refusal(doc)).toEqual({
        name: 'SourceUnspellableError',
        nodeType: 'literal_inline',
        reason: LINE_START,
      })
    })

    it('names a math span', () => {
      const doc = inParagraph({ type: 'math', display: false, content: '`a\n' })
      expect(refusal(doc)).toEqual({
        name: 'SourceUnspellableError',
        nodeType: 'math',
        reason: LOST_PAD,
      })
    })

    it('still names the empty raw inline by its own reason', () => {
      // The pre-existing throw site is untouched: one mechanism, two reasons.
      const doc = inParagraph({ type: 'raw_inline', format: 'html', content: '' })
      expect(refusal(doc)).toEqual({
        name: 'SourceUnspellableError',
        nodeType: 'raw_inline',
        reason: 'an empty raw inline has no Carve source spelling',
      })
    })
  })

  describe('what parsing a document produces is untouched', () => {
    const eight = ['a \nb', 'a\t\nb', 'a \n', 'a\n b', 'a\n\tb', 'a\n ', '`a\n', '```\n']

    const codeValues = (src: string): string[] => {
      const out: string[] = []
      const walk = (node: { type?: string; value?: string; children?: unknown[] }): void => {
        if (node.type === 'code') out.push(node.value ?? '')
        for (const child of node.children ?? []) walk(child as typeof node)
      }
      for (const block of parse(src).children) walk(block as { type?: string })
      return out
    }

    const authored = (value: string): string => {
      const runs = [...value.matchAll(/`+/g)].map((match) => match[0].length)
      const fence = '`'.repeat(Math.max(1, ...runs, 0) + 1)
      return `x ${fence} ${value} ${fence}\n`
    }

    it('no document produces one of the eight values, in a paragraph', () => {
      for (const value of eight) expect(codeValues(authored(value))).not.toContain(value)
    })

    it('...and none does inside a line block either', () => {
      // A line block PRESERVES an authored indent as layout, so it is the one
      // container where line-leading whitespace might have survived the trip.
      // It does not: the strip runs before the inline scan there too.
      for (const value of eight) {
        expect(codeValues(`::: |\n${authored(value)}:::\n`)).not.toContain(value)
      }
    })

    it('and every one of those documents still writes back', () => {
      for (const value of eight) {
        expect(() => carveToCarve(authored(value))).not.toThrow()
        expect(() => carveToCarve(`::: |\n${authored(value)}:::\n`)).not.toThrow()
      }
    })

    it('leaves the blank line a line block CAN spell alone', () => {
      // Corpus 344's shape, reduced. The comment line is swallowed by the open
      // verbatim run and comes back as an empty verse line, which §23 spells.
      const src = '::: |\na `b\n%% secret\nc`\n:::\n'
      expect(codeValues(src)).toContain('b\n\nc')
      expect(() => carveToCarve(src)).not.toThrow()
      expect(carveToCarve(carveToCarve(src))).toBe(carveToCarve(src))
    })
  })

  describe('the neighbouring values that ARE spellable still are', () => {
    const survives = (value: string) => {
      const src = renderCarve(code(value))
      const paragraph = parse(src).children[0] as { children?: Array<{ type: string; value?: string }> }
      const written = (paragraph.children ?? []).filter((node) => node.type === 'code').map((node) => node.value)
      expect(written).toEqual([value])
    }

    it('keeps a value ending in a terminator that needs NO pad', () => {
      // The pad is half the question, so a terminator alone must not refuse.
      survives('a\n')
      survives('\n')
      survives('a`\n')
    })

    it('keeps the bare-opener form carve-js#1341 introduced', () => {
      survives('\n```')
      survives('\n`')
      survives('\na`')
    })

    it('keeps whitespace that is not at a line edge', () => {
      survives(' a')
      survives('a ')
      survives('  a  ')
      survives('   ')
      survives('a\tb')
      survives('a\nb')
    })
  })
})
