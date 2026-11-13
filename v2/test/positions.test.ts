// Positions (C2-A-138 to C2-A-160): lines and columns from 1, columns in code points, offsets in
// UTF-8 bytes of the original source, ends exclusive.
import { describe, expect, it } from 'vitest'
import { type AstNode, type Position } from '../src/ast.ts'
import { stringOffsetOfByte, utf8Length } from '../src/positions.ts'
import { at, block, blocks, placedTree, tree } from './support/tree.ts'

/** A position as `line:column-line:column@start-end`. */
function show(pos: Position | undefined): string {
  if (pos === undefined) return 'none'
  return `${pos.startLine}:${pos.startColumn}-${pos.endLine}:${pos.endColumn}@${pos.startOffset}-${pos.endOffset}`
}

function placed(src: string, path: string): string {
  return show((at(placedTree(src), path) as AstNode).pos)
}

/** The source bytes a position spans, decoded. */
function slice(src: string, pos: Position): string {
  return new TextDecoder().decode(new TextEncoder().encode(src).subarray(pos.startOffset, pos.endOffset))
}

describe('the six integers', () => {
  it('C2-A-138: every node a parser built carries pos, except the root', () => {
    const root = placedTree('# T\n\n- a *b*')
    expect(root.pos).toBeUndefined()
    expect(placed('# T\n\n- a *b*', 'children.1.children.0.children.0.children.1.children.0')).toBe('3:6-3:7@10-11')
  })

  it('C2-A-139: a node with no position omits pos; it is never null', () => {
    expect(JSON.stringify(tree('a *b*'))).not.toContain('pos')
    expect(JSON.stringify(placedTree('| a |\n+ b |'))).not.toContain('null')
  })

  it('C2-A-140, C2-A-141: the example of the tree document', () => {
    // The text `é!` behind the two characters of a no-break space: a column per code point, two bytes for the accented letter.
    expect((at(placedTree('\\ é!'), 'children.0.children.1') as AstNode).pos).toEqual({
      startLine: 1, endLine: 1, startColumn: 3, endColumn: 5, startOffset: 2, endOffset: 5,
    })
    expect(placed('ab {*é!*}', 'children.0.children.1.children.0')).toBe('1:6-1:8@5-8')
  })

  it('C2-A-141: two-, three- and four-byte characters count one column each and their bytes', () => {
    const src = 'é€😀 *é€😀* `x`\n\n> é€😀 /y/'
    expect(placed(src, 'children.0.children.1')).toBe('1:5-1:10@10-21')
    expect(placed(src, 'children.0.children.3')).toBe('1:11-1:14@22-25')
    expect(placed(src, 'children.1')).toBe('3:1-3:10@27-42')
    expect(placed(src, 'children.1.children.0.children.1')).toBe('3:7-3:10@39-42')
    const emphasis = at(placedTree(src), 'children.1.children.0.children.1') as AstNode
    expect(slice(src, emphasis.pos!)).toBe('/y/')
  })

  it('C2-A-141: a byte-order mark and every carriage return are counted as they stand', () => {
    // C2-B-165: the mark is skipped, so the paragraph starts behind it, and its bytes and its column are counted.
    expect(placed('﻿a\r\n\r\nb *c*\r\n', 'children.0')).toBe('1:2-1:3@3-4')
    expect(placed('﻿a\r\n\r\nb *c*\r\n', 'children.1.children.1')).toBe('3:3-3:6@10-13')
  })

  it('C2-A-141: every offset falls on a code point boundary and spans the source of its node', () => {
    const src = '# Ünï 😀\n\n- [x] ａ *ｂ* — `ｃ` [d](é) ![e](f)\n\n| é | 😀 |\n'
    const visit = (node: AstNode): void => {
      if (node.pos !== undefined) expect(() => slice(src, node.pos!)).not.toThrow()
      for (const child of node.children ?? []) visit(child)
    }
    visit(placedTree(src))
    const strong = at(placedTree(src), 'children.1.children.0.children.0.children.1') as AstNode
    expect(slice(src, strong.pos!)).toBe('*ｂ*')
  })

  it('the helper turns a byte offset into a string offset', () => {
    const src = 'aé€😀b'
    expect([0, 1, 3, 6, 10, 11].map((byte) => stringOffsetOfByte(src, byte))).toEqual([0, 1, 2, 3, 5, 6])
    expect(stringOffsetOfByte(src, 2)).toBe(1)
    expect(stringOffsetOfByte(src, 99)).toBe(6)
    expect(utf8Length(src)).toBe(11)
  })
})

