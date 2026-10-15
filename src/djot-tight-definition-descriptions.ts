import type { BlockNode } from './ast.js'
import { forEachChildBlockList } from './block-children.js'
import { parse } from './parse.js'
import { renderCarve } from './render-carve.js'

export function tightDjotDefinitionDescriptions(source: string): string {
  if (!source.includes('::') || !/^[ \t>]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]/m.test(source)) return source
  let indexes: number[] | undefined
  if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(source)) {
    indexes = []
    let units = 0
    for (const character of source) { indexes.push(units); units += character.length }
    indexes.push(source.length)
  }
  const sourceOffset = (offset: number): number => indexes?.[offset] ?? offset
  const lines = source.split('\n'), offsets: number[] = []
  let offset = 0
  for (const line of lines) { offsets.push(offset); offset += line.length + 1 }
  const edits: { start: number; end: number; value: string }[] = []
  const clearLoose = (node: BlockNode): void => {
    if (!node.pos || node.pos.startLine < 2) return
    const line = node.pos.startLine - 2, marker = /\{loose\}[ \t]*$/.exec(lines[line]!)
    if (marker) edits.push({ start: offsets[line]! + marker.index, end: offsets[line]! + marker.index + marker[0].length, value: '%%' })
  }
  const clearGap = (before: BlockNode['pos'], after: BlockNode['pos'], boundary = false): void => {
    if (!before || !after || after.startOffset === undefined) return
    const prefix = lines[after.startLine - 1]!.slice(0, sourceOffset(after.startOffset) - offsets[after.startLine - 1]!)
    let inserted = false
    for (let line = before.endLine - 1; line < after.startLine - 1; line++) if (/^[ \t>]*$/.test(lines[line]!)) {
      edits.push({ start: offsets[line]!, end: offsets[line]! + lines[line]!.length + Number(line + 1 < lines.length), value: boundary && !inserted ? prefix + '+\n' : '' })
      inserted = true
    }
  }
  const hasParagraphGap = (node: Extract<BlockNode, { type: 'list' }>): boolean => {
    let previous: BlockNode | undefined
    for (const item of node.items) for (const child of item.children) {
      if (previous?.type === 'paragraph' && previous.pos && child.pos) {
        let blank = false
        for (let line = previous.pos.endLine - 1; line < child.pos.startLine - 1; line++) {
          if (/^[ \t>]*$/.test(lines[line]!)) blank = true
          else if (blank && child.type === 'definition_list' && /^[ \t>]*\{(?!loose\}[ \t]*$)/.test(lines[line]!)) return true
        }
        if (blank && (child.type === 'paragraph' || child.type === 'comment')) return true
      }
      previous = child
    }
    return false
  }
  const pending: [BlockNode, boolean][] = parse(source).children.map(node => [node, false])
  while (pending.length) {
    const [node, inherited] = pending.pop()!
    let tight = node.type === 'list' ? node.tight : inherited
    if (node.type === 'list' && tight && node.items.some(item => item.children.some(child => child.type === 'definition_list')) && hasParagraphGap(node)) {
      tight = false
      if (node.pos?.startOffset !== undefined) {
        const at = sourceOffset(node.pos.startOffset), line = node.pos.startLine - 1
        const prefix = lines[line]!.slice(0, at - offsets[line]!)
        edits.push({ start: at, end: at, value: '{loose}\n' + prefix })
      }
    }
    if (node.type === 'list' && !tight && node.items.every(item => item.children.every(child => ['definition_list', 'paragraph', 'comment'].includes(child.type))) && node.items.some(item => item.children.some(child => child.type === 'definition_list')) && !hasParagraphGap(node)) {
      tight = true
      clearLoose(node)
      for (const item of node.items) for (let i = 1; i < item.children.length; i++) clearGap(item.children[i - 1]!.pos, item.children[i]!.pos, item.children[i - 1]!.type === 'definition_list')
      for (let i = 1; i < node.items.length; i++) clearGap(node.items[i - 1]!.pos, node.items[i]!.pos)
    }
    if (node.type === 'definition_list' && tight) {
      if (node.loose) clearLoose(node)
      for (const item of node.items) for (const description of item.definitions) {
        if (description.length < 2 || !description.every(block => block.type === 'paragraph')) continue
        const first = description[0]!.pos, last = description.at(-1)!.pos
        if (first?.startOffset === undefined || last?.endOffset === undefined) continue
        const prefix = lines[first.startLine - 1]!.slice(0, sourceOffset(first.startOffset) - offsets[first.startLine - 1]!)
        const continuation = prefix.replace(/:[ \t]+$/, spaces => ' '.repeat(spaces.length))
        const joined = { ...description[0]!, children: description.flatMap((paragraph, index) => [...(index && description[index - 1]!.children.at(-1)?.type !== 'hard_break' ? [{ type: 'soft_break' as const }] : []), ...paragraph.children]) }
        delete joined.attrs
        const contents = renderCarve({ type: 'document', children: [joined] }).replace(/\n+$/, '')
        edits.push({ start: sourceOffset(first.startOffset), end: sourceOffset(last.endOffset), value: contents.replace(/\n/g, '\n' + continuation) })
      }
    }
    forEachChildBlockList(node, children => { for (const child of children) pending.push([child, tight]) })
  }
  if (!edits.length) return source
  const result: string[] = []
  let copied = 0
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    if (edit.start < copied) continue
    result.push(source.slice(copied, edit.start), edit.value)
    copied = edit.end
  }
  result.push(source.slice(copied))
  return result.join('')
}
