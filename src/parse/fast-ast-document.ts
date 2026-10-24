import type { BlockNode, Document, HeadingLevel, InlineNode, ListItem } from '../ast.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { dropTrailingWhitespace } from './block/parse-block-boundaries.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'

class FastInlineSession extends InlineParseSession {
  constructor() {
    super()
    this.recordPositions = false
  }

  inlines(text: string): InlineNode[] {
    return this.parseInline(text, new Map())
  }
}

const HEADING = /^(#{1,6})[ \t]+(.+)$/
const BULLET = /^([-*]) (.+)$/

function unsupported(line: string): boolean {
  return line[0] === ' ' || line[0] === '\t' ||
    !(/^[A-Za-z0-9\u0080-\uFFFF]/.test(line) || line[0] === '(' || line[0] === '`' || line[0] === '[') ||
    line.startsWith('```') ||
    /^(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|\.)[.)](?:\{| )/.test(line) ||
    /^\[[^\]]+\]:/.test(line) ||
    /^[-*_]{3,}$/.test(line)
}

export function tryFastAstDocument(source: string): Document | undefined {
  if (source.includes('\r') || source.includes('\0') || source.includes('\t') || source.includes('![') ||
      source.includes('\n: ') ||
      source.includes('[^') || source.includes('^[') || source.includes(']:') ||
      /(^|\n)[ \t]+(?:[-*+>|~{:]|[0-9]+[.)] )/.test(source) ||
      /(^|\n)(?:[ \t]*\+\s*$|[ \t]*::|[ \t]*\||[ \t]*%%|[-*] \[)/m.test(source) ||
      /\n\n[ \t]/.test(source) ||
      source.charCodeAt(0) === 0xfeff) return undefined
  const lines = source.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const inline = new FastInlineSession()
  const blocks: BlockNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    if (line === '') { i++; continue }
    if (line.trim() === '') return undefined
    const heading = HEADING.exec(line)
    if (heading) {
      if (heading[2]!.trim() === '') return undefined
      blocks.push({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines(dropTrailingWhitespace(heading[2]!)) })
      i++
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet) {
      const marker = bullet[1]!
      const items: ListItem[] = []
      while (i < lines.length) {
        const match = BULLET.exec(lines[i]!)
        if (!match || match[1] !== marker) break
        if (!/^[A-Za-z0-9\u0080-\uFFFF`]/.test(match[2]!) || match[2]!.startsWith('```')) return undefined
        const content = [match[2]!]
        i++
        while (i < lines.length && lines[i]!.startsWith('  ') && lines[i]!.trim() !== '') {
          const continuation = lines[i]!
          if (continuation.startsWith('   ') || continuation.startsWith('  ```') ||
              !/^[A-Za-z0-9\u0080-\uFFFF\[(`]/.test(continuation.slice(2)) ||
              /^  (?:[-*+] |\d+[.)] |[a-zA-Z][.)] |>|::|~|\|)/.test(continuation)) return undefined
          content.push(lines[i]!.slice(2))
          i++
        }
        items.push({ type: 'list_item', children: [{ type: 'paragraph',
          children: inline.inlines(dropTrailingWhitespace(content.join('\n'))) }] })
      }
      if (i < lines.length && lines[i] === '' && BULLET.test(lines[i + 1] ?? '')) return undefined
      if (i < lines.length && lines[i] !== '') return undefined
      blocks.push({ type: 'list', ordered: false, tight: true, bulletChar: marker as '-' | '*', items })
      continue
    }
    if (unsupported(line) || line.startsWith('- ' ) || line.startsWith('* ')) return undefined
    const content = [line]
    i++
    while (i < lines.length && lines[i] !== '') {
      const next = lines[i]!
      if (HEADING.test(next)) break
      if (BULLET.test(next) || unsupported(next)) return undefined
      content.push(next)
      i++
    }
    blocks.push({ type: 'paragraph', children: inline.inlines(dropTrailingWhitespace(content.join('\n'))) })
  }
  return { type: 'document', children: blocks, srcByteLength: utf8ByteLength(source) }
}
