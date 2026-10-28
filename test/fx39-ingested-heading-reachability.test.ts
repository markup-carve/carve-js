import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderHtml } from '../src/index.js'

describe('ingested heading reference reachability', () => {
  it('drops a stale destination into an unused footnote heading', () => {
    const source = '[^n]: # H\n\n</#H>\n'
    const wire = carveToAstJson(source)
    const paragraph = wire.children.find(node => node.type === 'paragraph') as { children: Array<{ href?: string }> }
    paragraph.children[0]!.href = '#H'
    const html = renderHtml(fromAstJson(wire))
    expect(html).toBe(carveToHtml(source))
    expect(html).toContain('&lt;/#H&gt;')
  })

  it('keeps a destination into a rendered footnote heading', () => {
    const source = '[^n]: # H\n\nsee[^n] </#H>\n'
    const wire = carveToAstJson(source)
    expect(renderHtml(fromAstJson(wire))).toBe(carveToHtml(source))
    expect(renderHtml(fromAstJson(wire))).toContain('href="#H"')
  })
})
