import { describe, expect, it } from 'vitest'
import { parse, render, renderWithDocumentTransforms } from '../src/index.ts'

describe('C2-X-053 to C2-X-055: document transforms', () => {
  it('runs transforms in order on a copy of the resolved view', () => {
    const authored = parse('hello')
    const result = renderWithDocumentTransforms(authored, [
      { name: 'first', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text') {
          paragraph.children[0].value += '?'
        }
        return view
      } },
      { name: 'second', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text') {
          paragraph.children[0].value += '!'
        }
        return view
      } },
    ])
    expect(result.html).toBe('<p>hello?!</p>')
    expect(render(authored)).toBe('<p>hello</p>')
    expect(result.diagnostics).toEqual([])
  })

  it('keeps the prior view when a transform creates duplicate authored ids', () => {
    const result = renderWithDocumentTransforms('[a]{#first} [b]{#second}', [
      { name: 'first', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'span' &&
          paragraph.children[0].children[0]?.type === 'text') paragraph.children[0].children[0].value = 'X'
        return view
      } },
      { name: 'duplicate', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[2]?.type === 'span' &&
          paragraph.children[2].attrs !== undefined) paragraph.children[2].attrs.id = 'first'
        return view
      } },
    ])
    expect(result.html).toBe('<p><span id="first">X</span> <span id="second">b</span></p>')
    expect(result.diagnostics.some((entry) => entry.code === 'extension-transform-failed' &&
      entry.message.includes('duplicate'))).toBe(true)
  })
})
