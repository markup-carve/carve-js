import { describe, expect, it } from 'vitest'
import { keepImageParagraphs } from '../src/compare.ts'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const entries = (input: string): string[] => upgrade(input).records.map((record) => record.entry)

// The readiness replay source pack/guards-01.json/guards-1785583e345b.
const GUARDS = '- ![a](safe.png){srcset="https:://example.com/a,data:x 1x"}\n'
  + '  ![a](safe.png){srcset="https:://example.com/a,data:x 1x"}\n'

describe('carve#6832: a first paragraph that 0.2 keeps as <p> under C2-H-018 (U-444)', () => {
  it.each([
    ['the replay source with a soft break between images', GUARDS, GUARDS],
    ['two images in a tight item', '- ![a](a.png) ![b](b.png)\n- c\n', '- ![a](a.png) ![b](b.png)\n- c\n'],
    ['two images on two lines', '- ![a](a.png)\n  ![b](b.png)\n- c\n', '- ![a](a.png)\n  ![b](b.png)\n- c\n'],
    ['an image and a comment', '- ![a](a.png) %% c\n- d\n', '- ![a](a.png) %% c\n- d\n'],
    ['images in a one-block description', ':: t\n: ![a](a.png) ![b](b.png)\n', ':: t\n: ![a](a.png) ![b](b.png)\n'],
    ['text before a block image in a one-item list', '- a\n+\n![x](i.png)\n', '- a\n\n  ![x](i.png)\n'],
    ['text before a block image in a tight list', '- a\n+\n![x](i.png)\n- b\n', '- a\n\n  ![x](i.png)\n- b\n'],
  ])('explains %s', (_name, input, output) => {
    const result = upgrade(input)
    expect(result.output).toBe(output)
    expect(result.check).toBe('explained')
    expect(canWriteUpgrade(result)).toBe(true)
    const record = result.records.find((item) => item.entry === 'U-444')
    expect(record?.class).toBe('report')
    expect(input.slice(record!.range!.startOffset, record!.range!.endOffset)).not.toBe('')
    expect(result.records.some((item) => item.entry === 'upgrade-mismatch')).toBe(false)
    expect(result.records.some((item) => item.entry === 'U-021')).toBe(false)
  })

  it('explains the paragraph after a difference another row explains first', () => {
    const input = '- [ ] c\n- ![a](a.png) ![b](b.png)\n'
    const result = upgrade(input)
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toEqual(expect.arrayContaining(['U-117', 'U-133', 'U-444']))
    const record = result.records.find((item) => item.entry === 'U-444')!
    expect(input.slice(record.range!.startOffset, record.range!.endOffset)).toBe('- ![a](a.png) ![b](b.png)')
  })

  it('places the report on the line of the paragraph', () => {
    const input = '- a\n- ![a](a.png) ![b](b.png)\n'
    const record = upgrade(input).records.find((item) => item.entry === 'U-444')!
    expect(record.line).toBe(2)
    expect(input.slice(record.range!.startOffset, record.range!.endOffset)).toBe('- ![a](a.png) ![b](b.png)')
  })

  it.each([
    ['a tight item with text', '- text\n- d\n'],
    ['a tight item with text and an image', '- x ![a](a.png)\n- y\n'],
    ['a description with text', ':: t\n: text\n'],
    ['a lone block image', '- ![a](a.png)\n'],
  ])('leaves %s alone', (_name, input) => {
    const result = upgrade(input)
    expect(result.check).toBe('pass')
    expect(entries(input)).not.toContain('U-444')
  })

  it('adds no <p> that C2-H-018 does not keep', () => {
    const old = '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>'
    expect(keepImageParagraphs(old, '<ul>\n  <li><p>a</p></li>\n  <li>b</li>\n</ul>')).toEqual({ html: old, applied: [], lines: [] })
    const quote = '<blockquote><img src="a.png" alt="a"></blockquote>'
    expect(keepImageParagraphs(quote, '<blockquote><p><img src="a.png" alt="a"></p></blockquote>').applied).toEqual([])
    // 0.1 closed the list before the image, so the image is no block of the same item there.
    const outside = '<ul><li>a</li></ul><img src="a.png" alt="a">'
    expect(keepImageParagraphs(outside, '<ul><li><p>a</p><img src="a.png" alt="a"></li></ul>').applied).toEqual([])
    const later = '<ul><li>a<img src="a.png" alt="a"></li></ul>'
    expect(keepImageParagraphs(later, '<ul><li>a<p><img src="a.png" alt="a"></p></li></ul>').applied).toEqual([])
  })
})
