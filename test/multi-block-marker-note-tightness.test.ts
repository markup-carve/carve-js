import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const note = '[^a]: text\n  p\n    # z'

describe('a marker-line note with more than one body block', () => {
  it.each(['-', '*'])('keeps a %s item tight after its invisible body', marker => {
    const source = `${marker} ${note}\n\n  more\n\nsee[^a]\n`
    const list = parse(source).children[0]
    expect(list?.type).toBe('list')
    if (list?.type === 'list') expect(list.tight).toBe(true)
    expect(carveToHtml(source)).toContain('<li>more</li>')
  })
})
