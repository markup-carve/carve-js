import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import type { ParagraphNode, TableCellNode, TextNode } from '../src/ast-nodes.ts'
import { createCheck } from '../src/write-check.ts'
import { writtenTextStarts } from '../src/write-kinds.ts'
import { createWriter } from '../src/write-state.ts'

const cases: readonly [number, number, string, string][] = [
  [6561, 1, "- \\{\\*\\{b{}*}{*", "- \\{\\*{b{}\\*}\\{*\n"],
  [6561, 2, ",}{{,,},,{,^^,\\}", ",}{\\{,,},,\\{,^^,}\n"],
  [6561, 3, "- {^{^\\^{\\^\\,\\}^}", "- \\{^{^^\\{^,}^}\n"],
  [6561, 4, ">   /}{*a\\}.*\\}b{*", "> /}\\{\\*a}.\\*}b\\{*\n"],
  [6561, 5, "z\\}*{*zcz*\\}{/{**}", "z}*\\{\\*zcz*}{/\\{**}\n"],
  [6561, 6, "x {{{^^}} {^}^^\\}\\,", "x {{\\{^^}} \\{^}^^},\n"],
  [6561, 7, "- c{//}\\{\\/{//}\\`a/}", "- c\\{//}\\{\\/\\{//}`a/}\n"],
  [6561, 8, "- `c``c`b`c`{*{**}z*\\}", "- `c``c`b`c`\\{\\*\\{**}z*}\n"],
  [6561, 9, "1. c\\{\\/a©}/}{/^.*}{//}", "1. c\\{\\/a©}\\/}\\{\\/^.*}\\{//}\n"],
  [6561, 10, "x {**}{*z\\``c`\\*}^{//}z", "x \\{**}\\{\\*z\\``c`\\*}^{//}z\n"],
  [6561, 11, "- *\\} b{**}`c`\\`b{*/}\\*}", "- \\*} b\\{**}`c`\\`b\\{\\*/}\\*}\n"],
  [6561, 12, "- }{\\}\\{^}\\,^^}{,,\\}{a{^,}", "- }{}\\{^},^^}{,\\,}{a\\{^,}\n"],
  [6561, 13, "x ,\\}^,,^{^{\\^,,}\\,^}{^,,}", "x ,}^,,^{^\\{^,,},^}\\{^,,}\n"],
  [6561, 14, "^}\\,}{,{^^}{^^},\\}},,{{,,}", "^},}\\{,{^^}{^^},}},,{\\{,,}\n"],
  [6561, 15, "- {,,}{,{{^, \\{^^{,,}^}{^\\}", "- {,,}{,{{^, \\{^^{,,}^}\\{^}\n"],
  [6561, 16, "1. ^},{\\,\\^{^,\\}^{\\{,}^{^^}", "1. ^},\\{,^{^,}^{\\{,}^{^^}\n"],
  [6561, 17, "1. {,{^\\{,,\\}\\}^^\\},{^\\{{^\\,", "1. {,\\{^{,,}}^^},\\{^{\\{^,\n"],
  [6561, 18, "> ,,a{,,}{,a,\\}\\}{,,}{\\{{,,}", "> ,,a\\{,,}\\{,a,}}\\{,,}{{\\{,,}\n"],
  [6561, 19, "> {^^^^^\\{{^^}{{^^} ,,^\\,\\^}{", "> \\{^^^^^{\\{^^}{\\{^^} ,,^,^}{\n"],
  [6561, 20, "> \\^{{,,} \\{^^^}^},,,}{,\\{{^^^", "> ^{{,,} \\{^^^}^},,,}{,{\\{^^^\n"],
  [6561, 21, "> `c`{*`c`{**}a{**}\\//\\/*\\}\\/{*", "> `c`\\{\\*`c`\\{\\*\\*}a\\{**}///\\*}/\\{*\n"],
  [6561, 22, ">  }\\}, {^^}{,{^{^^}\\{^^^}{,,}{", "> }}, \\{^^}{,{^\\{^\\^}\\{^^^}{,,}{\n"],
  [6561, 23, "1.  ^}{,,},{^{,,}^^\\}\\,,{,,}{{^,,", "1. ^}{,,},\\{^{,,}^^},,{,,}{\\{^,,\n"],
  [6561, 24, "x ^^\\^{^^^\\}^^{,\\^\\,{^^},,\\{{^^}\\^", "x ^^^\\{^^^}^^{,^,\\{^^},,{\\{^^}^\n"],
  [6561, 25, "{*{**}/{**}\\*\\}{//}`c`{*{\\{\\`\\}{//}", "\\{\\*\\{\\*\\*}/\\{**}\\*}{//}`c`\\{\\*{{`}{//}\n"],
  [6559, 1, "> \\,^{^^}{^}^}\\{a\\}a\\{{^{", "> ,^\\{^^}{^}^}\\{a}a\\{{^\\{\n"],
  [6559, 2, "1. \\`^{/\\`c`c`\\{a}\\` {**}/}", "1. \\`^/\\`c`c`\\{a}\\` \\{**}/\n"],
]

it.each(cases)('carve#%i shape %i follows its Expected section and reads back', (_ticket, _shape, source, expected) => {
  const written = format(source)
  expect(written).toBe(expected)
  expect(treesEqual(parse(written), parse(source))).toBe(true)
})

it('locates the later text leaf when two leaves have the same value', () => {
  const first: TextNode = { type: 'text', value: '{^a^}' }
  const second: TextNode = { type: 'text', value: '{^a^}' }
  const paragraph: ParagraphNode = { type: 'paragraph', children: [first, { type: 'code', value: 'c' }, second] }
  const check = createCheck(createWriter(null, false))
  const starts = writtenTextStarts(check, [paragraph], '{^a^}`c`{^a^}\n')
  expect(starts.get(first)?.[0]).toBe(0)
  expect(starts.get(second)?.[0]).toBe(8)
})

it('does not locate a text leaf inside an earlier code span', () => {
  const text: TextNode = { type: 'text', value: '{^a^}' }
  const source = '`{^a^}`{^a^}\n'
  const paragraph: ParagraphNode = { type: 'paragraph', children: [{ type: 'code', value: '{^a^}' }, text] }
  const check = createCheck(createWriter(null, false))
  check.w.parsed = parse(source)
  const starts = writtenTextStarts(check, [paragraph], source)
  expect(starts.get(text)?.[0]).toBe(7)
})

it('locates text with mandatory pipe escapes in a table cell', () => {
  const text: TextNode = { type: 'text', value: 'a|{^b^}' }
  const cell: TableCellNode = { type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [text] }] }
  const check = createCheck(createWriter(null, false))
  check.w.escapes.set(text, [2])
  const source = '| a\\|\\{^b^} |\n'
  expect(writtenTextStarts(check, [cell], source).get(text)?.[0]).toBe(2)
})
