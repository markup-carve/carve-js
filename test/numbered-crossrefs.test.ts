import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'

// Reach into the parsed caption to assert a caption-number node exists.
function captionTypes(src: string): string[] {
  const doc = parse(src)
  const fig = doc.children.find((b) => b.type === 'figure') as
    | { caption: { type: string }[] }
    | undefined
  return fig ? fig.caption.map((n) => n.type) : []
}

describe('parse: caption number placeholder', () => {
  it('emits a caption-number node for a bare # in a caption', () => {
    expect(captionTypes('![x](x.jpg)\n^ Figure #: A')).toContain('caption-number')
  })

  it('does not emit one for an escaped \\#', () => {
    expect(captionTypes('![x](x.jpg)\n^ Cost \\# units')).not.toContain('caption-number')
  })

  it('keeps #word as a tag, not a placeholder', () => {
    const types = captionTypes('![x](x.jpg)\n^ See #news')
    expect(types).toContain('tag')
    expect(types).not.toContain('caption-number')
  })

  it('only the first bare # becomes a placeholder', () => {
    const types = captionTypes('![x](x.jpg)\n^ Figure #: a # b')
    expect(types.filter((t) => t === 'caption-number')).toHaveLength(1)
  })
})
