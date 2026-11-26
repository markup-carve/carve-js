import { describe, expect, it } from 'vitest'
import { importDocument } from '../import/src/index.ts'
import { type DocumentNode, type ImageNode, render, validateTree, writeWithDiagnostics } from '../src/index.ts'
import { plainText } from '../src/ast-text.ts'
import { documentOf, paragraph } from './support/tree.ts'

const UNKNOWN: ImageNode = { type: 'image', src: 'x' }
const DECORATIVE: ImageNode = { type: 'image', src: 'x', decorative: true }
const TEXT: ImageNode = { type: 'image', src: 'x', alt: 't' }

function inParagraph(image: ImageNode): DocumentNode {
  return documentOf(paragraph('a ', image, ' b'))
}

describe('carve#6804: an image whose alt text is unknown', () => {
  it('C2-A-115: a reader accepts the three states and refuses decorative false without alt', () => {
    for (const image of [UNKNOWN, DECORATIVE, TEXT]) expect(() => validateTree(inParagraph(image))).not.toThrow()
    expect(() => validateTree(inParagraph({ type: 'image', src: 'x', decorative: false }))).toThrow()
  })

  it('C2-H-080: unknown writes no alt, decorative an empty one', () => {
    expect(render(inParagraph(UNKNOWN))).toBe('<p>a <img src="x"> b</p>')
    expect(render(inParagraph(DECORATIVE))).toBe('<p>a <img src="x" alt=""> b</p>')
    expect(render(inParagraph(TEXT))).toBe('<p>a <img src="x" alt="t"> b</p>')
  })

  it('C2-H-143, C2-H-165: an unknown alt gives no text, plain and degraded', () => {
    expect(plainText([UNKNOWN])).toBe('')
    expect(render(inParagraph(UNKNOWN), { profile: 'minimal' })).toContain('[img: ]')
  })

  it('C2-W-011: both write empty brackets; only the unknown alt is reported, at the image', () => {
    const unknown = writeWithDiagnostics(inParagraph(UNKNOWN))
    expect(unknown.source).toBe('a ![](x) b\n')
    expect(unknown.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['image-alt-unknown', '/children/0/children/1']])
    expect(writeWithDiagnostics(inParagraph(DECORATIVE))).toEqual({ source: 'a ![](x) b\n', diagnostics: [] })
  })

  it('C2-W-011: an unknown alt in a nested slot is reported at its own path', () => {
    const tree = documentOf({ type: 'block_quote', children: [
      { ...paragraph(UNKNOWN), role: 'image' }, paragraph('a ', DECORATIVE, ' ', { ...UNKNOWN }),
    ] })
    const result = writeWithDiagnostics(tree as DocumentNode)
    expect(result.source).toBe('> ![](x)\n>\n> a ![](x) ![](x)\n')
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(['/children/0/children/0/children/0', '/children/0/children/1/children/3'])
  })

  it('C2-W-011: an image object used twice is reported at each of its paths', () => {
    const shared: ImageNode = { type: 'image', src: 'x' }
    const result = writeWithDiagnostics(documentOf(paragraph(shared, ' ', shared), paragraph(shared)))
    expect(result.source).toBe('![](x) ![](x)\n\n![](x)\n')
    expect(result.diagnostics.filter((entry) => entry.code === 'image-alt-unknown').map((entry) => entry.path))
      .toEqual(['/children/0/children/0', '/children/0/children/2', '/children/1/children/0'])
  })

  it('C2-M-050, C2-H-080: render then import gives back each state', () => {
    for (const image of [UNKNOWN, DECORATIVE, TEXT]) {
      const back = importDocument(render(inParagraph(image)), { from: 'html' }).document
      expect((back.children[0] as { children: unknown[] }).children[1]).toEqual(image)
    }
  })
})
