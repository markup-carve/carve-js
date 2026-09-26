import { describe, expect, it } from 'vitest'
import { fromAstJson, renderAnsi, renderMarkdown, renderPlainText } from '../src/index.js'

// carve-js#2125. PART 12 §27 (CARVE-P12-049): a block in `table_cell.blocks`
// contributes its inline content and no markers, and a code block contributes
// its payload with each newline becoming one space. Every kind that used to
// reach the fallback arm contributed its own SOURCE SPELLING instead.
const table = (blocks: unknown[]) => fromAstJson({
  type: 'document',
  srcByteLength: 0,
  children: [{
    type: 'table',
    rows: [
      { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [{ type: 'text', value: 'H' }] }] },
      { type: 'table_row', cells: [{ type: 'table_cell', header: false, blocks }] },
    ],
  }],
} as never)

const bodyRow = (blocks: unknown[]) => renderMarkdown(table(blocks)).split('\n')[2]

describe('a block cell contributes content, not spelling', () => {
  it('writes a code block payload without its fence or info string', () => {
    expect(bodyRow([{ type: 'code_block', content: 'first\nsecond\n', lang: 'js' }])).toBe('| first second |')
  })

  it('writes the payload without the quoted header or the bracketed label', () => {
    expect(bodyRow([{
      type: 'code_block', content: 'x = 1\n', lang: 'php', header: 'src/Auth.php', label: 'NPM',
    }])).toBe('| x = 1 |')
  })

  it('escapes the payload as text, so code cannot become markup', () => {
    expect(bodyRow([{ type: 'code_block', content: '*not emphasis*\n' }])).toBe('| \\*not emphasis\\* |')
  })

  it('writes a block image as an image, not as an escaped spelling', () => {
    expect(bodyRow([{ type: 'image', src: 'a.png', alt: 'alt text' }])).toBe('| ![alt text](a.png) |')
  })

  // `---` is block decoration, and §27 gives the line-oriented targets none. A
  // thematic break has no inline content, so it contributes no token and the
  // one-space join puts no separator beside it either.
  it('contributes nothing for a thematic break', () => {
    expect(bodyRow([{ type: 'thematic_break' }])).toBe('|  |')
    expect(bodyRow([
      { type: 'paragraph', children: [{ type: 'text', value: 'one' }] },
      { type: 'thematic_break' },
      { type: 'paragraph', children: [{ type: 'text', value: 'two' }] },
    ])).toBe('| one two |')
  })

  it('contributes nothing for a comment or a definition line that renders nothing', () => {
    expect(bodyRow([{ type: 'comment', block: true, content: ' a remark ' }])).toBe('|  |')
    expect(bodyRow([{ type: 'link_reference_definition', label: 'ref', href: 'https://example.com' }])).toBe('|  |')
    expect(bodyRow([{ type: 'citation_definition', key: 'k1', children: [{ type: 'text', value: 'A cited work' }] }]))
      .toBe('|  |')
  })

  // The two kinds whose content no inline node holds keep the target's own
  // spelling: the cell is the only place the Markdown output carries it, and
  // carve#589 refused dropping a definition on this target.
  // PART 12 §27: raw HTML contributes its payload as escaped text, as in
  // carve-rs and carve-php.
  it('keeps a raw block under the target rule for raw HTML', () => {
    expect(bodyRow([{ type: 'raw_block', format: 'html', content: '<b>raw</b>\n' }])).toBe('| \\<b>raw\\</b> |')
  })

  it('keeps an abbreviation definition', () => {
    expect(bodyRow([{ type: 'abbreviation_def', abbr: 'HTML', expansion: 'HyperText Markup Language' }]))
      .toBe('| \\*[HTML\\]: HyperText Markup Language |')
  })

  it('agrees with the plain and ANSI targets on the payload', () => {
    const doc = table([{ type: 'code_block', content: 'first\nsecond\n', lang: 'js' }])
    expect(renderMarkdown(doc)).toContain('| first second |')
    expect(renderPlainText(doc)).toContain('first second')
    expect(renderAnsi(doc)).toContain('first')
  })
})
