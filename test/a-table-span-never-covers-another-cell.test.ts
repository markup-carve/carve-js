import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const body = (source: string) => carveToHtml(source).replace(/\n\s*/g, '').replace(/^.*<tbody>|<\/tbody>.*$/g, '')

/** Place every cell of every row group on the HTML table grid and report a slot taken twice or a row wider than the first. */
function gridErrors(html: string): string[] {
  const errors: string[] = []
  let width: number | null = null
  for (const group of html.matchAll(/<(thead|tbody|tfoot)>([\s\S]*?)<\/\1>/g)) {
    const rows = [...group[2]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!)
    const taken = new Set<string>()
    const rowWidth: number[] = []
    rows.forEach((row, r) => {
      let col = 0
      for (const cell of row.matchAll(/<(td|th)([^>]*)>/g)) {
        const rowspan = Number(/rowspan="(\d+)"/.exec(cell[2]!)?.[1] ?? 1)
        const colspan = Number(/colspan="(\d+)"/.exec(cell[2]!)?.[1] ?? 1)
        while (taken.has(`${r}:${col}`)) col++
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            const slot = `${r + dr}:${col + dc}`
            if (taken.has(slot)) errors.push(`overlap at ${slot}`)
            taken.add(slot)
            rowWidth[r + dr] = Math.max(rowWidth[r + dr] ?? 0, col + dc + 1)
          }
        }
        col += colspan
      }
    })
    for (const w of rowWidth) {
      if (w === undefined) continue
      if (width === null) width = w
      else if (w > width) errors.push(`row ${w} wide, table ${width}`)
    }
  }
  return errors
}

describe('T5: a span never covers another cell (carve#3047)', () => {
  it('lets a ^ under a two-column cell take the marker beside it', () => {
    const source = '|= 2-col header|<|= header|\n|spans 3 rows|foo|bar|\n|^|spans 4 cells|<|\n|^|^|<|\n'
    expect(body(source)).toBe(
      '<tr><td rowspan="3">spans 3 rows</td><td>foo</td><td>bar</td></tr><tr><td rowspan="2" colspan="2">spans 4 cells</td></tr><tr></tr>',
    )
  })

  it('blocks a ^ whose row strip holds a cell', () => {
    expect(body('| a | < |\n| ^ | b |\n')).toBe('<tr><td colspan="2">a</td></tr><tr><td></td><td>b</td></tr>')
  })

  it('blocks a < beside a cell that started in an earlier row', () => {
    expect(body('| a | b | c |\n| p | ^ | < |\n')).toBe(
      '<tr><td>a</td><td rowspan="2">b</td><td>c</td></tr><tr><td>p</td><td></td></tr>',
    )
  })

  it('emits a valid grid for every 3x3 table of cells and markers', () => {
    const alphabet = ['x', '^', '<']
    for (let n = 0; n < alphabet.length ** 9; n++) {
      const cells: string[] = []
      for (let k = 0, v = n; k < 9; k++, v = Math.floor(v / 3)) cells.push(alphabet[v % 3]!)
      const source = [0, 1, 2].map((r) => '| ' + cells.slice(r * 3, r * 3 + 3).join(' | ') + ' |').join('\n') + '\n'
      expect(gridErrors(carveToHtml(source)), source).toEqual([])
    }
  })
})
