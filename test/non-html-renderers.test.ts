import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * SELF-REGRESSION snapshots for the non-HTML renderers: this engine's own
 * Markdown / PlainText / ANSI output, captured in
 * fixtures/non-html-golden.json, which it must keep reproducing.
 *
 * IT DOES NOT CHECK CROSS-ENGINE AGREEMENT, and it used to say it did - the
 * header called the golden "carve-php's output" and the twin file in carve-rs
 * concluded from the same premise that "all three impls agree". Nothing here
 * invokes carve-php. A committed snapshot cannot enforce a statement about
 * another engine in either direction: carve-php could move away from it with
 * nothing failing, and the file could be regenerated from this engine with
 * nothing checking that carve-php still produces it.
 *
 * Both happened. carve-php ran a block image into the following paragraph on
 * the plain and ANSI targets while both snapshots stayed green, and the two
 * files had drifted apart from each other - 31 cases here against 34 there,
 * different names for the same constructs, and a same-named case with
 * different source input. Two hand-maintained files both calling themselves
 * "carve-php's output" is the evidence that neither was derived from carve-php
 * (carve-js#762, carve-rs#692).
 *
 * THE THREE-WAY PROPERTY LIVES IN `npm run compare:impls` in the spec repo,
 * which runs markdown, plain and ansi through all three engines over the whole
 * corpus and reports engine-to-engine diffs per target. That gate can fail,
 * and it is where a shape has to be COVERED for the property to mean anything:
 * the block-image case was invisible to it only because no corpus document had
 * a block image followed by another block (fixed in markup-carve/carve#849).
 *
 * So: keep adding cases here to pin THIS engine against its own regressions.
 * To assert that the engines agree, put the shape in the spec corpus.
 */
const here = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(
  readFileSync(resolve(here, 'fixtures/non-html-golden.json'), 'utf8'),
) as Record<string, { carve: string; markdown: string; plain: string; ansi: string }>

for (const [name, g] of Object.entries(golden)) {
  describe(`non-html parity: ${name}`, () => {
    it('markdown', () => expect(carveToMarkdown(g.carve)).toBe(g.markdown))
    it('plain', () => expect(carveToPlainText(g.carve)).toBe(g.plain))
    it('ansi', () => expect(carveToAnsi(g.carve)).toBe(g.ansi))
  })
}

describe('non-html renderer parity fixes', () => {
  it('keeps blockquote attribution separated from the quote body', () => {
    const src = '> q\n^ Attr'

    expect(carveToMarkdown(src)).toBe('> q\n\nAttr\n')
    expect(carveToPlainText(src)).toBe('"q"\n\nAttr\n')
    expect(carveToAnsi(src)).toBe('\x1b[36m\x1b[2m│\x1b[0m q\n\n\x1b[3m\x1b[2mAttr\x1b[0m\n')
  })

  it('keeps a code-fence header in Markdown output', () => {
    expect(carveToMarkdown('```js "Title"\nx\n```')).toBe('```js "Title"\nx\n```\n')
  })

  it('renders critic deletion as del HTML in Markdown output', () => {
    expect(carveToMarkdown('{-del-}')).toBe('<del>del</del>\n')
    expect(carveToMarkdown('{+ins+}')).toBe('<ins>ins</ins>\n')
  })

  it('renders link text, not link destinations, in plain text output', () => {
    expect(carveToPlainText('[t](u)')).toBe('t\n')
    expect(carveToPlainText('[t](u "ti")')).toBe('t\n')
    expect(carveToPlainText('[a][r]\n\n[r]: /u "T"')).toBe('a\n')
    expect(carveToPlainText('<https://x>')).toBe('https://x\n')
  })

  it('preserves inline code color inside ANSI table header bold styling', () => {
    const src = '| `a|b` | c |\n|--|--|\n| d | e |'

    expect(carveToAnsi(src)).toContain('\x1b[1m\x1b[93ma|b\x1b[0m\x1b[0m')
    expect(carveToAnsi(src)).toContain('\x1b[1mc\x1b[0m')
  })
})

describe('renderer depth caps (issue 517)', () => {
  it('keeps the innermost content of a document nested at the parser cap, in every target', async () => {
    // Each renderer bounded its recursion at the parser's own MAX_NESTING_DEPTH
    // and emits nothing past the bound, so a document nested at exactly the cap
    // parsed fine and then rendered with its content in HTML and without it in
    // markdown, plain text and ansi.
    const { MAX_NESTING_DEPTH } = await import('../src/parse.js')
    const {
      carveToHtml: html,
      carveToMarkdown: md,
      carveToPlainText: plain,
      carveToAnsi: ansi,
      carveToCarve: carve,
    } = await import('../src/index.js')

    const src = '::: note\n'.repeat(MAX_NESTING_DEPTH) + 'body\n'
    for (const [target, render] of Object.entries({ html, md, plain, ansi, carve })) {
      expect(render(src), `${target} dropped the innermost content`).toContain('body')
    }
  })
})
