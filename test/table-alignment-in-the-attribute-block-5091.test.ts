import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, lintCarve, parse } from '../src/index.js'
import type { Table, TableCell } from '../src/ast.js'

// carve#5091 (D3, with carve#5093 and carve#5094) and carve#4980 stage 1. The rows
// are copied from the spec corpus at carve main, ahead of the pinned submodule.
const CORPUS = [
  { slug: "952-native-head-rows-with-span-placeholders-2", crv: "|={>} Price |{<} < |={~} Stock |\n| 12.50 | EUR | 3 |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\" colspan=\"2\" style=\"text-align: right;\">Price</th><th scope=\"col\" style=\"text-align: center;\">Stock</th></tr>\n  </thead>\n  <tbody>\n    <tr><td style=\"text-align: right;\">12.50</td><td style=\"text-align: left;\">EUR</td><td style=\"text-align: center;\">3</td></tr>\n  </tbody>\n</table>\n", fmt: "|={>} Price |{<} < |={~} Stock |\n| 12.50 | EUR | 3 |\n" },
  { slug: "952-native-head-rows-with-span-placeholders-3", crv: "| <x |\n", html: "<table>\n  <tbody>\n    <tr><td>&lt;x</td></tr>\n  </tbody>\n</table>\n" },
  { slug: "952-native-head-rows-with-span-placeholders-4", crv: "|= \\< |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\">&lt;</th></tr>\n  </thead>\n</table>\n" },
  { slug: "952-native-head-rows-with-span-placeholders-5", crv: "| \\<< |\n", html: "<table>\n  <tbody>\n    <tr><td>&lt;&lt;</td></tr>\n  </tbody>\n</table>\n", fmt: "| \\<< |\n" },
  { slug: "952-native-head-rows-with-span-placeholders-6", crv: "|= ^ |\n| x |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\"></th></tr>\n  </thead>\n  <tbody>\n    <tr><td>x</td></tr>\n  </tbody>\n</table>\n", fmt: "|= ^ |\n| x |\n" },
  { slug: "952-native-head-rows-with-span-placeholders-7", crv: "| =^ |\n|=^x |\n", html: "<table>\n  <tbody>\n    <tr><td>=^</td></tr>\n    <tr><td>=^x</td></tr>\n  </tbody>\n</table>\n", fmt: "| =^ |\n| =^x |\n" },
  { slug: "952-native-head-rows-with-span-placeholders-8", crv: "|\\=^ |\n", html: "<table>\n  <tbody>\n    <tr><td>=^</td></tr>\n  </tbody>\n</table>\n" },
  { slug: "952-native-head-rows-with-span-placeholders-9", crv: "| ^ | a |\n|---|---|\n| 1 | 2 |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\"></th><th scope=\"col\">a</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>\n", fmt: "|= ^ |= a |\n| 1 | 2 |\n" },
  { slug: "952-native-head-rows-with-span-placeholders", crv: "| ^ |= Carve |= Djot |\n| Row spans | yes | no |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\"></th><th scope=\"col\">Carve</th><th scope=\"col\">Djot</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>Row spans</td><td>yes</td><td>no</td></tr>\n  </tbody>\n</table>\n", fmt: "| ^ |= Carve |= Djot |\n| Row spans | yes | no |\n" },
  { slug: "953-a-deprecated-cell-alignment-prefix-reads-as-its-braced-run-2", crv: "|={>} Price |= Item |= Size |= Mood |\n| 12 |{<} pen |{>^} big |{~~} ok |\n|{?v} 3 | ink |{> .num} 9 | fine |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\" style=\"text-align: right;\">Price</th><th scope=\"col\">Item</th><th scope=\"col\">Size</th><th scope=\"col\">Mood</th></tr>\n  </thead>\n  <tbody>\n    <tr><td style=\"text-align: right;\">12</td><td style=\"text-align: left;\">pen</td><td style=\"text-align: right; vertical-align: top;\">big</td><td style=\"text-align: center; vertical-align: middle;\">ok</td></tr>\n    <tr><td style=\"text-align: right; vertical-align: bottom;\">3</td><td>ink</td><td class=\"num\" style=\"text-align: right;\">9</td><td>fine</td></tr>\n  </tbody>\n</table>\n" },
  { slug: "953-a-deprecated-cell-alignment-prefix-reads-as-its-braced-run-3", crv: "|= Name |= < |= Qty |\n| pen |< | 3 |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\" colspan=\"2\">Name</th><th scope=\"col\">Qty</th></tr>\n  </thead>\n  <tbody>\n    <tr><td colspan=\"2\">pen</td><td>3</td></tr>\n  </tbody>\n</table>\n" },
  { slug: "953-a-deprecated-cell-alignment-prefix-reads-as-its-braced-run", crv: "|=> Price |= Item |= Size |= Mood |\n| 12 |< pen |>^ big |~~ ok |\n|?v 3 | ink |>{.num} 9 | fine |\n", html: "<table>\n  <thead>\n    <tr><th scope=\"col\" style=\"text-align: right;\">Price</th><th scope=\"col\">Item</th><th scope=\"col\">Size</th><th scope=\"col\">Mood</th></tr>\n  </thead>\n  <tbody>\n    <tr><td style=\"text-align: right;\">12</td><td style=\"text-align: left;\">pen</td><td style=\"text-align: right; vertical-align: top;\">big</td><td style=\"text-align: center; vertical-align: middle;\">ok</td></tr>\n    <tr><td style=\"text-align: right; vertical-align: bottom;\">3</td><td>ink</td><td class=\"num\" style=\"text-align: right;\">9</td><td>fine</td></tr>\n  </tbody>\n</table>\n" },
]

