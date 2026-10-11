import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('a literal caption marker after an empty quote needs no escape', () => {
  it.each([
    ['>\n^ cap\n', '>\n\n^ cap\n'],
    ['>\n\n^ cap\n', '>\n\n^ cap\n'],
    ['| a |\n\n>\n\n^ cap\n', '| a |\n\n>\n\n^ cap\n'],
    ['>\n>\n\n^ cap\n', '>\n\n^ cap\n'],
  ])('formats %j without inventing a caret escape', (input, expected) => {
    const formatted = carveToCarve(input)
    expect(formatted).toBe(expected)
    expect(carveToCarve(formatted)).toBe(formatted)
    expect(carveToHtml(formatted)).toBe(carveToHtml(input))
  })

  it('keeps an authored caption after a nonempty quote', () => {
    const input = '> q\n>\n\n^ cap\n'
    const formatted = carveToCarve(input)
    expect(formatted).toBe('> q\n^ cap\n')
    expect(carveToHtml(formatted)).toBe(carveToHtml(input))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it.each([
    '> q\n\n\\^ cap\n',
    '```\n```\n\n\\^ cap\n',
    '::: >\n:::\n\n\\^ cap\n',
  ])('keeps the required escape after a caption host in %j', (input) => {
    const formatted = carveToCarve(input)
    expect(formatted).toContain('\\^ cap')
    expect(carveToHtml(formatted)).toBe(carveToHtml(input))
    expect(carveToCarve(formatted)).toBe(formatted)
  })
})
