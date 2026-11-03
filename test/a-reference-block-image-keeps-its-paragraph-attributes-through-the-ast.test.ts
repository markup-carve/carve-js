import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

// The published tree moves a block image's paragraph attributes onto the image (CARVE-P12-043), while a
// reference image is written from its `rawRef`; the writer must not drop the attributes `rawRef` lacks.
const throughAst = (source: string): string => renderCarve(fromAstJson(carveToAstJson(source)))

describe('a reference block image keeps its paragraph attributes through the AST', () => {
  it.each([
    '{.c}\n![a][r]\n\n[r]: y.png\n',
    '{.c}\n![a][r]{%%}\n\n[r]: y.png\n',
    '{#i k=v}\n![a][]\n\n[a]: y.png\n',
    '{.c}\n![a][r]{.d}\n\n[r]: y.png\n',
    '- {.c}\n  ![a][r]\n\n[r]: y.png\n',
  ])('renders %j the same after the round trip', (source) => {
    expect(carveToHtml(throughAst(source))).toBe(carveToHtml(source))
  })

  it('keeps a reference that carries only its own attributes as written', () => {
    const source = 'x ![a][r]{ .d  k="}" } y\n\n[r]: y.png\n'
    expect(throughAst(source)).toBe(source)
  })
})
