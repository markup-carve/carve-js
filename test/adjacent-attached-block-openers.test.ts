import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('adjacent block openers in an attached run', () => {
  it.each([
    ['block quotes', '- x\n+\n> q\n+\n> q\n'],
    ['tables', '- x\n+\n| a |\n|---|\n| b |\n+\n| a |\n|---|\n| b |\n'],
    ['line blocks', '- x\n+\n::: |\na\n:::\n+\n::: |\nb\n:::\n'],
  ])('keeps two %s separate', (_name, src) => {
    expect(roundTrips(src)).toBe(true)
    expect(carveToCarve(carveToCarve(src))).toBe(carveToCarve(src))
  })

  it('does not add a marker to an isolated block opener', () => {
    expect(carveToCarve('- x\n+\n> q\n')).toBe("- x\n+\n> q\n")
  })
})
