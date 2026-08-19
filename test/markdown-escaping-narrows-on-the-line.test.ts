import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToAnsi, carveToPlainText } from '../src/index.js'
import { renderMarkdown } from '../src/render-markdown.js'
import type { BlockNode, Document, InlineNode } from '../src/ast.js'

/**
 * THE MARKDOWN TARGET'S ESCAPING NARROWS ON THE LINE (PART 11 section 8a, the
 * ruling on markup-carve/carve#970, landed in markup-carve/carve#978).
 *
 *   M1a THE ASTERISK KEEPS M1 UNCONDITIONALLY.
 *   M1b `_`, `#` AND `[` ARE ESCAPED IF AND ONLY IF the character is ADJACENT
 *       ON THE EMITTED LINE to an UNESCAPED DELIMITER OF THE SAME CHARACTER.
 *   M1c A PARAGRAPH LINE MUST NOT BECOME A LIST.
 *   M1d NOTHING ELSE NARROWS.
 *
 * M1b IS AN IF-AND-ONLY-IF, NOT A FLOOR. An escape it drops is dropped and an
 * escape it keeps is kept, because a permissive reading of it yields three
 * outputs from three engines - which is the failure the question came out of.
 * So the cases below assert both directions on the same character.
 */
const md = (src: string) => carveToMarkdown(src).trim()

