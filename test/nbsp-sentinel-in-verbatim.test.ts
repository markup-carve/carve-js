import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const NBSP = ''

/** The property: formatting must not change what the document says (PART 11 §1). */
const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('literal private-use Unicode', () => {
  it('survives a fenced code block, alone on its line', () => {
    const src = `\`\`\`\na\n${NBSP}\nb\n\`\`\`\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives inline within a fenced line', () => {
    // Not in the report - the sentinel mid-line inside the fence.
    const src = `\`\`\`\na${NBSP}z\n\`\`\`\n`
    expect(carveToCarve(src)).toContain(NBSP)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives a raw block and a block comment', () => {
    for (const src of [
      `\`\`\`=html\n<b>a${NBSP}z</b>\n\`\`\`\n`,
      `%%%\na${NBSP}z\n%%%\n`,
    ]) {
      expect(carveToCarve(src), src).toContain(NBSP)
      expect(roundTrips(src), src).toBe(true)
    }
  })

  it('survives an inline CODE SPAN', () => {
    // A different path from the block cases: `renderCode` emits its content
    // verbatim, so the document-wide rewrite reached it there too.
    const src = `a \`x${NBSP}y\` b\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives a literal inline and a raw inline', () => {
    // Both go through renderCode, so both were affected.
    for (const src of [`a !\`x${NBSP}y\` b\n`, `a \`x${NBSP}y\`{=html} b\n`]) {
      expect(carveToCarve(src), src).toContain(NBSP)
      expect(roundTrips(src), src).toBe(true)
    }
  })

  it('survives a code span whose whole content is the sentinel', () => {
    // The all-space padding rule in renderCode is the neighbouring logic; this
    // pins that carrying the sentinel does not trip it into padding.
    const src = `a \`${NBSP}\` b\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('preserves the literal character outside verbatim content', () => {
    expect(carveToCarve(`a${NBSP}b\n`)).toBe(`a${NBSP}b\n`)
    expect(carveToHtml(`a${NBSP}b\n`)).toContain(NBSP)
  })

  it('leaves a source-written escaped space in a code block alone', () => {
    // The control that shows why `\\ ` is wrong inside a fence: a backslash
    // written in the SOURCE of a code block stays a backslash, in all three
    // engines. If `\\ ` were the way to spell an nbsp here, these two documents
    // would be indistinguishable.
    const src = '```\na\n\\ \nb\n```\n'
    expect(carveToHtml(src)).toContain('\\')
    expect(roundTrips(src)).toBe(true)
  })
})
