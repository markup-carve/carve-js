import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const write = (source: string): string => renderCarve(parse(source))

describe('CARVE-P11-002: a sub-list on a task item\'s marker line', () => {
  it('writes an unclosed colon container\'s closer at the sub-item\'s content column', () => {
    expect(write('* [ ] - :::\n')).toBe('* [ ] - :::\n\n        :::\n')
  })

  it.each([
    '* [ ] - :::\n',
    '* [x] - :::\n  a\n',
    '- [ ] 1. :::\n',
    '- [ ] - - :::\n',
    '> * [ ] - :::\n',
    '* [ ] - ```\n  x\n',
    '* [ ] - > a\n\n        > b\n',
    '* [ ] - a\n\n        b\n',
    '* [ ] - a\n        - b\n',
    '- - [ ] - :::\n',
  ])('round-trips %j', (source) => {
    const written = write(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(write(written)).toBe(written)
  })

  it('leaves a block of the task item itself at the item\'s column', () => {
    expect(write('* [ ] - a\n\n  b\n')).toBe('* [ ] - a\n\n  b\n')
  })

  it('leaves a marker-line sub-list without a task box alone', () => {
    expect(write('- - :::\n')).toBe('- - :::\n\n    :::\n')
    expect(write('1. - :::\n')).toBe('1. - :::\n\n     :::\n')
  })
})
