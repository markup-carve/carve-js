import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve-js#4228: a first-block `+` body sits below the content column, so the note's column is read against the marker.
describe('a note after a first-block plus item', () => {
  it('is collected on the first write', () => {
    expect(carveToCarve('- +\nfirst\n+\ntext\n[^f]: n\nb\n')).toBe('- first\n+\ntext\n\n[^f]: n\n  b\n')
  })

  it.each([
    '- +\nfirst\n[^f]: n\nb\n',
    '- +\nfirst\n  [^f]: n\n  b\n',
    '1. +\nfirst\n   [^f]: n\n   b\n',
    '. +\nfirst\n  [^f]: n\n',
    'a.  +\nfirst\n [^f]: n\n b\n',
    '- [ ] +\nfirst\n [^f]: n\n b\n',
    '> - +\n> first\n>  [^f]: n\n>  b\n',
    '> 1. +\n> first\n>   [^f]: n\n>   b\n',
    '-{#x} +\nfirst\n  [^f]: n\n  b\n',
    '1.{#x} +\nfirst\n   [^f]: n\n',
  ])('writes a fixed point for %j', (source) => {
    const once = carveToCarve(source)
    expect(carveToCarve(once)).toBe(once)
    expect(carveToHtml(once)).toBe(carveToHtml(source))
  })
})
