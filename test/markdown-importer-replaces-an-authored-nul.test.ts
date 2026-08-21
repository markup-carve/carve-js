import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'

/**
 * The Markdown importer replaces an authored U+0000, and its placeholders are
 * safe because of that.
 *
 * `convertInline` protects code spans, escapes and converted emphasis behind
 * `\x00P<n>\x00` / `\x00S<n>\x00` and splices them back by index. The comment
 * over the allocation said the shape was safe because NUL "cannot occur in the
 * source text" - an assumption about a FILE, while the node API hands
 * `markdownToCarve` whatever string a host has. An authored `\x00P0\x00`
 * answered the restore and came back as the span stored in slot 0, so text from
 * elsewhere in the document landed where the author's characters were; an
 * authored one INSIDE a code span made that span hold its own key and the
 * restore loop never terminated at all (carve-js#1291).
 *
 * The remedy is the one CommonMark 2.3 already prescribes for the flavour this
 * converter reads, and the one `parse` already applies to Carve source: a U+0000
 * in the input is replaced by U+FFFD before anything reads it. That is a
 * conformance fix in its own right - a NUL spelled `&#0;` was replaced and a raw
 * one was not - and it leaves the wrapper's alphabet provably absent from the
 * text it wraps.
 *
 * Same family as the BBCode importer's picked stash key (carve-js#1290,
 * carve-js#1292) and the writer's picked marker runs (carve-js#1289), and
 * deliberately NOT the same remedy: a private-use run is drawn from characters a
 * document may legitimately carry, so picking one needs a refusal when the area
 * is full. NUL is not text this converter may emit at all.
 */

const NUL = '\u0000'
const FFFD = '\ufffd'

describe('the Markdown importer replaces an authored NUL rather than reading it as a placeholder', () => {
  it("does not splice a stored code span over the author's own characters", () => {
    // THE TICKET'S MEASUREMENT. On main this returned "x `code` y `code` z":
    // the author's four characters became the code span protected later in the
    // same line, and nothing in the result says so.
    const markdown = `x ${NUL}P0${NUL} y \`code\` z`

    expect(markdownToCarve(markdown)).toBe(`x ${FFFD}P0${FFFD} y \`code\` z`)
  })

  it('does the same for the stash family, which holds converted emphasis', () => {
    // The other placeholder family in the same function. `**bold**` is held
    // behind `\x00S0\x00` so the emphasis passes below cannot re-match its
    // single `*`, and on main an authored `\x00S0\x00` was replaced by it:
    // "x *bold* y *bold* z".
    const markdown = `x ${NUL}S0${NUL} y **bold** z`

    expect(markdownToCarve(markdown)).toBe(`x ${FFFD}S0${FFFD} y *bold* z`)
  })

  it('terminates on a placeholder authored inside a code span', () => {
    // THE WORST SHAPE, and it is not a substitution. The code span is protected
    // FIRST, so slot 0 held a span containing slot 0's own key; the restore loop
    // repeats until the text stops changing, and this never stopped. A host
    // calling the converter on such a document hung, with no output and no
    // error.
    const markdown = `a \`b${NUL}P0${NUL}c\` d \`code\` e`

    expect(markdownToCarve(markdown)).toBe(`a \`b${FFFD}P0${FFFD}c\` d \`code\` e`)
  })

  it('replaces a NUL that is not placeholder-shaped at all', () => {
    // A bare NUL was passed through to the output on main, which is the
    // conformance half on its own: CommonMark 2.3 replaces it, `parse` replaces
    // it in Carve source, and `&#0;` was already replaced here.
    expect(markdownToCarve(`a${NUL}b`)).toBe(`a${FFFD}b`)
  })

  it('agrees with the entity spelling of the same character', () => {
    // The two spellings used to disagree: `&#0;` went through `decodeCodePoint`
    // and came back U+FFFD, a raw one did not.
    expect(markdownToCarve(`a &#0; b`)).toBe(markdownToCarve(`a ${NUL} b`))
  })

  it('stops an authored NUL standing in for a placeholder end before an attribute list', () => {
    // A THIRD READING of the same byte, from `escapeAttributeListsThatAttach`:
    // its lookbehind treats `\x00` as "a placeholder ended here", so an attribute
    // list after one was escaped as though it attached to a Carve inline
    // element. After the replacement the brace follows ordinary text, which
    // attaches to nothing, and is left alone.
    expect(markdownToCarve(`a${NUL}{.c} b`)).toBe(`a${FFFD}{.c} b`)
  })

  it('replaces a NUL inside a fenced code block', () => {
    const markdown = `\`\`\`\na${NUL}b\n\`\`\``

    expect(markdownToCarve(markdown)).toBe(`\`\`\`\na${FFFD}b\n\`\`\``)
  })

  it('replaces a NUL in frontmatter, which is otherwise carried verbatim', () => {
    // Frontmatter survives byte for byte, and the replacement is still upstream
    // of that: CommonMark 2.3 normalizes the INPUT, before anything decides what
    // part of it is a block.
    const markdown = `---\ntitle: a${NUL}b\n---\n\ntext`

    expect(markdownToCarve(markdown)).toBe(`---\ntitle: a${FFFD}b\n---\n\ntext`)
  })

  it('never emits a NUL for any of these', () => {
    for (const markdown of [
      `x ${NUL}P0${NUL} y \`code\` z`,
      `x ${NUL}S0${NUL} y **bold** z`,
      `a \`b${NUL}P0${NUL}c\` d \`code\` e`,
      `a${NUL}b`,
      `---\ntitle: a${NUL}b\n---\n\ntext`,
    ]) {
      expect(markdownToCarve(markdown)).not.toContain(NUL)
    }
  })

  it('converts an ordinary document exactly as before', () => {
    // The controls. No document anyone wrote carries a NUL, so the replacement
    // pass finds nothing and every other row in test/markdown-migrate.test.ts
    // still describes the output.
    expect(markdownToCarve('**bold** and *italic* and `code`')).toBe(
      '*bold* and /italic/ and `code`',
    )
    expect(markdownToCarve('a \\* b')).toBe('a \\* b')
    expect(markdownToCarve('***bi*** and __b__')).toBe('/*bi*/ and *b*')
  })
})