describe('invariants', () => {
  it('C2-A-143: the start is not behind the end, and line and column are those of the offset', () => {
    expect(placed('a\nb\n\nc', 'children.1')).toBe('4:1-4:2@5-6')
  })

  it('C2-A-144: a child lies inside its parent', () => {
    expect(placed('> - a', 'children.0')).toBe('1:1-1:6@0-5')
    expect(placed('> - a', 'children.0.children.0')).toBe('1:3-1:6@2-5')
    expect(placed('> - a', 'children.0.children.0.children.0.children.0')).toBe('1:5-1:6@4-5')
  })

  it('C2-A-145, C2-A-147: siblings are ordered and disjoint, a comment of a comment-only line included', () => {
    expect(placed('> a\n>\n> %% c\n>\n> b', 'children.0.children.1')).toBe('3:3-3:7@8-12')
    expect(placed('> a\n>\n> %% c\n>\n> b', 'children.0.children.2')).toBe('5:3-5:4@17-18')
  })

  it('C2-A-145: the comment between an attribute line and its block lies inside the span of that block', () => {
    const [comment, paragraph] = blocks('x').length > 0 ? placedTree('{.a}\n%% c\ntext').children! : []
    expect(show(comment!.pos)).toBe('2:1-2:5@5-9')
    expect(show(paragraph!.pos)).toBe('1:1-3:5@0-14')
  })

  it('C2-A-148: a span starts at the markup that opens the construct, and a block that took attribute lines at the first of them', () => {
    expect(placed('  # T', 'children.0')).toBe('1:3-1:6@2-5')
    expect(placed('{.a}\n{.b}\npara', 'children.0')).toBe('1:1-3:5@0-14')
    expect(placed('a [b](c) d', 'children.0.children.1')).toBe('1:3-1:9@2-8')
  })

  it('C2-A-148, C2-A-183: a captioned block starts at its own markup, and the figure at the attribute line', () => {
    expect(placed('{#f}\n> q\n^ c', 'children.0')).toBe('1:1-3:4@0-12')
    expect(placed('{#f}\n> q\n^ c', 'children.0.children.0')).toBe('2:1-2:4@5-8')
    expect(placed('{#f}\n> q\n^ c', 'children.0.caption')).toBe('3:1-3:4@9-12')
  })

  it('C2-A-149: a table cell spans the text between its pipes', () => {
    expect(placed('| a |= b |', 'children.0.children.0.children.0.children.0')).toBe('1:2-1:5@1-4')
    expect(placed('| a |= b |', 'children.0.children.0.children.0.children.1')).toBe('1:6-1:10@5-9')
  })

  it('C2-A-151: a closing delimiter and an attached attribute block are inside; the line ending is outside', () => {
    expect(placed('[a]{.c}\n\nb', 'children.0.children.0')).toBe('1:1-1:8@0-7')
    expect(placed('```\nx\n```\n\nb', 'children.0')).toBe('1:1-3:4@0-9')
  })

  it('C2-A-150, C2-A-152, C2-A-153: a break owns its line ending; a hard break also spans its backslash', () => {
    expect(placed('a\nb', 'children.0.children.1')).toBe('1:2-2:1@1-2')
    expect(placed('a\\\nb', 'children.0.children.1')).toBe('1:2-2:1@1-3')
    expect(placed('| a\\ |', 'children.0.children.0.children.0.children.0.children.0.children.1')).toBe('1:4-1:5@3-4')
  })

  it('C2-A-154: a container ends after its closer, or after its last child', () => {
    expect(placed(':::\na\n:::\n\nb', 'children.0')).toBe('1:1-3:4@0-9')
    expect(placed('- a\n- b\n\nc', 'children.0')).toBe('1:1-2:4@0-7')
  })

  it('C2-A-155: a container with no positioned child spans its own opening markup', () => {
    expect(placed('>', 'children.0')).toBe('1:1-1:2@0-1')
  })

  it('C2-A-156, C2-A-158: a node joined from pieces of several lines omits pos', () => {
    const row = at(placedTree('| a | b |\n+ c | |'), 'children.0.children.0.children.0') as AstNode
    expect(row.pos).toBeUndefined()
    expect(show(row.children![0]!.pos)).toBe('none')
    expect(show((at(row, 'children.0.children.0') as AstNode).pos)).toBe('none')
    expect(show(row.children![1]!.pos)).toBe('1:6-1:9@5-8')
    // C2-B-176: a fragment past the last column forms a cell, which stands on the line of the continuation row.
    const formed = at(placedTree('| a |\n+ b | c |'), 'children.0.children.0.children.0.children.1') as AstNode
    expect([formed.children![0]!.children, formed.pos]).toEqual([[{ type: 'text', value: 'c' }], undefined])
  })

  it('C2-A-158: a table column, a caption number and the cells of a delimited table have no position', () => {
    const table = block('x').type === 'paragraph' ? placedTree('| a |\n^ T #').children![0]! : null
    expect(show(table!.columns![0]!.pos)).toBe('none')
    expect(show((at(table, 'caption.children.0.children.1') as AstNode).pos)).toBe('none')
    expect(show((at(placedTree('{table}\n```csv\na\n```'), 'children.0.children.0.children.0.children.0') as AstNode).pos)).toBe('none')
  })

  it('C2-A-182: an include node spans the directive', () => {
    expect(placed('{{ a.crv }}', 'children.0')).toBe('1:1-1:12@0-11')
  })
})
