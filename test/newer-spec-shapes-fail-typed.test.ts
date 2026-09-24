import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, fromAstJson } from '../src/index.js'

const doc = (child: Record<string, unknown>) => ({
  type: 'document',
  srcByteLength: 0,
  children: [child],
})

describe('newly pinned interchange shapes without renderer support', () => {
  it('refuses section nodes at ingest', () => {
    expect(() => fromAstJson(doc({ type: 'section', level: 1, children: [] }) as never))
      .toThrow(AstJsonSchemaError)
  })

  it('refuses block-content table cells at ingest', () => {
    const table = {
      type: 'table',
      rows: [{ type: 'table_row', cells: [{ type: 'table_cell', header: false, blocks: [] }] }],
    }
    expect(() => fromAstJson(doc(table) as never)).toThrow(/"blocks" is not implemented/)
  })

  it('refuses labeled or numbered math at ingest', () => {
    const paragraph = {
      type: 'paragraph',
      children: [{ type: 'math', display: true, content: 'x', label: 'eq:x', number: 1 }],
    }
    expect(() => fromAstJson(doc(paragraph) as never)).toThrow(/math label and number fields/)
  })

  it('refuses per-item citation mode at ingest', () => {
    const paragraph = {
      type: 'paragraph',
      children: [{
        type: 'citation_group',
        raw: '[@x]',
        items: [{ type: 'citation', key: 'x', suppressAuthor: false, mode: 'integral' }],
      }],
    }
    expect(() => fromAstJson(doc(paragraph) as never)).toThrow(/per-item citation mode/)
  })
})
