import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import { tryFastAstDocument } from '../src/parse/fast-ast-document.js'
import { tryFastHtml } from '../src/fast-html.js'

describe('simple block AST route', () => {
  it('renders a heading, paragraph, and flat list through the AST route', () => {
    const source = '# Title\n\nOne **bold** line.\n\n- alpha\n- beta\n'
    expect(tryFastHtml(source, {})).toBeUndefined()
    expect(tryFastAstDocument(source)).toBeDefined()
    expect(carveToHtml(source)).toBe(renderHtml(resolve(parse(source))))
  })

  it('keeps a YAML front matter header on an eligible document', () => {
    const source = '---yaml\ntitle: Title\n---\n\n# Title\n\nOne *strong* line.\n\n- alpha\n- beta\n'
    expect(tryFastHtml(source, {})).toBeUndefined()
    expect(tryFastAstDocument(source)?.frontmatter).toEqual({ format: 'yaml', content: 'title: Title' })
    expect(carveToHtml(source)).toBe(renderHtml(resolve(parse(source))))
  })

  it('passes nested and loose lists to the general parser', () => {
    for (const source of [
      '- parent\n  - child\n',
      '- first\n\n- second\n',
      '- first\n\n\n- second\n',
      '- [x] task\n',
      '- 1. ```\n\n',
      'a\uD800b *x*',
      'plain \v tail\n',
      '---yaml\ntitle: Title\n',
      '---yaml \ntitle: Title\n---\n',
      '---json\n{"title":"Title"}\n---\n',
      '---yaml\ntitle: Title\n--- \n',
    ]) {
      expect(tryFastAstDocument(source), source).toBeUndefined()
      expect(carveToHtml(source), source).toBe(renderHtml(resolve(parse(source))))
    }
  })
})
