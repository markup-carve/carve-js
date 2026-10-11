import { describe, expect, it } from 'vitest'
import { collectSentinelNonces, shortSentinelTokens } from '../src/sentinel-run.js'
import { carveToCarveWithReport, carveToHtml, parse, renderCarveWithReport, resolve } from '../src/index.js'

const pool = Array.from({ length: 6400 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
const payload = pool + '\ue009' + '\ue008'.repeat(24) + '\ue010\ue00a'
const sources = [
  `a${payload}b\n`,
  `\`${payload}\`\n`,
  `!\`${payload}\`\n`,
  `\`\`\`\na${payload}  \n\nb\t\n\`\`\`\n`,
  `![${payload}](image)\n`,
  `[${payload}](/target)\n`,
  `| a${payload}\n| b\n`,
  `> a${payload}\n> b\n`,
  `- a${payload}\n  b\n`,
  `a${payload}b\n\n[^\ue009\ue008\ue008\ue010\ue00a]: definition\n`,
]

describe('Source formatting with an occupied marker pool', () => {
  it('preserves an authored footnote map key that could spell a fallback marker', () => {
    const label = '\ue009\ue008\ue008\ue010\ue00a'
    const source = `a${pool}b\n\n[^${label}]: definition\n`
    const result = carveToCarveWithReport(source)
    expect(result.value).toContain(`[^${label}]:`)
    expect(result.value).toContain(pool)
    expect(result.totalLosses).toBe(0)
    expect(carveToHtml(result.value)).toBe(carveToHtml(source))
  })
  for (const [index, source] of sources.entries()) {
    it(`preserves literal Unicode and reports for context ${index}`, () => {
      const expected = carveToHtml(source)
      const direct = carveToCarveWithReport(source)
      const fromAst = renderCarveWithReport(resolve(parse(source)))
      for (const result of [direct, fromAst]) {
        expect(carveToHtml(result.value)).toBe(expected)
        expect(result.value).toContain(payload)
        expect(result.totalLosses).toBe(0)
        expect(result.losses).toEqual([])
        expect(result.truncated).toBe(false)
      }
      expect(carveToCarveWithReport(direct.value).value).toBe(direct.value)
      expect(carveToCarveWithReport('ordinary\n').value).toBe('ordinary\n')
    })
  }
})

it('preserves long runs, large whitespace runs and short-token lookalikes', () => {
  const lookalikes = Array.from({ length: 64 }, (_, nonce) => `\ue009m${nonce}x0\ue00a`).join('')
  const largePayload = pool + lookalikes + '\ue008'.repeat(1024)
  for (const source of [
    `\`\`\`\n${largePayload}${' '.repeat(1024)}\n\nlast\t\n\`\`\`\n`,
    `| ${largePayload}${' '.repeat(1024)}\n| last\n`,
  ]) {
    const result = carveToCarveWithReport(source)
    expect(result.value).toContain(largePayload)
    expect(carveToHtml(result.value)).toBe(carveToHtml(source))
    expect(result.totalLosses).toBe(0)
  }
})

it('bounds marker size independently of long authored runs', () => {
  const authored = pool + '\ue008'.repeat(8192) + Array.from({ length: 64 }, (_, nonce) => `\ue009m${nonce}x0\ue00a`).join('')
  const nonces = new Set<number>()
  collectSentinelNonces(authored, nonces)
  const markers = shortSentinelTokens(nonces, 8)
  expect(new Set(markers).size).toBe(markers.length)
  for (const marker of markers) {
    expect(authored.includes(marker)).toBe(false)
    expect(marker.length).toBeLessThan(32)
  }
})

it('does not confuse authored footnote code characters with provisional guards', () => {
  for (const body of [
    'x\n\n  ```\n  \ue007> y\n  ```\n',
    '`x\n  \ue007> y`\n',
  ]) {
    const source = `a[^n] ${pool}\n\n[^n]: ${body}`
    const ast = resolve(parse(source))
    for (const result of [carveToCarveWithReport(source), renderCarveWithReport(ast)]) {
      expect(carveToHtml(result.value)).toBe(carveToHtml(source))
      expect(result.totalLosses).toBe(0)
      expect(result.losses).toEqual([])
    }
  }
})
