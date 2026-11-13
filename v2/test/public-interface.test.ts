// The public interface of the 0.2 engine: `parse`, `render` and the option types come from
// src/index.ts, and nothing in src/ reaches outside v2/, where the 0.1 engine lives.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as engine from '../src/index.ts'
import {
  type AstNode, type Diagnostic, type Options, type ParseOptions, type RenderOptions,
} from '../src/index.ts'

const src = join(import.meta.dirname, '../src')

describe('the public interface', () => {
  it('exports parse and render with their companions', () => {
    for (const name of [
      'parse', 'parseWithDiagnostics', 'render', 'renderWithDiagnostics', 'encodeTree', 'encodeEnvelope', 'decodeTree',
      'treesEqual', 'validateTree', 'stringOffsetOfByte', 'CarveTreeError', 'CarveOptionError', 'CarveRenderError',
    ] as const) {
      expect(typeof engine[name]).toBe('function')
    }
    expect(engine.AST_VERSION).toBe('2.0')
  })

  it('parse gives a resolved tree with positions, and render takes source or a tree', () => {
    const options: ParseOptions = { headingIds: 'lower' }
    const tree: AstNode = engine.parse('# T\n\n[T][]', options)
    expect([tree.children![0]!.generatedId, tree.children![0]!.pos?.startLine, tree.stages]).toEqual(['t', 1, ['referenceResolution', 'tableAlignment']])
    const render: RenderOptions = { sections: false, headingIds: 'lower' }
    expect(engine.render(tree, render)).toBe('<h1 id="t">T</h1>\n<p><a href="#t">T</a></p>')
    expect(engine.render('# T\n\n[T][]', render)).toBe(engine.render(tree, render))
    expect(engine.parse('a', { positions: false }).children![0]!.pos).toBeUndefined()
  })

  it('the diagnostics record comes beside the tree and beside the HTML (C2-A-172)', () => {
    const parsed: { document: AstNode, diagnostics: Diagnostic[] } = engine.parseWithDiagnostics('{#a}\nx\n\n{#a}\ny')
    expect(parsed.diagnostics.map((entry) => [entry.code, entry.channel])).toEqual([['duplicate-id', 'parse']])
    expect(JSON.stringify(parsed.document)).not.toContain('duplicate')
    const rendered = engine.renderWithDiagnostics('{{ a.crv }}')
    expect(rendered.diagnostics.map((entry) => [entry.code, entry.channel])).toEqual([['include-unresolved', 'render-loss']])
  })

  it('parse refuses a render option, and render refuses a tree that is no tree of contract 2.0', () => {
    const render: Options = { sections: false }
    expect(() => engine.parse('a', render as ParseOptions)).toThrow('option sections: not an option of parse')
    expect(() => engine.render({ type: 'document', astVersion: '2.0', children: [{ type: 'nope' }] })).toThrow(engine.CarveTreeError)
  })

  it('rendering source builds no positions unless the source lines are asked for', () => {
    expect(engine.render('a', { sourceLines: true })).toBe('<p data-source-line="1">a</p>')
    expect(engine.render('a')).toBe('<p>a</p>')
  })

  it('no file of src/ imports from outside v2/src', () => {
    for (const file of readdirSync(src)) {
      const text = readFileSync(join(src, file), 'utf8')
      for (const match of text.matchAll(/from '([^']+)'/g)) expect(match[1]).toMatch(/^\.\/[a-z-]+\.ts$/)
    }
  })
})
