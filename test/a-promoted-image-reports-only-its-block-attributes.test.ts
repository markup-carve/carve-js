import { expect, it } from 'vitest'
import { carveToMarkdownWithReport, parse, renderMarkdown, type BlockNode, type RenderLoss } from '../src/index.js'

// carve#3975: a promoted image reports markdown-attributes-dropped only for a
// block attribute run merged into it; glued attributes follow the inline rule.
it.each([
  ['{.outer k=one}\n![a](b){.inner k=two}\n', 1],
  ['{.outer}\n![alt](img.png)\n', 1],
  ['- {#i}\n  ![a](b.png){.x}\n', 1],
  ['> {k=v}\n> ![a](b.png)\n', 1],
  ['{.o}\n![a][r]\n\n[r]: b.png\n', 1],
  ['![alt](img.png){.x}\n', 0],
  ['![a](safe.png){srcset="javascript:alert(1) 1x, safe.png 2x"}\n', 0],
  ['![a](u){k="{y}"}\n', 0],
  ['![a](/u){src=/v}\n', 0],
  ['![a][r]{.x}\n\n[r]: b.png\n', 0],
  [':::\n![a](b.png){#g}\n:::\n', 0],
  ['{}\n![a](b.png){.x}\n', 0],
  ['a ![alt](i.png){.x} b\n', 0],
])('promoted image %j reports %i dropped attribute loss', (source, count) => {
  const result = carveToMarkdownWithReport(source as string)
  const dropped = result.losses.filter(loss => loss.code === 'markdown-attributes-dropped')
  expect(dropped).toHaveLength(count as number)
})

it('reports every attribute on a block image the parser did not build', () => {
  const doc = parse('x\n')
  doc.children = [{ type: 'image', src: 'b.png', alt: 'a', attrs: { classes: ['x'] } } as unknown as BlockNode]
  const losses: RenderLoss[] = []
  renderMarkdown(doc, { onRenderLoss: loss => losses.push(loss) })
  expect(losses.map(loss => loss.code)).toEqual(['markdown-attributes-dropped'])
})

it('reports attributes a caller adds to a parsed block image', () => {
  const doc = parse('![a](b.png)\n')
  const image = doc.children[0]!
  image.attrs = { classes: ['added'] }
  const losses: RenderLoss[] = []
  renderMarkdown(doc, { onRenderLoss: loss => losses.push(loss) })
  expect(losses.map(loss => loss.code)).toEqual(['markdown-attributes-dropped'])
})
