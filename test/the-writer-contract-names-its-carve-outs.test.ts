import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'
import type { Document, Paragraph } from '../src/index.js'

/*
 * markup-carve/carve#1658, PART 11 §1c: `renderCarve`'s contract names its
 * carve-outs.
 *
 * The contract was stated as an absolute - what it returns re-reads as what it
 * was given - while the writer carried an exception nothing declared. A
 * `paragraph` whose whole content is one image is written `![a](u)`, which
 * re-reads as the standalone image; the writer neither refuses nor reports. The
 * defect was never the normalization, which the ruling keeps. It was that a
 * contract true except quietly is worse than a narrower one true as written,
 * because every reader of the first is entitled to rely on it.
 *
 * So this pins BOTH halves, and neither is worth much alone: the behavior
 * (written and lost, never refused) and the DECLARATION that says so. A
 * declaration nothing reads rots the moment the behavior moves, which is how
 * the absolute survived in the first place.
 */

const here = dirname(fileURLToPath(import.meta.url))
const writerSource = readFileSync(resolve(here, '../src/render-carve.ts'), 'utf8')

/** The `renderCarve` docblock: everything from its opener to the function. */
const contract = (() => {
  const end = writerSource.indexOf('export function renderCarve(')
  expect(end).toBeGreaterThan(0)
  const start = writerSource.lastIndexOf('/**', end)
  return writerSource.slice(start, end)
})()

const types = (doc: Document) => doc.children.map((child) => child.type)

/**
 * A `paragraph` whose whole content is one COMMENT.
 *
 * No source spells it - `%%` opens a block comment at every indent - so it is
 * lifted out of a paragraph that also held text, which is the payload an editor
 * or an AST ingest hands back.
 */
function commentParagraph(): Document {
  const document = parse('zz %% c\n')
  const only = (document.children[0] as Paragraph).children.find((child) => child.type === 'comment')
  expect(only, 'no comment node to lift - the fixture no longer builds the shape it is about').toBeDefined()
  return { type: 'document', children: [{ type: 'paragraph', children: [only!] }] } as Document
}

describe("the writer's contract names its carve-outs", () => {
  describe('the two structural carve-outs are written and LOST, never refused', () => {
    // The fourth column is what the HTML renderer produces for the shape. It is
    // there to show the renderer ACCEPTS the tree - the reason the ruling
    // declined to refuse it - and it is per-shape because the two shapes do not
    // render alike. It used to be a shared `toContain('<p>')`, which held only
    // because carve-js promoted a lone image away before the renderer saw one:
    // since carve-js#1437 an INDENTED lone image stays a paragraph in the tree
    // and the renderer collapses it to a bare `<img>`, the way carve-rs and
    // carve-php always have. Asserting the wrapper here would pin an artifact of
    // the old promotion against the other two engines.
    const shapes: Array<[string, () => Document, string, string]> = [
      ['a paragraph holding one image', () => parse(' ![a](u)\n'), '![a](u)\n', '<img src="u" alt="a">'],
      ['a paragraph holding one comment', commentParagraph, '%% c\n', '<p></p>'],
    ]

    for (const [label, tree, spelled, rendered] of shapes) {
      it(`${label}: the content's own spelling, and the wrapper is gone`, () => {
        const before = tree()
        expect(types(before)).toEqual(['paragraph'])

        // Refusing here would break an editor's round trip on a tree the HTML
        // renderer accepts, which is the reason the ruling declined it.
        expect(() => renderCarve(before)).not.toThrow()
        expect(() => renderHtml(before)).not.toThrow()
        expect(renderHtml(before)).toBe(rendered)

        const written = renderCarve(before)
        expect(written).toBe(spelled)
        expect(types(parse(written))).not.toEqual(['paragraph'])
      })
    }
  })

  it('a block that spells nothing leaves the document a block shorter', () => {
    // The third carve-out, and the one easiest to miss: the parser cannot build
    // an empty paragraph, so nothing reaches it from source. Found by
    // `codex review` on the sibling engine rather than by reading the code -
    // which is the argument for naming the carve-outs as CLASSES.
    for (const first of [[], [{ type: 'text', value: ' ' }]]) {
      const before = {
        type: 'document',
        children: [
          { type: 'paragraph', children: first },
          { type: 'paragraph', children: [{ type: 'text', value: 'after' }] },
        ],
      } as unknown as Document

      expect(types(before)).toEqual(['paragraph', 'paragraph'])
      expect(() => renderCarve(before)).not.toThrow()
      expect(renderCarve(before)).toBe('after\n')
      expect(types(parse(renderCarve(before)))).toEqual(['paragraph'])
    }
  })

  it('still refuses a VALUE no source can carry', () => {
    // The control, and the line the carve-outs are drawn against: the refusal
    // is about a node's own CONTENT, and neither carve-out is. Without this, a
    // writer that had simply stopped throwing would pass everything above.
    const raw: Document = {
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'raw_inline', content: '', format: 'html' }] }],
    } as Document

    expect(() => renderCarve(raw)).toThrow(SourceUnspellableError)
  })

  it('keeps the wrapper wherever the content spells something else', () => {
    // The other control. A rule read as "a paragraph around an image is always
    // dropped" passes both positive cases and fails here.
    for (const source of [' ![a](u) and text\n', ' ![a](u) ![b](v)\n', ' ![a](u)\n', ' zz %% c\n']) {
      expect(types(parse(renderCarve(parse(source)))), source).toEqual(['paragraph'])
    }
  })

  describe('the contract text says so', () => {
    it('names the structural carve-out and the clause that rules it', () => {
      expect(contract).toContain('PART 11 §1c')
      expect(contract).toMatch(/BLOCK WHOSE OWN CONTENT SPELLS IT AWAY/)
    })

    it('names the flatten carve-out and the clause that rules it', () => {
      expect(contract).toContain('PART 11 §1b')
      expect(contract).toMatch(/FLATTEN INTO AN INLINE-ONLY SLOT/)
    })

    it('names the spells-nothing carve-out and the clause that rules it', () => {
      expect(contract).toContain('PART 11 §10j')
      expect(contract).toMatch(/BLOCK THAT SPELLS NOTHING AT ALL/)
    })

    it('states each carve-out as a CLASS, not as the one shape that found it', () => {
      // The failure this whole change is about, one shape later: an amendment
      // that enumerates `paragraph > image` is as absolute and as false as the
      // sentence it replaced. Each bullet has to name the property and the
      // clause that generalizes it.
      expect(contract).toMatch(/Each is a CLASS/)
      for (const clause of ['§1b', '§1c', '§10j']) {
        expect(contract, `no normative home cited for ${clause}`).toContain(clause)
      }
    })

    it('says which shapes no source reaches, so a caller does not have to discover them', () => {
      expect(contract).toMatch(/hand-built or ingested tree/)
    })

    it('says the carve-outs are written and lost rather than refused', () => {
      // The half a reader acts on. `@throws` promising a refusal for these
      // shapes is the absolute this change removes.
      expect(contract).toMatch(/which are written and\s+\*\s+lost rather than refused/)
    })

    it('does not state the invariant without qualifying it', () => {
      // The original sentence, unqualified, is what the ticket quoted. It may
      // appear only where a carve-out is named in the same breath.
      const absolute = /what it returns re-reads as what it was given/g
      for (const match of writerSource.matchAll(absolute)) {
        const window = writerSource.slice(match.index!, match.index! + 400)
        expect(window, 'the invariant is restated with no carve-out beside it').toMatch(/carve-out|§1b|§1c/)
      }
    })
  })
})