// tests/lint-rule-vectors/deprecated-cell-alignment.json at carve main.
const LINT_VECTORS: Array<[string, number[][]]> = [
  ["|=> Price |\n| 12 |\n", [[1, 3]]],
  ["|?v x |\n", [[1, 2]]],
  ["|{>^} x |\n", []],
  ["| < | ^ |\n", []],
]

// resources/spec/table-alignment-lint-vectors.json at carve main.
const FIX_VECTORS: Array<[string, string]> = [
  ["|=> Price |\n| 12 |\n", "|={>} Price |\n| 12 |\n"],
  ["|?v x |\n", "|{?v} x |\n"],
  ["|>{.num} 9 |\n", "|{> .num} 9 |\n"],
  ["|>^ x |\n", "|{>^} x |\n"],
  ["| < | ^ |\n", "| < | ^ |\n"],
]

const cell = (source: string, row = 0, column = 0): TableCell =>
  (parse(source).children[0] as Table).rows[row]!.cells[column]!
const shape = ({ header, span, align, valign, attrs }: TableCell) => ({ header, span, align, valign, classes: attrs?.classes })
const tree = (source: string): string => JSON.stringify(parse(source).children, (key, value: unknown) => key === 'pos' ? undefined : value)

describe('table cell alignment in the attribute block (carve#5091)', () => {
  it.each(CORPUS)('$slug renders and formats as the spec corpus', ({ crv, html, fmt }) => {
    expect(carveToHtml(crv).trim()).toBe(html.trim())
    if (fmt !== undefined) expect(carveToCarve(crv)).toBe(fmt)
  })

  it('reads glued alignment symbols leading the block', () => {
    expect(shape(cell('|{>^ .num} x |\n'))).toEqual({ header: false, span: undefined, align: 'right', valign: 'top', classes: ['num'] })
    expect(shape(cell('|{?v} x |\n'))).toEqual({ header: false, span: undefined, align: undefined, valign: 'bottom', classes: undefined })
    expect(shape(cell('|={~} x |\n'))).toEqual({ header: true, span: undefined, align: 'center', valign: undefined, classes: undefined })
  })

  it.each(['|{> ^} x |', '|{> ^ ~} x |', '|{.num >} x |', '|{?} x |', '|{>\t.x} x |', '|{>\u00a0.x} x |', '|{> \t.x} x |'])(
    'leaves an invalid block literal: %j', (source) => {
      const read = cell(`${source}\n`)
      expect(read.align ?? read.valign ?? read.attrs).toBeUndefined()
    })

  it('reads the deprecated 0.1.13 prefix as the tree of its braced spelling', () => {
    for (const [legacy, braced] of [['|=> P |\n| 1 |\n', '|={>} P |\n| 1 |\n'], ['|?v x |\n', '|{?v} x |\n'], ['|>{.n} 9 |\n', '|{> .n} 9 |\n'], ['|>^ x |\n', '|{>^} x |\n']]) {
      expect(tree(legacy)).toBe(tree(braced))
      expect(carveToHtml(legacy)).toBe(carveToHtml(braced))
    }
    expect(shape(cell('|=< |\n'))).toEqual({ header: true, span: undefined, align: 'left', valign: undefined, classes: undefined })
  })

  it('reads header-kind and aligned span placeholders', () => {
    expect(shape(cell('|= ^ |\n'))).toMatchObject({ header: true, span: 'rowspan' })
    expect(shape(cell('|= < |\n'))).toMatchObject({ header: true, span: 'colspan' })
    expect(shape(cell('|{<} < |\n'))).toMatchObject({ header: false, span: 'colspan', align: 'left' })
    expect(cell('|{.x} < |\n').span).toBeUndefined()
    expect(cell('|=^ |\n').span).toBeUndefined()
  })

  it.each(LINT_VECTORS)('lints %j as the shared vector', (source, findings) => {
    const found = lintCarve(source).filter(w => w.rule === 'deprecated-cell-alignment')
    expect(found.map(w => [w.line, w.column])).toEqual(findings)
    for (const w of found) {
      expect(w.message).toContain('deprecated')
      expect(w.message).toContain('fmt')
    }
  })

  it.each(FIX_VECTORS)('fmt moves the prefix of %j into the block', (source, fixed) => {
    expect(carveToCarve(source)).toBe(fixed)
    expect(carveToHtml(fixed)).toBe(carveToHtml(source))
  })
})

