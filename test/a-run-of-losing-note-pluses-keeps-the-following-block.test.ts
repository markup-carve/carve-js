import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ignores a run of losing plus definitions before the winning note body', () => {
  const winner = '[^m]: +'
  const expected = carveToHtml(`${winner}\n\n  - item\n\nsee[^m]\n`)
  for (let count = 1; count <= 8; count++) {
    const source = `${Array(count + 1).fill(winner).join('\n')}\n\n  - item\n\nsee[^m]\n`
    expect(carveToHtml(source)).toBe(expected)
  }
})

it('keeps a quoted note follower in its owner after repeated losing definitions', () => {
  const winner = '> [^m]: +'
  const follower = '>\n>   - item\n\nsee[^m]\n'
  const expected = carveToHtml(`${winner}\n${follower}`)
  for (let count = 1; count <= 8; count++) {
    const source = `${Array(count + 1).fill(winner).join('\n')}\n${follower}`
    expect(carveToHtml(source)).toBe(expected)
  }
})
