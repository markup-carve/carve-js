import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, type IncludeOptions } from '../src/index.js'

// Spec PART 9 section 19: "A node an include pulled in keeps the coordinates
// of its own file and carries that file's canonical id in pos.file." A
// `@lines` slice is cut from that file, so its nodes report where they sit in
// the file, not where they sit in the slice. Every case below pairs the slice
// with the unsliced control, which is the reading the slice has to match.

/** 8 lines of padding, 20 codepoints. */
const PAD = 'pad\n\npad\n\npad\n\npad\n\n'

function expand(source: string, files: Record<string, string>, options: Omit<IncludeOptions, 'resolve'> = {}) {
  const doc = parse(source, { positions: true })
  return expandIncludes(doc, source, {
    ...options,
    sourcePath: 'root.crv',
    resolve: (path) => (path in files ? { source: files[path]!, id: path } : null),
  })
}

function positions(source: string, files: Record<string, string>) {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const node = value as { type?: string; pos?: Record<string, unknown> }
    if (node.type && node.pos) {
      const p = node.pos
      out.push(
        `${node.type} L${p.startLine}-${p.endLine} C${p.startColumn}-${p.endColumn} O${p.startOffset}-${p.endOffset} f=${p.file}`,
      )
    }
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'pos') visit(inner)
    }
  }
  const result = expand(source, files)
  visit(result.doc.children)
  if (result.doc.footnoteDefs) visit(Object.values(result.doc.footnoteDefs))
  return out
}

describe('a @lines slice reports the coordinates of the file it was cut from', () => {
  it('a heading on line 9 reports line 9, not line 1', () => {
    const files = { 'child.crv': `${PAD}## Deep heading\n\nBody.\n` }
    expect(positions('{{ child.crv @lines:9-11 }}\n', files)).toEqual([
      'heading L9-9 C1-16 O20-35 f=child.crv',
      'text L9-9 C4-16 O23-35 f=child.crv',
      'paragraph L11-11 C1-6 O37-42 f=child.crv',
      'text L11-11 C1-6 O37-42 f=child.crv',
    ])
  })

  it('the sliced reading equals the unsliced control node for node', () => {
    const files = { 'child.crv': `${PAD}## Deep heading\n\n| a | b |\n|---|---|\n| one | two |\n\nTail *em*.\n\n[^fn]: note\n` }
    const control = positions('{{ child.crv }}\n', files)
    // Four padding paragraphs, one paragraph and one text node each.
    expect(positions('{{ child.crv @lines:9-17 }}\n', files)).toEqual(control.slice(8))
  })

  it('a warning raised inside a sliced child names the line it was written on', () => {
    const files = { 'padded.crv': `${PAD}{{ missing.crv }}\n` }
    const control = expand('{{ padded.crv }}\n', files).warnings
    expect(control).toEqual([
      expect.objectContaining({ rule: 'include-unresolved', line: 9, column: 1, start: 20, end: 37, file: 'padded.crv' }),
    ])
    expect(expand('{{ padded.crv @lines:9-9 }}\n', files).warnings).toEqual(control)
  })

  it('a sliced grandchild carries its own base and not the one above it', () => {
    const files = {
      'child.crv': `${PAD}{{ grand.crv @lines:9-9 }}\n`,
      'grand.crv': `${PAD}Grandchild body.\n`,
    }
    // grand.crv's own base, so L9/O20. The child's base is 8 lines and 20
    // codepoints too; adding it on top would report L17/O40.
    expect(positions('{{ child.crv @lines:9-9 }}\n', files)).toEqual([
      'paragraph L9-9 C1-17 O20-36 f=grand.crv',
      'text L9-9 C1-17 O20-36 f=grand.crv',
    ])
  })

  it('a CRLF child is rebased over the endings it really has', () => {
    const files = { 'child.crv': 'a\r\nb\r\nc\r\nHeading here\r\n' }
    // Offsets index the raw source, so the three CRLF lines ahead of line 4
    // occupy 9 codepoints, not 6.
    expect(positions('{{ child.crv @lines:4-4 }}\n', files)).toEqual([
      'paragraph L4-4 C1-13 O9-21 f=child.crv',
      'text L4-4 C1-13 O9-21 f=child.crv',
    ])
  })

  it('a slice starting at line 1 moves nothing', () => {
    const files = { 'child.crv': 'One\n\nTwo\n' }
    expect(positions('{{ child.crv @lines:1-1 }}\n', files)).toEqual([
      'paragraph L1-1 C1-4 O0-3 f=child.crv',
      'text L1-1 C1-4 O0-3 f=child.crv',
    ])
  })
})
