import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  renderMarkdown,
  renderPlainText,
} from '../src/index.js'
import type { Document, Table, Text } from '../src/ast.js'

const text = (value: string): Text => ({ type: 'text', value })

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
  it('renders a captioned quote through the generic figure path', () => {
    const src = '> q\n^ Attr'

    expect(carveToMarkdown(src)).toBe('> q\n\nAttr\n')
    expect(carveToPlainText(src)).toBe('"q"\n\nAttr\n')
    expect(carveToAnsi(src)).toBe('\x1b[36m\x1b[2m│\x1b[0m q\n\n\x1b[3m\x1b[2mAttr\x1b[0m\n')
  })

  it('leaves a quote with no attribution alone', () => {
    expect(carveToMarkdown('> q\n')).toBe('> q\n')
    expect(carveToPlainText('> q\n')).toBe('"q"\n')
    expect(carveToAnsi('> q\n')).toBe('\x1b[36m\x1b[2m│\x1b[0m q\n')
  })

  it('keeps a block after a captioned quote separate', () => {
    expect(carveToMarkdown('> q\n^ A\n\nafter\n')).toBe('> q\n\nA\n\nafter\n')
    expect(carveToPlainText('> q\n^ A\n\nafter\n')).toBe('"q"\n\nA\n\nafter\n')
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

  it('separates a table caption from the table by a blank line', () => {
    // PART 11 §10e T2. The blank line is the whole point: written directly
    // after the last row, the caption is read by a GFM reader as ANOTHER ROW,
    // so the words come back as a fabricated data cell. Surviving that way is
    // worse than being dropped, because neither a reader nor a parser can tell
    // the cell from one the author wrote.
    expect(carveToMarkdown('|= H |\n| a |\n^ Table caption\n')).toBe(
      '| H |\n| --- |\n| a |\n\nTable caption\n',
    )
    // A table with no caption is untouched - the line appears only where the
    // author wrote one.
    expect(carveToMarkdown('|= H |\n| a |\n')).toBe('| H |\n| --- |\n| a |\n')
    // And a following block keeps its blank-line separation.
    expect(carveToMarkdown('|= H |\n| a |\n^ Cap\n\nafter\n')).toBe(
      '| H |\n| --- |\n| a |\n\nCap\n\nafter\n',
    )
  })

  it('separates a table caption from the table on the figure path too', () => {
    // A `figure` whose target is a `table` is not reachable from Carve source -
    // `^ cap` under a table sets the table's own caption - but it is reachable
    // through the public renderer and the AST-JSON ingest path. That branch kept
    // an EMPTY separator, correct only while a table dropped its caption
    // outright: since it stopped doing that, the caption was welded onto the
    // last row's closing pipe (`| a |Fruit prices`), which is the fabricated
    // cell §10e names, with no newline at all to soften it.
    const table: Table = {
      type: 'table',
      rows: [
        { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [text('H')] }] },
        { type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [text('a')] }] },
      ],
    }
    const doc: Document = {
      type: 'document',
      children: [{ type: 'figure', target: table, caption: [text('Fruit prices')] }],
    }
    expect(renderMarkdown(doc)).toBe('| H |\n| --- |\n| a |\n\nFruit prices\n')
    // The plain target is not ruled by §10e, but it welded the caption on the
    // same way (`aFruit prices`). It takes the position this target's own table
    // renderer already uses - its own line - rather than an invented one.
    expect(renderPlainText(doc)).toBe('H\na\nFruit prices\n')
  })

  it('gives a fence title and label a bold standalone line each on the terminal', () => {
    // PART 11 §10e T1: they render the way a fenced div's already do - title
    // first, label second, a blank line after each, above the block. Folding
    // them into the `┌── ` rule instead was considered and rejected, because
    // that rule exists only when the fence has a LANGUAGE.
    expect(carveToAnsi('``` php "src/Auth.php" [Composer]\ncomposer require x\n```\n')).toBe(
      '\x1b[1msrc/Auth.php\x1b[0m\n\n' +
        '\x1b[1mComposer\x1b[0m\n\n' +
        '\x1b[2m┌── php \x1b[0m\n' +
        '\x1b[97m  composer require x\x1b[0m\n',
    )
    // Each token alone, in the same slot it takes when both are present.
    expect(carveToAnsi('```php "src/Auth.php"\n$ok = true;\n```\n')).toBe(
      '\x1b[1msrc/Auth.php\x1b[0m\n\n\x1b[2m┌── php \x1b[0m\n\x1b[97m  $ok = true;\x1b[0m\n',
    )
    expect(carveToAnsi('```php [NPM]\nnpm install x\n```\n')).toBe(
      '\x1b[1mNPM\x1b[0m\n\n\x1b[2m┌── php \x1b[0m\n\x1b[97m  npm install x\x1b[0m\n',
    )
    // The language keeps the slot this target already gave it: a fence with
    // neither token is byte-identical to before, and a fence with no language
    // still draws no rule line - which is exactly why the tokens could not join
    // one.
    expect(carveToAnsi('```php\n$ok = true;\n```\n')).toBe(
      '\x1b[2m┌── php \x1b[0m\n\x1b[97m  $ok = true;\x1b[0m\n',
    )
    expect(carveToAnsi('``` "src/app.js"\nconst a = 1\n```\n')).toBe(
      '\x1b[1msrc/app.js\x1b[0m\n\n\x1b[97m  const a = 1\x1b[0m\n',
    )
  })

  it('renders a fence title and label the way a div already renders them', () => {
    // §10e T1 writes down an existing rule rather than a new one: a fence
    // carries the SAME two tokens in the SAME two slots as `::: note "T" [L]`,
    // so it renders them the same way. Stripped of styling, the two are equal
    // above the block on both targets that lost them.
    const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')
    const div = '::: note "T" [L]\nbody\n:::\n'
    const fence = '``` js "T" [L]\nbody\n```\n'
    for (const render of [carveToPlainText, carveToAnsi]) {
      expect(strip(render(fence)).startsWith(strip(render(div)).slice(0, 'T\n\nL\n\n'.length))).toBe(
        true,
      )
    }
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
