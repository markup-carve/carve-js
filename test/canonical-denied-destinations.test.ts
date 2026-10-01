import { describe, expect, it } from 'vitest'
import {
  carveToCarveWithReport, carveToHtmlWithReport, carveToMarkdownWithReport,
  carveToAnsiWithReport, parse, toAstJson,
} from '../src/index.js'

function meaning(source: string): unknown {
  return JSON.parse(JSON.stringify(toAstJson(parse(source)), (key, value: unknown) => key === 'pos' || key === 'srcByteLength' ? undefined : value))
}

describe('canonical source preserves destinations independently of sink policy', () => {
  for (const scheme of ['javascript', 'JaVaScRiPt', 'vbscript', 'data', 'file', 'ms-msdt', 'vscode']) {
    for (const tail of ['alert(1)', 'a(b(c))d', 'a\\)b', 'a\\(b', 'a\\\\b']) {
      it(`round-trips ${scheme}:${tail} on links and images`, () => {
        const source = `[x](${scheme}:${tail}) ![i](${scheme}:${tail})\n`
        const written = carveToCarveWithReport(source, { strictLosses: true })
        expect(meaning(written.value)).toEqual(meaning(source))
        expect(written.losses).toEqual([])
        expect(written.totalLosses).toBe(0)
        expect(carveToCarveWithReport(written.value).value).toBe(written.value)
        for (const render of [carveToHtmlWithReport, carveToMarkdownWithReport]) {
          const result = render(written.value)
          expect(result.losses.map(loss => loss.code)).toEqual(['destination-denied', 'destination-denied'])
        }
        expect(carveToAnsiWithReport(written.value).losses.map(loss => loss.code)).toEqual(['destination-denied'])
      })
    }
  }
  for (const source of ['[x][r]\n\n[r]: javascript:alert(1)\n', '<javascript:alert(1)>\n']) {
    it(`preserves reference and autolink destinations: ${source.trim()}`, () => {
      const written = carveToCarveWithReport(source, { strictLosses: true })
      expect(meaning(written.value)).toEqual(meaning(source))
      expect(written.totalLosses).toBe(0)
      expect(carveToCarveWithReport(written.value).value).toBe(written.value)
      expect(carveToHtmlWithReport(written.value).losses.map(loss => loss.code)).toEqual(['destination-denied'])
      expect(carveToMarkdownWithReport(written.value).losses.map(loss => loss.code)).toEqual(['destination-denied'])
    })
  }
  it('keeps balanced denied parentheses readable', () => {
    const source = '[x](javascript:alert(1))\n'
    expect(carveToCarveWithReport(source).value).toBe(source)
  })
})
