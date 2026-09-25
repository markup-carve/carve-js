import { describe, expect, it } from 'vitest'
import { carveToHtml, citations, lintCarve } from '../src/index.js'

const source = 'See [@x].\n\n> ::: references\n> :::\n\n[@x]: Source\n'
const findings = (input: string) => lintCarve(input, { extensions: [citations()] })
  .filter((warning) => warning.rule === 'references-placement-in-container')

describe('contained references placement', () => {
  it('reports the refused marker while keeping the list at document end', () => {
    const found = findings(source)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ line: 3, column: 3 })
    const html = carveToHtml(source, { extensions: [citations()] })
    const div = html.indexOf('<div class="references">')
    const list = html.indexOf('<ol class="references">')
    expect(div).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(div)
  })

  it('keeps an ordinary div silent when citations are off', () => {
    expect(lintCarve(source).some((warning) => warning.rule === 'references-placement-in-container')).toBe(false)
  })

  it('keeps a top-level marker silent', () => {
    expect(findings('See [@x].\n\n::: references\n:::\n\n[@x]: Source\n')).toEqual([])
  })

  it('reports the nested marker even when another marker places the list', () => {
    const mixed = 'See [@x].\n\n> ::: references\n> :::\n\n::: references\n:::\n\n[@x]: Source\n'
    expect(findings(mixed)).toHaveLength(1)
  })
})
