import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToHtml, fromAstJson, parse, renderHtml, resolve, toAstJson } from '../src/index.js'
import controls from './fixtures/definition-description-code-ownership.json'
import { layoutWork } from '../src/parse.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const htmlTree = (html: string): unknown => {
  const visit = (node: DefaultTreeAdapterMap['node'], literal = false): unknown => {
    if ('value' in node) return !literal && node.value.trim() === '' ? undefined : { text: node.value }
    if ('tagName' in node) {
      literal ||= node.tagName === 'pre' || node.tagName === 'code'
      return {
        tag: node.tagName,
        attributes: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
        children: node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined),
      }
    }
    return 'childNodes' in node ? node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined) : undefined
  }
  return visit(parseFragment(html))
}

// Controls use spec 2d473af7, with below-column comment retention updated for X1.
it.each(controls)('keeps description code and following blocks in their authored hosts: $id', control => {
  expect(htmlTree(carveToHtml(control.source))).toEqual(htmlTree(control.html))
  for (const positions of [false, true]) {
    const ast = resolve(parse(control.source, { positions }))
    expect(htmlTree(renderHtml(ast))).toEqual(htmlTree(control.html))
    expect(htmlTree(renderHtml(fromAstJson(toAstJson(ast))))).toEqual(htmlTree(control.html))
  }
})

// CARVE-P2-028 and PART 0 O1-O3: an unmarked line reaches the document,
// whose column does not recognize this indented marker as an opener.
it('folds unmarked indented terms while keeping marked sibling terms', () => {
  for (const indent of [2, 3, 4]) {
    expect(carveToHtml(`> - :: a\n${' '.repeat(indent)}:: b\n>   : p\n`)).toContain('<dt>a\n:: b</dt>')
  }
  expect(carveToHtml('> - :: a\n>   :: b\n>   : p\n')).toContain('<dt>a</dt>\n        <dt>b</dt>')
  expect(carveToHtml('> - :: a\n  : b\n>   : p\n')).toContain('<dt>a\n: b</dt>')
})

it('bounds collection of repeated marker-term descriptions and code', () => {
  const previous = layoutWork.on
  try {
    const work = [32, 64, 128].map(count => {
      const source = '- :: term\n  : payload\n    ```\n    body\n  ```\nafter\n\n'.repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      expect(carveToHtml(source).match(/<code>/g)).toHaveLength(count)
      const total = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines + layoutWork.geometryEntries
      expect(total).toBeLessThanOrEqual(source.length * 64)
      return total
    })
    expect(work[1]!).toBeLessThanOrEqual(work[0]! * 2.5)
    expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
})

it('bounds closer lookup for CODE-shaped payload lines', () => {
  const previous = layoutWork.on
  try {
    const work = [64, 128, 256].map(count => {
      const payload = '    ```` js\n'.repeat(count)
      const source = `- :: term\n  : payload\n    \`\`\`\n${payload}    \`\`\`\n    \`\`\`\`\nafter\n`
      layoutWork.reset()
      layoutWork.on = true
      expect(carveToHtml(source)).toContain(`<pre><code>${'```` js\n'.repeat(count)}</code></pre>`)
      const total = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets +
        layoutWork.closerLines + layoutWork.geometryEntries
      expect(total).toBeLessThanOrEqual(source.length * 64)
      return total
    })
    expect(work[1]!).toBeLessThanOrEqual(work[0]! * 2.5)
    expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
})

perfIt('reads a long marker term once while collecting its code body', () => {
  expectBuiltInputScansLinearly(carveToHtml, count =>
    `- :: ${'term'.repeat(count)}\n  : payload\n    \`\`\`\n${'    body\n'.repeat(count)}  \`\`\`\nafter\n`,
  { label: 'marker-term code body', smallRepeats: 2048 })
})
