// The three stages of the engine: `render` is parse, resolve and render in a row, and each stage
// can be called on its own.
import { describe, expect, it } from 'vitest'
import { parse, parseTree, render, renderTree, resolveTree } from '../src/index.ts'
import { EXAMPLES, exampleOptions } from './support/conformance.ts'

function outcome(run: () => string): string {
  try {
    return run()
  } catch (error) {
    return `threw ${String(error)}`
  }
}

describe('the stages', () => {
  it('render(source) is renderTree(resolveTree(parseTree(source))) on every example', () => {
    for (const example of EXAMPLES) {
      const options = exampleOptions(example)
      const staged = outcome(() => renderTree(resolveTree(parseTree(example.input), options)))
      expect(staged, example.label).toBe(outcome(() => render(example.input, options)))
    }
  })

  it('parse(source) is the document of resolveTree(parseTree(source)) on every example', () => {
    for (const example of EXAMPLES) expect(resolveTree(parseTree(example.input)).document).toEqual(parse(example.input))
  })

  it('parseTree does no resolution', () => {
    const parsed = parseTree('# T\n\n[T][]')
    expect(parsed.document.stages).toBeUndefined()
    expect(JSON.stringify(parsed.document)).not.toContain('"href"')
  })

  it('a resolved tree renders the same each time', () => {
    const resolved = resolveTree(parseTree('# T\n\n[T][] and a note[^n]\n\n[^n]: n'), { profile: 'comment' })
    const first = renderTree(resolved)
    expect(renderTree(resolved)).toBe(first)
    expect(first).toBe(render('# T\n\n[T][] and a note[^n]\n\n[^n]: n', { profile: 'comment' }))
  })

  it('resolveTree takes a supplied tree, as render does', () => {
    const tree = parse('# T\n\n[T][]', { headingIds: 'lower' })
    expect(renderTree(resolveTree(tree, { headingIds: 'lower' }))).toBe(render(tree, { headingIds: 'lower' }))
  })

  it('a strict render of a resolved tree that loses something throws, as render does', () => {
    const resolved = resolveTree(parseTree('{{ a.crv }}'), { strictLosses: true })
    expect(() => renderTree(resolved)).toThrow('the render lost content')
  })
})
