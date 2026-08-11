import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve } from '../src/index.js'

const topLists = (source: string) => parse(source).children.filter((block) => block.type === 'list')

describe('two blank lines form a hard list boundary in 0.2', () => {
  it('keeps one blank line as the loose-list separator', () => {
    const lists = topLists('1. a\n\n1. b\n')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.items).toHaveLength(2)
    expect(lists[0]?.tight).toBe(false)
  })

  it('ends an ordered list across two blank lines', () => {
    const source = '1. a\n\n\n1. b\n'
    expect(topLists(source)).toHaveLength(2)
    expect(carveToHtml(source).match(/<ol>/g)).toHaveLength(2)
    expect(carveToCarve(source)).toBe(source)
  })

  it('ends a bullet list across two blank lines', () => {
    const source = '- a\n\n\n- b\n'
    expect(topLists(source)).toHaveLength(2)
    expect(carveToHtml(source).match(/<ul>/g)).toHaveLength(2)
    expect(carveToCarve(source)).toBe(source)
  })

  it('writes two compatible sibling lists with the hard boundary', () => {
    const parsed = parse('1. a\n\n\n1. b\n')
    const canonical = renderCarve(parsed)
    expect(canonical).toBe('1. a\n\n\n1. b\n')
    expect(carveToCarve(canonical)).toBe(canonical)
  })
})
