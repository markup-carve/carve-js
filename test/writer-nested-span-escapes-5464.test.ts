import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function checkWrites(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(writeTreeWithStats(parse(source), undefined, 'plan').output.source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

// carve-js#5464: a C2-W-125 trial on the first character of a content that a probe of an outer content asked for is
// tested in the group like a lone trial; a trailing caret joins only a bracket, so the brace of case one is tried;
// a brace that ends its text has the kind of the brace and the mark of the closer behind it (C2-W-088).
describe('C2-W-088: nested spans take only the escapes of the procedure (carve-js#5464)', () => {
  it.each([
    ['{,{,,\\{,,,},}', '{,{,,\\{,,,},}\n'],
    ['{,{,,{\\,,},,}}', '{,{,,\\{,,},,}}\n'],
    ['> {/{,,\\{,},,},}', '> {/{,,\\{,},,},}\n'],
    ['- {,{,,\\{,x,,},}', '- {,{,,\\{,x,,},}\n'],
    ['- {,{,,{\\,,},,}}', '- {,{,,\\{,,},,}}\n'],
    ['a {,{,,{\\,,},,,}', 'a {,{,,\\{,,},,,}\n'],
    ['> {,{,,{\\,,,,},}', '> {,{,,\\{,,,,},}\n'],
    ['- {,{,,{\\,,}^,},', '- {,{,,\\{,,}^,},\n'],
    ['> {,{,,{\\,,},,,}', '> {,{,,\\{,,},,,}\n'],
    ['- {^{^^{\\^^}^^^}', '- {^{^^\\{^^}^^^}\n'],
    ['> {^{^^{\\^^}^^}}', '> {^{^^\\{^^}^^}}\n'],
    ['> - {,{,,\\{,,,},}', '> - {,{,,\\{,,,},}\n'],
    ['a {{,,\\{,},,},}_}', 'a {{,,\\{,},,},}_}\n'],
    ['> {,{,,\\{,]},,},}', '> {,{,,\\{,]},,},}\n'],
    ['> {,{,,\\{,},,},{*', '> {,{,,\\{,},,},{*\n'],
    ['> {,{,,\\{,[},,},}', '> {,{,,\\{,[},,},}\n'],
    ['> {,{,,{\\,,},},*}', '> {,{,,\\{,,},},*}\n'],
    ['> {^{^^{\\^/}^^}^}', '> {^{^^\\{^/}^^}^}\n'],
    ['{^{^^{\\^^}^*}^}*}', '{^{^^\\{^^}^*}^}*}\n'],
    ['> {,{,,\\{,}*,},{_}', '> {,{,,\\{,}*,},{_}\n'],
    ['a {,{,,\\{,*},,},}/', 'a {,{,,\\{,*},,},}/\n'],
    ['> {,{,,\\{,},,},}{^', '> {,{,,\\{,},,},}{^\n'],
    ['a {,{,,\\{,},,},{_}', 'a {,{,,\\{,},,},{_}\n'],
    ['- {,{,,{\\,,/},,},}', '- {,{,,\\{,,/},,},}\n'],
    ['a {^{^{\\^^}^^}^^[}', 'a {^{^\\{^^}^^}^^[}\n'],
    ['a {^{^^{\\^^}^^}^,}', 'a {^{^^\\{^^}^^}^,}\n'],
    ['> - {^{^^{\\^^^^}^}', '> - {^{^^\\{^^^^}^}\n'],
    ['- {,},{,,\\{,},,},{_', '- {,},{,,\\{,},,},{_\n'],
    ['> - {,{,,\\{,,,}\\,,}', '> - {,{,,\\{,,,},,}\n'],
    ['> {,{,,\\{,}x,,},}{*', '> {,{,,\\{,}x,,},}{*\n'],
    ['> - {,{,,{\\,,},,},*', '> - {,{,,\\{,,},,},*\n'],
    ['> {,{,,{\\,,}\\{,,},}', '> {,{,,\\{,,}\\{,,},}\n'],
    ['> - {,{,,{\\,,,},,,}', '> - {,{,,\\{,,,},,,}\n'],
    ['> {/{{^{,,\\{,}{_,},}', '> {/{{^{,,\\{,}{_,},}\n'],
    ['> - {,{,,\\{,},,}{_x^}', '> - {,{,,\\{,},,}{_x^}\n'],
    ['> - {^{^^ {\\^^}^^}^/}{*', '> - {^{^^ \\{^^}^^}^/}{*\n'],
  ])('writes %j as %j', checkWrites)
})
