import { describe, expect, it } from 'vitest'
import { carveToMarkdownWithReport } from '../src/index.js'

const loss = {
  code: 'fence-title-dropped',
  target: 'markdown',
  nodeType: 'block',
  message: 'Dropped a code fence title without a language in Markdown',
}

describe('a code fence title without a language', () => {
  it('reports the dropped opener title while keeping the label', () => {
    const result = carveToMarkdownWithReport('``` "T" [Build]\nx\n```\n')
    expect(result.value.split('\n')[0]).toBe('``` [Build]')
    expect(result.losses).toEqual([expect.objectContaining(loss)])
    expect(result.losses[0]?.pos?.startLine).toBe(1)
  })

  it('reports an overriding attribute title once', () => {
    const result = carveToMarkdownWithReport('{title="A"}\n``` "T"\nx\n```\n')
    expect(result.value.split('\n')[0]).toBe('```')
    expect(result.losses.filter((row) => row.code === 'fence-title-dropped')).toHaveLength(1)
  })

  it('reports nothing when a language or roundtrip carrier keeps the title', () => {
    expect(carveToMarkdownWithReport('```js "T"\nx\n```\n').losses).toEqual([])
    expect(carveToMarkdownWithReport('``` "T"\nx\n```\n', { roundtrip: true }).losses).toEqual([])
  })
})
