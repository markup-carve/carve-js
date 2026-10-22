import { CANONICAL_ADMONITION_KINDS, GENERATED_CONTENT_KINDS, type BlockNode } from '../../ast.js'
import { forEachChildBlockList } from '../../parse/block/block-children.js'
import { maskDjotCodeAndDestinations } from '../../djot-migrate.js'
import { parse } from '../../parse.js'

interface DivFrame {
  sourceWidth: number
  targetWidth: number
  parent?: DivFrame
  bare: boolean
}

export function genericDjotDivClasses(source: string, contentStart: (line: string) => number): string {
  if (!source.includes(':::')) return source
  const lines = source.split('\n'), masks = maskDjotCodeAndDestinations(source).split('\n')
  const classes = new Map<number, string>(), safeLines = [...lines]
  for (let line = 0; line < lines.length; line++) {
    const at = contentStart(lines[line]!)
    if (masks[line]?.[at] !== ':') continue
    const fence = /^(:{3,})[ \t]+((?:[A-Za-z0-9_-]|\\[_-])+)[ \t]*\r?$/.exec(lines[line]!.slice(at))
    if (!fence) continue
    const className = fence[2]!.replace(/\\([_-])/g, '$1')
    if (className !== 'figure' && !className.startsWith('-') && className === fence[2] &&
        !CANONICAL_ADMONITION_KINDS.has(className) && !GENERATED_CONTENT_KINDS.has(className)) continue
    classes.set(line, className)
    safeLines[line] = lines[line]!.slice(0, at) + fence[1] + ' carve-djot-div'
  }
  if (!classes.size) return source
  const unclosed = new Set<number>()
  const document = parse(safeLines.join('\n'), { positions: true, onUnclosedContainer: site => unclosed.add(site.line - 1) })
  const pending: Array<{ node: BlockNode; parent?: DivFrame }> = document.children.map(node => ({ node }))
  for (const children of Object.values(document.footnoteDefs ?? {})) for (const node of children) pending.push({ node })
  const frames: DivFrame[] = [], mapped = new Set<number>()
  const sites: Array<{ line: number; at: number; frame: DivFrame; className?: string }> = []
  while (pending.length) {
    const { node, parent } = pending.pop()!
    let owner = parent
    if ((node.type === 'div' || node.type === 'admonition' || node.type === 'directive') && node.pos) {
      const line = node.pos.startLine - 1, text = lines[line]
      if (text !== undefined) {
        const at = contentStart(text), fence = /^:{3,}/.exec(text.slice(at))
        if (fence) {
          const className = classes.get(line)
          const frame: DivFrame = { sourceWidth: fence[0].length, targetWidth: fence[0].length, ...(parent ? { parent } : {}), bare: className !== undefined || /^:{3,}[ \t]*\r?$/.test(text.slice(at)) }
          frames.push(frame)
          sites.push({ line, at, frame, ...(className === undefined ? {} : { className }) })
          if (className !== undefined) mapped.add(line)
          const closeLine = node.pos.endLine - 1, closer = lines[closeLine]
          if (!unclosed.has(line) && closer !== undefined) {
            const closeAt = contentStart(closer)
            if (new RegExp('^:{' + frame.sourceWidth + '}[ \t]*\r?$').test(closer.slice(closeAt))) sites.push({ line: closeLine, at: closeAt, frame })
          }
          owner = frame
        }
      }
    }
    if (node.type === 'block_quote') owner = undefined
    forEachChildBlockList(node, children => { for (const child of children) pending.push({ node: child, ...(owner ? { parent: owner } : {}) }) })
  }
  if (mapped.size !== classes.size) return source
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!
    if (frame.bare && frame.parent && frame.parent.targetWidth <= frame.targetWidth) frame.parent.targetWidth = frame.targetWidth + 1
  }
  for (const site of sites) {
    const prefix = lines[site.line]!.slice(0, site.at), fence = ':'.repeat(site.frame.targetWidth)
    if (site.className !== undefined) {
      const continuation = prefix.replace(/\[\^[^\]\n]+\]:[ \t]*/g, '  ').replace(/\[[ xX]\][ \t]+/g, '').replace(/[^> \t]/g, ' ')
      lines[site.line] = prefix + '{class="' + site.className + '"}\n' + continuation + fence
    } else {
      lines[site.line] = prefix + fence + lines[site.line]!.slice(site.at + site.frame.sourceWidth)
    }
  }
  return lines.join('\n')
}
