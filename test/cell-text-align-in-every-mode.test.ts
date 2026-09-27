import { expect, it } from 'vitest'
import { htmlToCarve, htmlToAst, renderCarve } from '../src/index.js'

const cases = [
  [
    "cell-text-align-columns",
    "<table><thead><tr><th style=\"text-align:left\">V</th><th style=\"text-align:right\">D</th></tr></thead><tbody><tr><td style=\"text-align:left\">a</td><td style=\"text-align:right\">b</td></tr></tbody></table>",
    "|=< V |=> D |\n| a | b |\n",
    0
  ],
  [
    "cell-text-align-overrides",
    "<table><tr><th style=\"text-align:right\">V</th></tr><tr><td style=\"text-align:center\">a</td></tr><tr><td style=\"text-align:left\">b</td></tr></table>",
    "|=> V |\n|~ a |\n|< b |\n",
    0
  ],
  [
    "cell-text-align-declarations",
    "<table><tr><td style=\"text-align:justify;text-align:right\">a</td><td style=\"text-align:right;text-align:left\">b</td><td style=\"text-align:right !important\">c</td><td style=\"text-align:center;text-align:justify\">d</td></tr></table>",
    "|> a |< b | c |~ d |\n",
    3
  ],
  [
    "cell-text-align-unmapped",
    "<table><tr><td style=\"TEXT-ALIGN: CENTER; color:red\">a</td><td style=\"text-align:justify\">b</td></tr></table>",
    "|~ a | b |\n",
    2
  ]
] as const

for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
  for (const [name, html, source, count] of cases) {
    it(`${name} in ${mode}`, () => {
      const result = htmlToCarve(html, { mode })
      expect(result.value).toBe(source)
      expect(result.report.diagnostics.map(d => d.code)).toEqual(Array(count).fill('style-unmapped'))
      const ast = htmlToAst(html, { mode })
      expect(renderCarve(ast.value)).toBe(source)
      expect(ast.report.diagnostics.map(d => d.code)).toEqual(Array(count).fill('style-unmapped'))
    })
  }
}
