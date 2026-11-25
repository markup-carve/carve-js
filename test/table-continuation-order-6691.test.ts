// carve#6691: a cell over several columns holds its continuation fragments column by column (PART 9 §5 T6 of 0.1).
import { describe, expect, it } from 'vitest'
import { encodeTree, parse, parseWithLayout, render, validateLayout } from '../src/index.ts'

const cell = (src: string): string => /<td[^>]*>([^<]*)<\/td>/u.exec(render(src))![1]!

describe('continuation fragments under a spanned cell (carve#6691)', () => {
  it('joins a two-column cell column by column', () => {
    expect(render('| a | < |\n+ b | c |\n+ d | e |\n')).toBe(
      '<table>\n  <tbody>\n    <tr><td colspan="2">a b d c e</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('joins a three-column cell column by column', () => {
    expect(cell('| a | < | < |\n+ b | c | d |\n+ e | f | g |\n')).toBe('a b e c f d g')
  })

  it('keeps the order of the 0.1 pack rows plus-33ad28c8c54b and plus-5ec33eeb981a', () => {
    expect(cell('| ^ | < |\n+ x   | y |\n+ x   | y |\n')).toBe('^ x x y y')
    expect(cell('|  ^ | < |\n+ x | y |\n+ x | y |\n')).toBe('^ x x y y')
  })

  it('joins the fragments of each row of a table column by column', () => {
    const html = render('| a | < |\n+ b | c |\n+ d | e |\n| ^ | < |\n+ f | g |\n+ h | i |\n')
    expect(html).toContain('<td colspan="2">a b d c e</td>')
    expect(html).toContain('<td colspan="2">^ f h g i</td>')
  })

  it('places a node of a fragment that a wider cell reads out of source order', () => {
    const src = '- | a | < |\n  + x | y |\n  + x | `c` |\n  + z | z |\n'
    const code = JSON.stringify(JSON.parse(encodeTree(parse(src)))).match(/"pos":\{[^}]*\},"type":"code"/u)
    expect(code?.[0]).toContain('"startOffset":32')
  })

  it('records a wrap for every fragment, sorted by line', () => {
    const parsed = parseWithLayout('| a | < |\n+ b | c |\n+ d | e |\n')
    validateLayout(parsed.layout)
    const node = parsed.layout.nodes.find((entry) => entry.wraps !== undefined)!
    expect(node.wraps!.map((wrap) => [wrap.line, wrap.offset])).toEqual([[1, 2], [1, 6], [2, 4], [2, 8]])
  })

  it('ends the range of a wide cell at its last piece in the source, whatever its column', () => {
    const parsed = parseWithLayout('| a | < |\n+ b | c |\n+ d |   |\n')
    const node = parsed.layout.nodes.find((entry) => entry.wraps !== undefined)!
    expect([node.startByte, node.endByte]).toEqual([1, 24])
  })

  it('keeps the column order across a comment line between continuation rows', () => {
    expect(cell('| a | < |\n+ b | c |\n%% hi\n+ d | e |\n')).toBe('a b d c e')
  })
})
