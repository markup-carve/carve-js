// C2-H-195, C2-H-196: each row of the loss table, and Examples 51 and 52 of the HTML document, rendered with `roundtrip`,
// imported and written again by the canonical writer. Row 11 starts from a supplied tree and has no source to render.
import { describe, expect, it } from 'vitest'
import { render, type RenderOptions } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'

const FENCE = '```'

// [row, input, the source the import gives back, render options]
const ROWS: readonly (readonly [number | string, string, string, RenderOptions?])[] = [
  [1, 'a\rb', 'a\nb'],
  [2, `${FENCE}=html\n<b>x</b>\n${FENCE}`, `${FENCE}html\n<b>x</b>\n${FENCE}`, { rawHtml: false }],
  [3, 'a\\ b', 'a b'],
  [4, '::: |\n\\ a\n:::', '::: |\n a\n:::'],
  [5, 'a\n\\\nb', 'a\\\nb'],
  [6, `{table}\n${FENCE}csv\nx\n"2\n3"\n${FENCE}`, '|= x |\n| 2 3 |'],
  [7, '{aligns="center"}\n|= a |\n| b |', '|={~} a |\n| b |'],
  ['C2-H-119 declared head count', `{table header-rows=2}\n${FENCE}csv\na\nb\nc\n${FENCE}`, '|= a |\n|= b |\n| c |'],
  [8, '{.toc}\n:::\na\n:::', '::: toc\na\n:::'],
  [9, '[x]{.ext-a}', ':a[x]'],
  [10, '[x]{lang=de}', '[x]{:de}'],
  [12, '[s]{Clk=v}', '[s]{clk=v}'],
  [13, '[Intro][]\n\n[Intro]: #intro\n\n{#intro}\n# Intro', '[Intro][]\n\n{#intro}\n= Intro'],
  [14, '[x][r]\n\n{.c}\n[r]: /u', '[x][r]{.c}\n\n[r]: /u'],
]

const backAgain = (src: string, options?: RenderOptions): string =>
  importDocument(render(src, { ...options, roundtrip: true }), { from: 'html' }).source.replace(/\n$/u, '')

describe('C2-H-195: the facts that do not survive a render with roundtrip and an import', () => {
  for (const [row, input, back, options] of ROWS) {
    it(typeof row === 'number' ? `C2-H-195 row ${row}` : row, () => {
      expect(backAgain(input, options)).toBe(back)
    })
  }
})

describe('C2-H-191 to C2-H-194: the rebuilt definitions of Examples 51 and 52', () => {
  it('C2-H-191: Example 51, one definition of r after the last block; the unused one, the later one and the place are gone', () => {
    const src = '[a][r] and [b][r], [r][] and [r].\n\n[u]: /unused\n\n[r]: /dest "Title"\n\nTail.\n\n[r]: /later'
    expect(backAgain(src)).toBe('[a][r] and [b][r], [r][] and [r].\n\nTail.\n\n[r]: /dest "Title"')
  })

  it('C2-H-194: Example 52, the notes in the order of the notes after the blocks, and no definition of an inline note', () => {
    const src = 'A[^n], B[^m] and ^[inline] C[^n].\n\n[^u]: Unused.\n\n[^m]: M.\n\nMiddle.\n\n[^n]: N.'
    expect(backAgain(src)).toBe('A[^n], B[^m] and ^[inline] C[^n].\n\nMiddle.\n\n[^n]: N.\n\n[^m]: M.')
  })
})