describe("the Markdown target's escaping narrows on the line", () => {
  describe('M1c: paragraph lines do not become lists', () => {
    it('protects every foreign-reader list marker', () => {
      expect(md('para\n- tail')).toBe('para\n\\- tail')
      expect(md('para\n+ tail')).toBe('para\n\\+ tail')
      expect(md('para\n1. tail')).toBe('para\n1\\. tail')
      expect(md('para\n1) tail')).toBe('para\n1\\) tail')
      expect(md('para\n* tail')).toBe('para\n\\* tail')
    })

    it('protects an indented marker but leaves a real list marker live', () => {
      const doc: Document = {
        type: 'document',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'para\n   - tail' } as InlineNode],
          } as BlockNode,
        ],
      }
      expect(renderMarkdown(doc).trim()).toBe('para\n   \\- tail')
      expect(md('- real')).toBe('- real')
    })

    it('does not rewrite a marker inside a multiline code span', () => {
      expect(md('para ``code\n- literal``')).toBe('para `code\n- literal`')
    })
  })

  describe('M1b: not adjacent, so the escape protects nothing and is dropped', () => {
    it('writes an identifier as the author typed it', () => {
      expect(md('company_id')).toBe('company_id')
      expect(md('read_write_delete')).toBe('read_write_delete')
    })

    it('writes a hash that opens nothing', () => {
      // The cost M1 imposed landed on exactly these: a backslash inside an
      // identifier breaks exact-match search in the published document, and
      // fed to a CommonMark reader both forms produce the same HTML.
      expect(md('C# and issue #123')).toBe('C# and issue #123')
      expect(md('a #tag here')).toBe('a #tag here')
    })

    it('writes a bracket that opens nothing', () => {
      expect(md('see [brackets] here')).toBe('see [brackets\\] here')
    })

    it('writes a lone underscore at either end of a word', () => {
      expect(md('trailing_')).toBe('trailing_')
      expect(md('_leading')).toBe('_leading')
    })
  })

  describe('M1b: adjacent, so unescaping would merge the runs and the escape stays', () => {
    it('keeps both escapes on a doubled underscore', () => {
      expect(md('a__b')).toBe('a\\_\\_b')
    })

    it('keeps both escapes on a doubled hash', () => {
      // The sharp one for `#`: `## text` on a line of its own is an ATX
      // heading to every reader this target answers to. Adjacency catches it
      // without a rule about line position, because the two characters are
      // each other's neighbour.
      expect(md('a ## b')).toBe('a \\#\\# b')
    })

    it('keeps both escapes on a doubled bracket', () => {
      expect(md('x [[y]] z')).toBe('x \\[\\[y\\]\\] z')
    })

    it('counts a run of three, not only a pair', () => {
      expect(md('x___y')).toBe('x\\_\\_\\_y')
    })
  })

  describe('M1a: the asterisk keeps M1 unconditionally', () => {
    it('escapes a literal asterisk that flanks nothing', () => {
      // The narrowing that was tried and failed. `*\*\**` unescaped to `****`,
      // and through a CommonMark reader those are not two spellings of one
      // document: emphasis containing two asterisks was published as a
      // thematic break. The run being weighed was partly the writer's OWN
      // delimiters, which the escaped literals had merged into.
      expect(md('a * b')).toBe('a \\* b')
      expect(md('a*b*c')).toBe('a\\*b\\*c')
    })

    it('escapes both literals inside emphasis the writer spells with asterisks', () => {
      expect(md('/**/')).toBe('*\\*\\**')
    })
  })

  describe('M1c: nothing else narrows', () => {
    it('keeps the backslash and the closing bracket escaped', () => {
      expect(md('a \\\\ b')).toBe('a \\\\ b')
      expect(md('a ] b')).toBe('a \\] b')
    })

    it('keeps a backtick escaped, from a tree', () => {
      // A literal backtick cannot reach a TEXT node from source - it opens a
      // code span - so this one comes from a tree, which `fromAstJson` accepts
      // from the other engines.
      const doc: Document = {
        type: 'document',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'a ` b' } as InlineNode],
          } as BlockNode,
        ],
      }
      expect(renderMarkdown(doc).trim()).toBe('a \\` b')
    })
  })

  describe('M2 keeps every character this target can read as markup', () => {
    it('keeps the backslash whatever the line says', () => {
      // Section 8a states this as the reason a line-level test can stand in
      // for the parser section 2 needs: a character the author DID escape is
      // an `escaped_text` node, so every case where the author said which
      // reading they meant is out of M1b's hands. Section 8b narrowed M2, but
      // not for these: `_` can pair and `[` can open a link at any position,
      // so both keep the escape everywhere and that argument still stands.
      expect(md('a\\_b')).toBe('a\\_b')
      expect(md('\\[not a link')).toBe('\\[not a link')
      expect(md('a\\*b')).toBe('a\\*b')
    })

    it('keeps a smart-punctuation trigger, which is what M2 is for', () => {
      // Not a Markdown metacharacter, so M1 never reached it. A processor with
      // substitution on rewrites the TEXT, which is a different hazard from
      // reading markup and is why section 8b names these four explicitly.
      expect(md('a\\-\\- b')).toBe('a\\-\\- b')
    })
  })

  describe('M2a: an authored escape of an inert character is emitted bare', () => {
    it('drops the backslash from Carve delimiters Markdown cannot read', () => {
      expect(md('hi \\@user ok')).toBe('hi @user ok')
      expect(md('a \\{x b')).toBe('a {x b')
      expect(md('a \\^x b')).toBe('a ^x b')
      expect(md('a \\%x b')).toBe('a %x b')
      expect(md('a \\:x b')).toBe('a :x b')
      expect(md('a \\/x b')).toBe('a /x b')
    })
  })

  describe('M2b: the hash is decided by where it stands', () => {
    it('drops the backslash where no heading could open', () => {
      expect(md('a \\#y b')).toBe('a #y b')
      expect(md('issue \\#123 fixed')).toBe('issue #123 fixed')
      expect(md('C\\# is a language')).toBe('C# is a language')
      expect(md('Bau \\#64748b')).toBe('Bau #64748b')
      expect(md('see (\\#tag) there')).toBe('see (#tag) there')
    })

    it('keeps it where an ATX heading would open', () => {
      expect(md('\\# heading')).toBe('\\# heading')
    })

    it('drops it at a line start that no space closes', () => {
      // The position passes and the run does not: `#tag` is a paragraph in
      // CommonMark, which is why the test is spelled on the run.
      expect(md('\\#not a heading')).toBe('#not a heading')
      expect(md('\\#tag rest')).toBe('#tag rest')
    })

    it('escapes only the FIRST hash of a run, which is sufficient', () => {
      // A heading that cannot open needs nothing done to the rest of its run.
      // That is M1e's argument about the angle bracket, one character over.
      expect(md('\\#\\#\\# heading')).toBe('\\### heading')
    })

    it('leaves a run of seven alone, since no flavour reads it as a heading', () => {
      expect(md('\\#\\#\\#\\#\\#\\#\\# x')).toBe('####### x')
    })
  })

  describe('the test is over the LINE, not over the node', () => {
    it('sees a neighbour the parser put in a different text node', () => {
      // `a__b` is three text nodes to this parser (`a`, `_`, `_b`), so at
      // escape time neither underscore can see the other. The decision is
      // therefore made on the assembled output, which is where the line is.
      expect(md('a__b')).toBe('a\\_\\_b')
      // ...and a neighbour separated by one character is NOT adjacent.
      expect(md('a_x_b')).toBe('a_x_b')
    })

    it('does not reach across a newline', () => {
      // Two lines, each ending/starting with the character. They are not on
      // one line, so neither is adjacent to the other.
      expect(md('x #\n\ny # z')).toBe('x #\n\ny # z')
    })

    it('does not count a neighbour that is itself behind a backslash', () => {
      // `\\__b` is an AUTHORED escape followed by a bare underscore. The
      // authored one is emitted as an escape under M2, so on the emitted line
      // it is not an unescaped delimiter - it cannot merge with anything - and
      // the bare underscore beside it is therefore not adjacent to one. The
      // clause spells this out as "not behind a backslash".
      expect(md('\\__b')).toBe('\\__b')
    })

    it('cannot be steered by a sentinel in author content', () => {
      // The sentinels are private-use characters, so nothing in `\\p{Cc}` covers
      // them. Author content carrying one used to reach normalize() and be
      // read as an escape this renderer had emitted, which INVENTS a character
      // the document never had - U+E005 came out as a `#`.
      for (const [cp, ch] of [[0xe004, '_'], [0xe005, '#'], [0xe006, '[']] as const) {
        const src = 'x' + String.fromCharCode(cp) + 'y'
        expect(src.charCodeAt(1)).toBe(cp)
        expect(md(src)).toBe('xy')
        expect(md(src)).not.toContain(ch)
      }
    })

    it('does not rewrite a backslash it did not write', () => {
      // The decision is made on a SENTINEL, not on a `\_` in the output,
      // because the assembled document also carries regions this renderer must
      // reproduce byte-exact.
      expect(md('`a\\_b`')).toBe('`a\\_b`')
      expect(md('[x](a\\_b)')).toBe('[x](a\\_b)')
    })
  })

  describe('CONTROL: the narrowing reaches no character PART 9 section 25 is about', () => {
    it('does not let DEL or the C1 controls into Markdown', () => {
      // The sharp control for this change. Section 25 requires the terminal
      // target to strip DEL (U+007F) and the C1 controls, the last because CSI
      // (U+009B) and OSC (U+009D) are single-character forms of the sequences
      // that requirement exists to stop. The spec-side version of this clause
      // had a P1 regression caught in review, where a narrowing stated over
      // "non-whitespace C0 control" would have let exactly those through.
      //
      // Nothing here narrows a control-character rule: section 8a is about
      // three ASCII metacharacters. This case is the proof, and it is a
      // CONTROL - no mutation of this change breaks it, because this change
      // does not touch that code. It is here so a later narrowing that DOES
      // touch it fails.
      //
      // A LATER NARROWING DID touch it, and this is where the split belongs.
      // PART 9 section 29 made the non-whitespace C0 controls content on the
      // Markdown and plain targets (markup-carve/carve-js#896), so U+001B,
      // U+000B and U+000C moved to the terminal-only list. DEL and the C1
      // controls did NOT move - section 29 T5 keeps them outside, which is
      // exactly the P1 regression this case was written to catch, so they stay
      // asserted across all three targets.
      const blockedEverywhere = [0x7f, 0x9b, 0x9d]
      for (const cp of blockedEverywhere) {
        const ch = String.fromCodePoint(cp)
        const src = `a${ch}b\n`
        expect([...src].some((c) => c.codePointAt(0) === cp)).toBe(true)
        for (const render of [carveToMarkdown, carveToAnsi, carveToPlainText]) {
          const out = render(src)
          expect([...out].some((c) => c.codePointAt(0) === cp)).toBe(false)
        }
      }

      const terminalOnly = [0x1b, 0x0b, 0x0c]
      for (const cp of terminalOnly) {
        const ch = String.fromCodePoint(cp)
        const src = `a${ch}b\n`
        expect([...carveToAnsi(src)].some((c) => c.codePointAt(0) === cp)).toBe(false)
        for (const render of [carveToMarkdown, carveToPlainText]) {
          const out = render(src)
          expect([...out].some((c) => c.codePointAt(0) === cp)).toBe(true)
        }
      }
    })

    it('still blanks a denied URL scheme on a Markdown destination', () => {
      // The Markdown target's other hardening is untouched by this clause.
      expect(md('[x](javascript:alert(1))')).not.toContain('javascript:')
    })

    it('still neutralizes embedded HTML in text', () => {
      // M1e narrows the angle bracket the same way this section narrows `_`,
      // `#` and `[`: the `<` is escaped because a tag name follows it, and the
      // closing `>` takes nothing because a tag that cannot open cannot be
      // closed (carve#1148). The neutralization is unchanged - only its
      // spelling is, from an entity to the backslash this section actually
      // describes.
      expect(md('a <img src=x onerror=y> b')).toBe('a \\<img src=x onerror=y> b')
    })

    it('and leaves the angle brackets that open nothing', () => {
      // The other half, and the reason the rule is conditional: neither of
      // these was ever markup, and both used to be rewritten anyway.
      expect(md('a < b')).toBe('a < b')
      expect(md('x > y')).toBe('x > y')
    })
  })
})
