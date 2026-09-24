import { describe, expect, it } from 'vitest'
import {
  AstJsonSchemaError,
  AstJsonUnknownFieldError,
  fromAstJson,
  renderAnsi,
  renderCarve,
  renderHtml,
  renderMarkdown,
  renderPlainText,
} from '../src/index.js'
import type { Document, Figure, FigureGroup } from '../src/index.js'

const paragraph = (value: string): Figure['target'] => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

const figure = (target: Figure['target'], caption: string): Figure => ({
  type: 'figure',
  target,
  caption: [{ type: 'text', value: caption }],
})

const document = (children: Document['children']): Document => ({ type: 'document', children })

const renderers = {
  html: renderHtml,
  carve: renderCarve,
  markdown: renderMarkdown,
  plain: renderPlainText,
  ansi: renderAnsi,
}

describe('constructed figure invariants', () => {
  it.each([
    ['paragraph', paragraph('TGT-PARAGRAPH')],
    ['image', { type: 'image', src: 'x.png', alt: 'TGT-IMAGE' }],
    ['code', { type: 'code_block', content: 'TGT-CODE' }],
    [
      'block quote',
      {
        type: 'block_quote',
        children: [paragraph('TGT-QUOTE')],
      },
    ],
    [
      'table',
      {
        type: 'table',
        rows: [
          {
            type: 'table_row',
            cells: [
              {
                type: 'table_cell',
                header: false,
                children: [{ type: 'text', value: 'TGT-TABLE' }],
              },
            ],
          },
        ],
      },
    ],
  ] as const)('renders a constructed %s target before its caption', (_name, target) => {
    const doc = document([figure(target, 'CAP-STANDALONE')])

    for (const [name, render] of Object.entries(renderers)) {
      const output = render(doc)
      expect(output.indexOf('TGT-'), name).toBeGreaterThanOrEqual(0)
      expect(output.indexOf('CAP-STANDALONE'), name).toBeGreaterThan(output.indexOf('TGT-'))
    }
  })

  it('keeps constructed figure-group panels in order without losing their parts', () => {
    const group: FigureGroup = {
      type: 'figure_group',
      children: [
        figure(paragraph('target one'), 'caption one'),
        paragraph('stray content'),
        {
          type: 'table',
          caption: [{ type: 'text', value: 'table caption' }],
          rows: [],
        },
        figure(paragraph('target two'), 'caption two'),
      ],
      caption: [{ type: 'text', value: 'group caption' }],
    }
    const doc = document([group])

    for (const [name, render] of Object.entries(renderers)) {
      const output = render(doc)
      const order =
        name === 'plain' || name === 'ansi'
          ? [
              'group caption',
              'caption one',
              'target one',
              'stray content',
              'table caption',
              'caption two',
              'target two',
            ]
          : [
              'target one',
              'caption one',
              'stray content',
              'table caption',
              'target two',
              'caption two',
              'group caption',
            ]
      const positions = order.map((part) => output.indexOf(part))
      expect(positions[0], name).toBeGreaterThanOrEqual(0)
      expect(positions, name).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  it('keeps an absent group caption absent', () => {
    const group: FigureGroup = {
      type: 'figure_group',
      children: [paragraph('only content')],
    }
    const doc = document([group])

    for (const [name, render] of Object.entries(renderers)) {
      const output = render(doc)
      expect(output, name).toContain('only content')
      expect(output.startsWith('\n'), name).toBe(false)
    }
    expect(renderHtml(doc)).not.toContain('<figcaption>')
    expect(renderCarve(doc)).not.toContain('^ ')
    expect(renderMarkdown(doc)).not.toContain('**')
  })

  it.each(['targets', 'captions'])('refuses the plural %s field on the wire', (field) => {
    const payload = {
      type: 'document',
      srcByteLength: 0,
      children: [
        {
          ...figure(paragraph('target'), 'caption'),
          [field]: [],
        },
      ],
    }

    expect(() => fromAstJson(payload as never)).toThrow(AstJsonUnknownFieldError)
    expect(() => fromAstJson(payload as never)).toThrow(`carries "${field}"`)
  })

  it('refuses an array in the singular target field', () => {
    const payload = {
      type: 'document',
      srcByteLength: 0,
      children: [{ ...figure(paragraph('target'), 'caption'), target: [paragraph('target')] }],
    }

    expect(() => fromAstJson(payload as never)).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(payload as never)).toThrow(
      'children[0].target: an array sits where a node belongs',
    )
  })
})
