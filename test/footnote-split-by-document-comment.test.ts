import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

describe('footnote split by a document-owned comment', () => {
  it('keeps the comment at document level and omits the reassembled footnote span', () => {
    const doc = parse('[^a]: intro\n%% c\n more\n\nsee[^a]\n', { positions: true })
    expect(doc.children.map((child) => child.type)).toEqual(['comment', 'paragraph'])
    expect(doc.children[0]?.pos).toMatchObject({ startLine: 2, endLine: 2, startOffset: 12, endOffset: 16 })
    expect(doc.footnoteDefPos?.a).toBeUndefined()
    expect(doc.footnoteDefs?.a).toBeDefined()
  })
})
