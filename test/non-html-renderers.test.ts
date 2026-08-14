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
  /*
   * PART 11 §10c. This used to pin the OPPOSITE - the attribution as a sibling
   * separated by a blank line - and that spacing was the defect: the words
   * survived but the attachment did not, so a reader (and a re-parse) saw a
   * paragraph that merely followed a quotation rather than its source.
   *
   * Each target keeps the attachment with what it actually has: Markdown a
   * `<footer>` element inside the quote, the terminal its own quote bar, plain
   * text adjacency (no blank line).
   */
  it('keeps blockquote attribution attached to its quote', () => {
    const src = '> q\n^ Attr'

    expect(carveToMarkdown(src)).toBe('> q\n>\n> <footer>Attr</footer>\n')
    expect(carveToPlainText(src)).toBe('"q"\nAttr\n')
    expect(carveToAnsi(src)).toBe(
      '\x1b[36m\x1b[2m│\x1b[0m q\n\x1b[36m\x1b[2m│\x1b[0m\n\x1b[36m\x1b[2m│\x1b[0m \x1b[3m\x1b[2mAttr\x1b[0m\n',
    )
  })

  it('leaves a quote with no attribution alone', () => {
    // The change adds a line only where the author wrote an attribution.
    expect(carveToMarkdown('> q\n')).toBe('> q\n')
    expect(carveToPlainText('> q\n')).toBe('"q"\n')
    expect(carveToAnsi('> q\n')).toBe('\x1b[36m\x1b[2m│\x1b[0m q\n')
  })

  it('keeps a block after an attributed quote separate', () => {
    expect(carveToMarkdown('> q\n^ A\n\nafter\n')).toBe('> q\n>\n> <footer>A</footer>\n\nafter\n')
    expect(carveToPlainText('> q\n^ A\n\nafter\n')).toBe('"q"\nA\n\nafter\n')
  })

  it('keeps a code-fence header in Markdown output', () => {
    expect(carveToMarkdown('```js "Title"\nx\n```')).toBe('```js "Title"\nx\n```\n')
  })

  it('renders critic deletion as del HTML in Markdown output', () => {
    expect(carveToMarkdown('{-del-}')).toBe('<del>del</del>\n')
    expect(carveToMarkdown('{+ins+}')).toBe('<ins>ins</ins>\n')
  })

  /*
   * docs/graceful-degradation.md states the floor as a MUST: a renderer may drop
   * a construct's INTERACTION but not its WORDS. Three kinds of authored text
   * were dropped outright while this whole file stayed green, because nothing
   * asserted that a caption or a fence header reached these targets at all.
   *
   * The first three cases are the losses; the last three are CONTROLS that
   * already held, and they are what makes the first three a defect rather than a
   * limitation of the targets - an image caption and a listing caption survive
   * the same target the table's caption did not. carve-php and carve-rs dropped
   * exactly the same three, so `compare:impls` could never have caught it
   * (markup-carve/carve#1179).
   */
  it.each([
    ['table caption', '|= H |\n| a |\n^ Table caption\n', 'Table caption'],
    ['fence header', '``` js "src/app.js"\nlet a = 1\n```\n', 'src/app.js'],
    ['grouping label', '``` js [Node]\na\n```\n', 'Node'],
    ['image caption (control)', '![alt](i.png)\n^ Figure caption\n', 'Figure caption'],
    ['listing caption (control)', '``` js\nlet a = 1\n```\n^ Listing caption\n', 'Listing caption'],
    ['admonition title (control)', '::: note "Title"\nbody\n:::\n', 'Title'],
  ])('keeps authored text on every presentation target: %s', (_name, src, authored) => {
    // Containment, not bytes: a renderer may keep changing HOW it presents these
    // and still be held to keeping them.
    for (const [target, render] of [
      ['markdown', carveToMarkdown],
      ['plain', carveToPlainText],
      ['ansi', carveToAnsi],
    ] as const) {
      expect(render(src), `the ${target} target dropped ${JSON.stringify(authored)}`).toContain(
        authored,
      )
    }
  })

  it('puts a table caption on its own line under the table', () => {
    // The shape an image and a listing caption already use on this target.
    expect(carveToMarkdown('|= H |\n| a |\n^ Table caption\n')).toBe(
      '| H |\n| --- |\n| a |\nTable caption\n',
    )
    // A table with no caption is untouched - the line appears only where the
    // author wrote one.
    expect(carveToMarkdown('|= H |\n| a |\n')).toBe('| H |\n| --- |\n| a |\n')
    // And a following block keeps its blank-line separation.
    expect(carveToMarkdown('|= H |\n| a |\n^ Cap\n\nafter\n')).toBe(
      '| H |\n| --- |\n| a |\nCap\n\nafter\n',
    )
  })

  it('carries the fence header and label on the terminal rule line', () => {
    // They join the rule the renderer already draws, so a captioned fence still
    // reads as one block rather than three.
    const ansi = carveToAnsi('``` js "src/app.js" [Node]\nlet a = 1\n```\n')
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, '')).toContain('┌── js src/app.js [Node]')
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
