import { describe, expect, it } from 'vitest'
import { renderCarve, SourceUnspellableError, type Document } from '../src/index.js'

describe('an empty raw inline has no source spelling', () => {
  it('refuses with a typed error instead of emitting a different tree', () => {
    const doc: Document = {
      type: 'document',
      children: [{
        type: 'paragraph',
        children: [{ type: 'raw_inline', format: 'html', content: '' }],
      }],
    }

    expect(() => renderCarve(doc)).toThrow(SourceUnspellableError)
    try {
      renderCarve(doc)
    } catch (error) {
      expect(error).toMatchObject({
        name: 'SourceUnspellableError',
        nodeType: 'raw_inline',
        reason: 'an empty raw inline has no Carve source spelling',
      })
    }
  })
})
