import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, Profile, applyProfile, diffAst, fromAstJson, lintAccessibility, parse, resolve, toAstJson } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

describe('line block line sequences', () => {
  it('publishes verse lines beside the unchanged paragraphs', () => {
    const block = toAstJson(parse('::: |\nRoses are red\n  Violets are blue\n:::\n')).children[0]
    expect(block?.type).toBe('line_block')
    if (block?.type !== 'line_block') return
    expect(block.children).toHaveLength(1)
    expect(block.lines).toHaveLength(2)
    expect(block.lines?.[0]).toMatchObject([{ type: 'text', value: 'Roses are red' }])
    expect(block.lines?.[1]).toMatchObject([{ type: 'text', value: '\uE000\uE000Violets are blue' }])
  })

  it('keeps an inline wrapper split across verse lines', () => {
    const block = toAstJson(parse('::: |\n*a\nb*\n:::\n')).children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    expect(block.lines?.map((line) => line[0]?.type)).toEqual(['strong', 'strong'])
    expect(block.children).toHaveLength(1)
  })

  it('retains a comment on the last line and round-trips the matrix', () => {
    const json = toAstJson(parse('::: |\na\n%% end\n:::\n'))
    const block = json.children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    expect(block.lines?.[1]?.[0]?.type).toBe('comment')
    expect(toAstJson(fromAstJson(json))).toEqual(json)
  })

  it('refuses a malformed line matrix before it reaches a renderer', () => {
    const json = toAstJson(parse('::: |\na\n:::\n'))
    const block = json.children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    block.lines = [['bad' as never]]
    expect(() => fromAstJson(json)).toThrow(AstJsonSchemaError)
  })

  it('filters denied inline content from both line block views', () => {
    const doc = resolve(parse('::: |\na `<b>`{=html}\nb\n:::\n'))
    applyProfile(doc, Profile.article())
    const block = toAstJson(doc).children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    expect(JSON.stringify(block)).not.toContain('raw_inline')
  })

  it('refreshes an ingested line view after filtering changes its children', () => {
    const doc = fromAstJson(toAstJson(parse('::: |\na `<b>`{=html}\nb\n:::\n')))
    applyProfile(doc, Profile.article())
    const block = toAstJson(doc).children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    expect(JSON.stringify(block.lines)).not.toContain('raw_inline')
  })

  it('keeps an ingested finer line view while its children are unchanged', () => {
    const json = toAstJson(parse('::: |\na\nb\n:::\n'))
    const block = json.children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    block.lines = [[{ type: 'text', value: 'finer' } as never]]
    const emitted = toAstJson(fromAstJson(json)).children[0]
    if (emitted?.type !== 'line_block') throw new Error('expected a line block')
    expect(emitted.lines).toEqual(block.lines)
  })

  it('does not report line positions as a content change when a block moves', () => {
    const before = toAstJson(parse('::: |\na\nb\n:::\n'))
    const after = toAstJson(parse('Intro.\n\n::: |\na\nb\n:::\n'))
    expect(diffAst(before, after).filter((change) => change.type === 'line_block')).toEqual([])
  })

  it('publishes a multiline inline footnote once after numbering', () => {
    const block = toAstJson(resolve(parse('::: |\n^[one\ntwo] x[^n]\n:::\n\n[^n]: note\n'))).children[0]
    if (block?.type !== 'line_block') throw new Error('expected a line block')
    const notes = block.lines?.flat().filter((node) => node.type === 'inline_footnote') ?? []
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ type: 'inline_footnote', number: 1 })
  })

  it('does not duplicate lint findings for the second wire view', () => {
    expect(lintCarve('::: |\na [x][nope] b\nc\n:::\n').filter((item) => item.rule === 'unresolved-reference-link')).toHaveLength(1)
    expect(lintAccessibility('::: |\n![](a.png) x\nb\n:::\n').filter((item) => item.rule === 'a11y/image-alt')).toHaveLength(1)
  })
})