describe('the canonical writer never writes a separator row (carve#4980)', () => {
  it.each([
    ['| ^ | a |\n|---|---|\n| 1 | 2 |\n', '|= ^ |= a |\n| 1 | 2 |\n'],
    ['| < | a |\n|---|---|\n| 1 | 2 |\n', '|= < |= a |\n| 1 | 2 |\n'],
    ['| ^ |\n|---|\n| x |\n', '|= ^ |\n| x |\n'],
    ['| < |\n|---|\n| x |\n', '|= < |\n| x |\n'],
    ['| ^ |={>} b |\n|-:|---|\n| c | d |\n', '|={>} ^ |={>} b |\n| c | d |\n'],
    ['| Wide | < | Last |\n|--:|:--|:-:|\n|a|b|c|\n', '|={>} Wide |={<} < |={~} Last |\n| a | b | c |\n'],
  ])('writes %j natively with the same HTML and tree', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(tree(written).replace(/,"separatorWidths":\[[0-9,]*\]/g, '')).toBe(tree(source).replace(/,"separatorWidths":\[[0-9,]*\]/g, ''))
    expect(carveToCarve(written)).toBe(written)
  })

  it('keeps an authored separator row in the preservation mode', () => {
    const source = '| ^ | a |\n|---|---|\n| 1 | 2 |\n'
    expect(carveToCarve(source, { preserveTableSeparators: true })).toBe(source)
  })

  it('lets an orphan placeholder take its head row kind', () => {
    expect(carveToHtml('| ^ |= a |\n| 1 | 2 |\n')).toContain('<thead>\n    <tr><th scope="col"></th><th scope="col">a</th></tr>')
    expect(carveToHtml('| ^ |\n| x |\n')).not.toContain('<thead>')
  })
})
