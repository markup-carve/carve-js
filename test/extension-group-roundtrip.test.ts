import { describe, expect, it } from 'vitest'
import { carveToHtml, codeGroup, htmlToAst, htmlToCarve, tabs } from '../src/index.js'

const tabSource = ':::: tabs\n::: tab [One]\nfirst\n:::\n::: tab [Two]\nsecond\n:::\n::::\n'
const codeSource = '::: code-group\n```js [One]\na\n```\n```ts [Two]\nb\n```\n:::\n'

describe('extension group HTML roundtrip', () => {
  for (const [source, extension, kind, mode] of [
    [tabSource, tabs(), 'tabs', 'interactive'],
    [codeSource, codeGroup(), 'code-group', 'interactive'],
    [tabSource, tabs({ mode: 'aria' }), 'tabs', 'interactive'],
    [codeSource, codeGroup({ mode: 'aria' }), 'code-group', 'interactive'],
    [tabSource, tabs(), 'tabs', 'static'],
    [codeSource, codeGroup(), 'code-group', 'static'],
  ] as const) {
    it(`rebuilds ${kind} from its ${mode} HTML`, () => {
      const html = carveToHtml(source, { roundtrip: true, extensions: [extension], mode })
      const ast = htmlToAst(html).value
      const group = ast.children[0]
      expect(group).toMatchObject({ type: 'admonition', kind })
      expect(group?.type === 'admonition' && group.children).toHaveLength(2)
      const result = htmlToCarve(html)
      const back = result.value
      expect(result.report.diagnostics).toEqual([])
      expect(back).toContain(kind === 'tabs' ? 'tab [One]' : '```js [One]')
      expect(back).toContain(kind === 'tabs' ? 'tab [Two]' : '```ts [Two]')
    })
  }

  it('leaves unmarked HTML on the generic import path', () => {
    const html = carveToHtml(tabSource, { extensions: [tabs()] })
    expect(htmlToCarve(html).value).not.toContain('tab [One]')
  })

  it('keeps an authored tab id in each render mode', () => {
    const source = tabSource.replace('::: tab [One]', '{#mytab}\n::: tab [One]')
    for (const mode of ['interactive', 'static'] as const) {
      for (const extension of [tabs(), tabs({ mode: 'aria' })]) {
        const html = carveToHtml(source, { roundtrip: true, extensions: [extension], mode })
        const group = htmlToAst(html).value.children[0]
        expect(group?.type === 'admonition' && group.children[0]?.attrs?.id).toBe('mytab')
      }
    }
  })

  it('keeps an authored heading inside a static tab', () => {
    const source = tabSource.replace('first', '### Head\nfirst')
    const html = carveToHtml(source, { roundtrip: true, extensions: [tabs()], mode: 'static' })
    const back = htmlToCarve(html)
    expect(back.value).toContain('### Head')
    expect(back.report.diagnostics).toEqual([])
  })

  it('keeps a tab label containing a closing bracket', () => {
    const source = tabSource.replace('tab [One]', 'tab [A\\]b]')
    for (const mode of ['interactive', 'static'] as const) {
      const html = carveToHtml(source, { roundtrip: true, extensions: [tabs()], mode })
      const back = htmlToCarve(html)
      expect(back.value).toContain('tab [A\\]b]')
      expect(back.report.diagnostics).toEqual([])
    }
  })
})
