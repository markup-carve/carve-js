import { djotImageEmptyDestinations } from './djot-image-empty-destinations.js'
import { importedDjotHeadingTargets } from './djot-heading-targets.js'
import { genericDjotDivClasses } from './djot-div-classes.js'
import { backtickRunEnds } from './backtick-run-index.js'
import { djotItemPrefix } from './djot-inline-boundaries.js'
import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'
import { attributeContext, continuesParagraph, resetParagraphContext } from './djot-attributes.js'
import { djotDestinationLines } from './djot-destination-lines.js'
import { djotPlaceholderPrefix } from './djot-placeholder-prefix.js'
import { trimEndMatchingEdges, trimNonNbsp, trimStartNonNbsp } from './trim-non-nbsp.js'
import { parse, hasInvalidContainerMetadata, colonFenceOpenerLen, MAX_NESTING_DEPTH } from './parse.js'
import { renderHtml } from './render-html.js'
import { renderDjotImageChildText } from './djot-image-child-text.js'
import { djotCollapsedReferenceText, djotImageLabelAttributes } from './djot-collapsed-reference.js'
import { escapeImageAlt } from './render-carve.js'
import { djotEmphasis } from './djot-emphasis.js'
import { attributedDjotWords } from './djot-word-attributes.js'
import { readAttributes, rejectedCommentStartsBlock } from './djot-attributes.js'
import { maskDjotOpaque } from './djot-opaque.js'
import { djotBlockLayout, djotCodePadding, djotInlineLayout, hasDjotCodeLayoutCandidates } from './djot-block-layout.js'
import { djotReferenceLayout } from './djot-reference-layout.js'
import { djotImportLosses, type DjotImportLoss } from './djot-import-losses.js'
/* Convert Djot source to Carve without treating it as already-Carve source. */

import { escapePlainDjotText } from './djot-plain-text.js'
import { applyMigrationFixes, isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences, djotContentStart, djotTableRows, djotInlineBoundaries } from './djot-migrate.js'

const fencedLines = (lines: readonly string[]): boolean[] => {
  let fence: { ch: string; len: number } | null = null
  return lines.map((line) => {
    if (fence) {
      const close = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line)
      if (close?.[1]?.[0] === fence.ch && close[1].length >= fence.len) fence = null
      return true
    }
    const open = /^(\s*)(`{3,}|~{3,})\s*([a-zA-Z0-9_+#.-]*)$/.exec(line.trimEnd())
    if (!open) return false
    fence = { ch: open[2]![0]!, len: open[2]!.length }
    return true
  })
}

const quoted = (line: string): [number, string] => {
  let depth = 0
  let content = line
  while (true) {
    const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(content)
    if (!prefix) return [depth, content]
    depth++
    content = content.slice(prefix[0].length)
  }
}

function replaceDjotImageLabels(source: string, mask: string, replace: (image: string, label: string, at: number, completeTarget: boolean) => string, allowIncomplete = false): string {
  if (!source.includes('![')) return source
  const opens: number[] = [], closes = new Map<number, { end: number; completeTarget: boolean }>()
  const boundaries = new Set(djotInlineBoundaries(source, mask))
  for (const match of source.matchAll(/\n[ \t]*\n/g)) boundaries.add(match.index!)
  const referenceEnds = new Int32Array(source.length).fill(-1)
  let referenceEnd = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (boundaries.has(at)) referenceEnd = -1
    if (source[at] === ']' && !isDjotEscaped(source, at)) referenceEnd = at
    referenceEnds[at] = referenceEnd
  }
  for (let at = 0; at < source.length; at++) {
    if (boundaries.has(at)) opens.length = 0
    if (mask[at] === '[' && !isDjotEscaped(source, at)) {
      opens.push(at)
    }
    else if (mask[at] === ']' && !isDjotEscaped(source, at)) {
      const open = opens.pop()
      const completeTarget = source[at + 1] === '(' ? mask[at + 1] === ' ' : source[at + 1] === '[' && referenceEnds[at + 2]! >= at + 2
      if (open !== undefined && source[open - 1] === '!' && mask[open - 1] === '!' && !isDjotEscaped(source, open - 1) && (completeTarget || allowIncomplete && /[([]/.test(source[at + 1] ?? ''))) closes.set(open - 1, { end: at, completeTarget })
    }
  }
  if (!closes.size) return source
  const chunks: string[] = []
  let cursor = 0
  for (let at = 0; at < source.length; at++) {
    const close = closes.get(at)
    if (close === undefined) continue
    const { end, completeTarget } = close
    const image = source.slice(at, end + 1)
    const replaced = replace(image, source.slice(at + 2, end), at, completeTarget)
    if (replaced === image) continue
    chunks.push(source.slice(cursor, at), replaced)
    cursor = end + 1
    at = end
  }
  chunks.push(source.slice(cursor))
  return chunks.join('')
}

type DjotImageLineOwner = { start: number; end: number; quotes: number; itemColumn: number; itemQuote: number; table: boolean; div: { width: number; depth: number; column: number } | undefined }

function djotImageLineOwners(source: string, mask: string): DjotImageLineOwner[] {
  const imageLines: DjotImageLineOwner[] = []
  let imageOffset = 0, imageItemColumn = 0, imageItemQuote = 0, imageBlank = false
  const imageDivs: Array<{ width: number; depth: number; column: number }> = []
  const imageOwnerMarker = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+/
  for (const line of source.split('\n')) {
    const contentStart = djotContentStart(line)
    const [depth, body] = quoted(line), text = body.replace(/^[ \t]*/, ''), indent = body.length - text.length
    let itemBody = line
    for (let quote = 0; quote < imageItemQuote; quote++) {
      const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(itemBody)
      if (!prefix) break
      itemBody = itemBody.slice(prefix[0].length)
    }
    const ownerIndent = /^[ \t]*/.exec(itemBody)![0].length
    if (imageOwnerMarker.test(text)) { imageItemColumn = indent + 1; imageItemQuote = depth }
    else if (text && (depth < imageItemQuote || imageBlank && ownerIndent < imageItemColumn || depth === imageItemQuote && indent < imageItemColumn && /^(?:#{1,6} |:{3,}|[-*+] |\{|\|)/.test(text))) imageItemColumn = 0
    imageBlank = !text
    const delimiter = /^(:{3,})(?:[ \t]+\S.*)?[ \t]*$/.exec(line.slice(contentStart))
    if (delimiter && mask[imageOffset + contentStart] !== ' ') {
      const owner = imageDivs.at(-1)
      if (owner && (line.slice(0, contentStart).match(/>/g) ?? []).length === owner.depth && /^:{3,}[ \t]*$/.test(line.slice(contentStart)) && delimiter[1]!.length >= owner.width) imageDivs.pop()
      else imageDivs.push({ width: delimiter[1]!.length, depth: (line.slice(0, contentStart).match(/>/g) ?? []).length, column: contentStart })
    }
    imageLines.push({ start: imageOffset + contentStart, end: imageOffset + line.length + 1, quotes: (line.slice(0, contentStart).match(/>/g) ?? []).length, itemColumn: imageItemColumn, itemQuote: imageItemQuote, table: line[contentStart] === '|', div: imageDivs.at(-1) })
    imageOffset += line.length + 1
  }
  return imageLines
}

function djotImageAltLayout(label: string, quotes: number, itemColumn = 0, itemQuote = 0, div?: { width: number; depth: number; column: number }): { normalized: string; continuations: string[]; valid: boolean } {
  const continuations: string[] = []
  let valid = true
  const normalized = label.split('\n').map((line, index) => {
      if (index === 0) return line
      const [depth, body] = quoted(line)
      let ownerBody = line
      for (let quote = 0; quote < itemQuote; quote++) {
        const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(ownerBody)
        if (!prefix) break
        ownerBody = ownerBody.slice(prefix[0].length)
      }
      const ownerIndent = /^[ \t]*/.exec(ownerBody)![0].length
      const text = body.replace(/^[ \t]*/, '')
      const attributes = text.startsWith('{') ? readAttributes(text, 0) : undefined
      const ownerQuote = /^[ \t]*>(?:[ \t]|$)/.test(ownerBody)
      const extraBlock = /^(?:[-*][ \t]*){3,}$/.test(trimEndMatchingEdges(text, code => code === 32 || code === 9)) || attributes !== undefined && /^[ \t]*$/.test(text.slice(attributes.end))
      if ((extraBlock || ownerQuote) && (depth < quotes || itemColumn > 0 && ownerIndent < itemColumn)) valid = false
      if (div && depth === div.depth && /^[ \t]*:{3,}[ \t]*$/.test(body) && body.trim().length >= div.width && /^[ \t]*/.exec(body)![0].length <= div.column + 3) valid = false
      if ((depth < quotes || itemColumn > 0 && ownerIndent < itemColumn) && /^(?:[-*+](?:[ \t]|$)|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)] |\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\) |: |#{1,6} |`{3,}|~{3,}|:{3,}(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$|\||\^ |\[[^\]]+\]:)/.test(body.replace(/^[ \t]*/, ''))) valid = false
      let start = 0
      for (let quote = 0; quote < quotes; quote++) {
        while (line[start] === ' ' || line[start] === '\t') start++
        if (line[start] !== '>' || start + 1 < line.length && line[start + 1] !== ' ' && line[start + 1] !== '\t') break
        start++
      }
      while (line[start] === ' ' || line[start] === '\t') start++
      continuations.push(line.slice(0, start))
      return line.slice(start)
    }).join('\n')
  return { normalized, continuations, valid: valid && !/\n[ \t]*\n/.test(normalized) }
}

function djotImageBoundaryIndex(source: string, mask: string): (start: number, end: number, depth: number, itemColumn: number, itemQuote: number, divAt?: number) => boolean {
  const offsets: number[] = [], thresholds: number[] = [], itemThresholds: number[] = []
  const stride = source.length + 1
  const divClosers = new Map<number, number>()
  const divs: Array<{ width: number; depth: number; at: number }> = []
  let offset = 0
  const block = /^(?:[-*+](?:[ \t]|$)|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)] |\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\) |: |#{1,6} |`{3,}|~{3,}|:{3,}(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$|\||\^ |\[[^\]]+\]:)/
  for (const line of source.split('\n')) {
    const [depth, body] = quoted(line)
    const blank = /^[ \t]*$/.test(body)
    const text = body.replace(/^[ \t]*/, ''), indent = body.length - text.length
    const attrs = text.startsWith('{') ? readAttributes(text, 0) : undefined
    const extraBlock = /^(?:[-*][ \t]*){3,}$/.test(text) || attrs !== undefined && /^[ \t]*$/.test(text.slice(attrs.end))
    if (blank || block.test(text) || extraBlock) {
      offsets.push(offset)
      thresholds.push(depth + (blank ? 0 : 1))
      itemThresholds.push(depth * stride + (blank ? -1 : indent))
    }
    const contentAt = djotContentStart(line), delimiter = /^(:{3,})(?:[ \t]+\S.*)?[ \t]*$/.exec(line.slice(contentAt))
    if (delimiter && mask[offset + contentAt] !== ' ') {
      const owner = divs.at(-1)
      if (owner && depth === owner.depth && /^:{3,}[ \t]*$/.test(line.slice(contentAt)) && delimiter[1]!.length >= owner.width) { divClosers.set(owner.at, offset); divs.pop() }
      else divs.push({ width: delimiter[1]!.length, depth, at: offset })
    }
    offset += line.length + 1
  }
  let size = 1
  while (size < offsets.length) size *= 2
  const tree = Array<number>(size * 2).fill(Infinity), itemTree = Array<number>(size * 2).fill(Infinity)
  for (let at = 0; at < thresholds.length; at++) { tree[size + at] = thresholds[at]!; itemTree[size + at] = itemThresholds[at]! }
  for (let at = size - 1; at > 0; at--) { tree[at] = Math.min(tree[at * 2]!, tree[at * 2 + 1]!); itemTree[at] = Math.min(itemTree[at * 2]!, itemTree[at * 2 + 1]!) }
  const after = (offset: number): number => {
    let low = 0, high = offsets.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (offsets[middle]! <= offset) low = middle + 1
      else high = middle
    }
    return low
  }
  return (start, end, depth, itemColumn, itemQuote, divAt) => {
    if (divAt !== undefined && (divClosers.get(divAt) ?? Infinity) <= end) return false
    const boundary = itemQuote * stride + itemColumn
    let left = after(start) + size, right = after(end) + size
    while (left < right) {
      if (left % 2) { if (tree[left]! <= depth || itemColumn > 0 && itemTree[left]! < boundary) return false; left++ }
      if (right % 2) { right--; if (tree[right]! <= depth || itemColumn > 0 && itemTree[right]! < boundary) return false }
      left = Math.floor(left / 2); right = Math.floor(right / 2)
    }
    return true
  }
}

const isMarkerLine = (line: string): boolean => /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+\S/.test(line)

function splitSiteFrontmatter(source: string): [string, string, string] {
  const lines = source.split('\n')
  if (!/^--- ?\w*[ \t]*$/.test(lines[0] ?? '')) return ['', '', source]
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i]!)) {
      const frontmatter = lines.slice(0, i + 1).join('\n')
      const offset = frontmatter.length
      const separator = source.startsWith('\n\n', offset) ? '\n\n' : source.startsWith('\n', offset) ? '\n' : ''
      return [frontmatter, separator, source.slice(offset + separator.length)]
    }
  }
  return ['', '', source]
}

function leadingIndent(line: string): [number, number] {
  let columns = 0
  let chars = 0
  while (chars < line.length && (line[chars] === ' ' || line[chars] === '\t')) {
    columns = line[chars] === '\t' ? columns + (4 - (columns % 4)) : columns + 1
    chars++
  }
  return [columns, chars]
}

function charsThroughColumns(line: string, wanted: number): number {
  let columns = 0
  let chars = 0
  while (chars < line.length && columns < wanted && (line[chars] === ' ' || line[chars] === '\t')) {
    columns = line[chars] === '\t' ? columns + (4 - (columns % 4)) : columns + 1
    chars++
  }
  return chars
}

function definitionTermBlockBoundaries(source: string): string {
  if (!source.includes(':') || !(source.includes('|') || source.includes('```') || source.includes('~~~'))) return source
  const mask = maskDjotCodeAndDestinations(source)
  const boundaries = new Set(djotInlineBoundaries(source, mask, true))
  let column: number | undefined, previousBlank = true, offset = 0
  const lines: string[] = [], masks = mask.split('\n')
  for (const [index, line] of source.split('\n').entries()) {
    const [indent, first] = leadingIndent(line), visible = masks[index]!
    const blank = line.trim() === ''
    if (blank) column = undefined
    if (visible[first] === ':') {
      if (/^:(?:[ \t]|$)/.test(line.slice(first)) && (previousBlank || column === undefined && boundaries.has(offset) || column !== undefined && indent <= column)) column = indent
    } else if (column !== undefined && indent <= column) {
      const pipe = visible[first] === '|' && line.trimEnd().endsWith('|')
      const code = /^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t\r]*$/.test(line.slice(first))
      if (pipe || code) {
        let at = lines.length
        while (at > 0) {
          const prior = lines[at - 1]!, [priorIndent, first] = leadingIndent(prior)
          const attrs = prior[first] === '{' ? readAttributes(prior, first, false, false, false) : undefined
          if (priorIndent > indent || !attrs || prior.slice(attrs.end).trim() !== '') break
          at--
        }
        lines.splice(at, 0, '')
        column = undefined
      }
      else if (/^(?:#{1,6}(?:[ \t]|$)|>|:{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|(?:[*-][ \t]*){3,}$)/.test(visible.slice(first))) column = undefined
    }
    lines.push(line)
    previousBlank = blank
    offset += line.length + 1
  }
  return lines.join('\n')
}

/** Translate Djot definition-item structure without touching unrelated source. */
function convertDefinitionLists(source: string, emptyTerm: string, depth = 0): string {
  if (depth >= MAX_NESTING_DEPTH) return convertRootDefinitionLists(source, emptyTerm)
  if (/^[ \t]*(?:>[ \t]*)+(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)*:(?:[ \t]|$)/m.test(source)) {
    const lines = source.split('\n'), masks = maskDjotCodeAndDestinations(source).split('\n')
    const result: string[] = []
    for (let at = 0; at < lines.length;) {
      const quote = /^(>)(?:[ \t]|$)/.exec(lines[at]!)
      if (!quote || masks[at]![quote[1]!.length - 1] !== '>') {
        let end = at + 1
        while (end < lines.length && !/^>/.test(masks[end]!)) end++
        result.push(convertUnquotedDefinitionLists(lines.slice(at, end).join('\n'), emptyTerm, depth))
        at = end
        continue
      }
      const nested: string[] = []
      let termColumn: number | undefined
      let endsBlock = false
      let end = at
      while (end < lines.length) {
        const prefix = /^>(?:[ \t]|$)/.exec(lines[end]!)
        if (!prefix || masks[end]![prefix[0].indexOf('>')] !== '>') {
          const text = lines[end]!.replace(/^[ \t]*/, ''), visible = masks[end]!.replace(/^[ \t]*/, '')
          const block = /^(?:#{1,6}(?:[ \t]|$)|>|:(?:[ \t]|$)|:{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|(?:[*-][ \t]*){3,}$)/.test(visible)
            || visible.startsWith('|') && text.endsWith('|')
            || /^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(text)
          if (termColumn === undefined || !text || block) { endsBlock = block; break }
          nested.push(lines[end]!)
          end++
          continue
        }
        const child = lines[end]!.slice(prefix[0].length), body = quoted(child)[1]
        const term = /^([ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)*):(?:[ \t]|$)/.exec(body)
        if (term) termColumn = term[1]!.length
        else if (!body.replace(/^[ \t]+|[ \t]+$/g, '') || termColumn !== undefined && leadingIndent(body)[0] <= termColumn && /^(?:#{1,6}(?:[ \t]|$)|>|:{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t])/.test(body.replace(/^[ \t]*/, ''))) termColumn = undefined
        nested.push(child)
        end++
      }
      result.push(convertDefinitionLists(nested.join('\n'), emptyTerm, depth + 1).split('\n').map(line => quote[1] + (line ? ' ' + line : '')).join('\n'))
      if (endsBlock) result.push('')
      at = end
    }
    return result.join('\n')
  }
  return convertUnquotedDefinitionLists(source, emptyTerm, depth)
}

function convertUnquotedDefinitionLists(source: string, emptyTerm: string, depth = 0): string {
  if (/^[ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)+:/m.test(source)) {
    const lines = source.split('\n'), mask = maskDjotCodeAndDestinations(source), masks = mask.split('\n')
    const boundaries = new Set(djotInlineBoundaries(source, mask, true)), result: string[] = []
    let offset = 0, start = 0
    for (let at = 0; at < lines.length; at++) {
      const line = lines[at]!, item = /^([ \t]*)(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+(?=(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)*:(?:[ \t]|$))/.exec(line)
      const sourceAt = offset
      offset += line.length + 1
      if (!item || masks[at]![item[0].length] !== line[item[0].length] || at !== 0 && !boundaries.has(sourceAt)) continue
      if (at > start) result.push(convertRootDefinitionLists(lines.slice(start, at).join('\n'), emptyTerm))
      const column = leadingIndent(item[0])[0] + item[0].replace(/^[ \t]*/, '').replaceAll('\t', ' ').length
      const nested = [line.slice(item[0].length)]
      let end = at + 1, blank = false
      while (end < lines.length) {
        const next = lines[end]!, indent = leadingIndent(next)[0], text = next.replace(/^[ \t]*/, '')
        if (text !== '' && indent < column && (blank || /^(?:[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|#{1,6}(?:[ \t]|$)|>|:{3,}|[`~]{3,}|\|)/.test(masks[end]!.replace(/^[ \t]*/, '')))) break
        nested.push(next.slice(charsThroughColumns(next, Math.min(column, indent))))
        blank = text === ''
        offset += next.length + 1
        end++
      }
      let converted = convertDefinitionLists(nested.join('\n'), emptyTerm, depth + 1).replace(/^\{loose\}\n/, '').split('\n')
      const removed = new Set<number>()
      for (let index = 0; index < converted.length; index++) {
        if (converted[index]!.replace(/^[ \t]+|[ \t]+$/g, '') !== '') continue
        let end = index
        while (end < converted.length && converted[end]!.replace(/^[ \t]+|[ \t]+$/g, '') === '') end++
        if (converted[end]?.replace(/^[ \t]*/, '').startsWith(':  ')) for (let blank = index; blank < end; blank++) removed.add(blank)
        index = end - 1
      }
      for (let index = 0; index < converted.length; index++) {
        if (converted[index] !== ':  ' + emptyTerm) continue
        let end = index + 1
        while (end < converted.length && converted[end]!.replace(/^[ \t]+|[ \t]+$/g, '') === '') end++
        if (end > index + 1 && end < converted.length && /^[^ \t]/.test(converted[end]!) && !converted[end]!.startsWith('::')) for (let blank = index + 1; blank < end; blank++) removed.add(blank)
      }
      if (removed.size) converted = converted.filter((_line, index) => !removed.has(index))
      result.push(item[0] + emptyTerm + '\n' + converted.map(value => ' '.repeat(column) + value).join('\n'))
      at = end - 1
      start = end
    }
    if (start < lines.length) result.push(convertRootDefinitionLists(lines.slice(start).join('\n'), emptyTerm))
    return result.join('\n')
  }
  return convertRootDefinitionLists(source, emptyTerm)
}

function convertRootDefinitionLists(source: string, emptyTerm: string): string {
  const lines = source.split('\n')
  const sourceMask = maskDjotCodeAndDestinations(source)
  const masked = sourceMask.split('\n')
  let boundaries: Set<number> | undefined
  let sourceOffset = 0
  type DefinitionContext = { source: number; target: number; body: boolean; ready: boolean; termEnd: number }
  const fenceStarts = new Set<number>()
  if (source.includes('```') || source.includes('~~~')) maskDjotFences(source, undefined, [], true, line => fenceStarts.add(line))
  const stack: DefinitionContext[] = []
  const finish = (context: DefinitionContext): void => {
    if (!context.body) lines[context.termEnd] += `\n${' '.repeat(context.target)}:  ${emptyTerm}`
  }
  const pop = (): void => { finish(stack.pop()!) }
  for (let i = 0; i < lines.length; i++) {
    const sourceAt = sourceOffset
    sourceOffset += lines[i]!.length + 1
    const fenceCandidate = /^([ \t]*):[ \t]+(`{3,}|~{3,})(.*)$/.exec(lines[i]!)
    const rawFence =
      fenceCandidate && !(fenceCandidate[2]![0] === '`' && fenceCandidate[3]!.includes('`')) ? fenceCandidate : null
    const term =
      /^([ \t]*):[ \t]+(\S.*)$/.exec(masked[i] ?? '') ??
      (masked[i]?.replace(/^[ \t]*/, '').startsWith(':') ? /^([ \t]*):(?:[ \t]+(.*)|$)/.exec(lines[i]!) : null)
    if (term) {
      const [indent] = leadingIndent(term[1]!)
      while (stack.length && indent < stack.at(-1)!.source) pop()
      const top = stack.at(-1)
      const mayStart = top !== undefined || i === 0 || lines[i - 1]!.replace(/^[ \t]+|[ \t]+$/g, '') === '' || /^ *:{3,}(?:[ \t]+[A-Za-z0-9_-]+)?[ \t]*$/.test(masked[i - 1] ?? '') || (boundaries ??= new Set(djotInlineBoundaries(source, sourceMask, true))).has(sourceAt)
      if (mayStart) {
        const authoredTerm = /^([ \t]*):(?:[ \t]+(.*)|$)/.exec(lines[i]!)
        let termText = authoredTerm?.[2] ?? term[2] ?? ''
        if (termText.replace(/^[ \t]+|[ \t]+$/g, '') === '' || termText.replace(/^[ \t]*/, '').startsWith('{') && /^(?:[ \t]|\{%%\})*$/.test(djotImageLabelAttributes(termText))) termText = emptyTerm
        const containerBody = /^:{3,}(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$/.test(termText)
        const startsDefinitionBody = rawFence || containerBody
        if (!top || indent === top.source) {
          const target = top?.target ?? indent
          if (!top) stack.push({ source: indent, target, body: false, ready: false, termEnd: i })
          else {
            finish(top)
            top.termEnd = i
            top.body = false
            top.ready = false
          }
          const prefix = ' '.repeat(target)
          lines[i] = `${top ? '' : `${prefix}{loose}\n`}${prefix}:: ${startsDefinitionBody ? emptyTerm : termText}`
          if (startsDefinitionBody) {
            lines[i] += `\n${prefix}:  ${termText}`
            stack.at(-1)!.body = true
            stack.at(-1)!.ready = true
          }
          continue
        }
        if (top.ready && indent > top.source) {
          const target = top.target + 3
          const lead = top.body ? ' '.repeat(target) : `${' '.repeat(top.target)}:  `
          top.body = true
          lines[i] = `${lead}{loose}\n${' '.repeat(target)}:: ${startsDefinitionBody ? emptyTerm : termText}`
          if (startsDefinitionBody) lines[i] += `\n${' '.repeat(target)}:  ${termText}`
          stack.push({ source: indent, target, body: !!startsDefinitionBody, ready: !!startsDefinitionBody, termEnd: i })
          continue
        }
      }
    }
    if (!stack.length) continue
    if (lines[i]!.replace(/^[ \t]+|[ \t]+$/g, '') === '') {
      const context = stack.at(-1)!
      if (!context.body && rejectedCommentStartsBlock(lines[i + 1]?.replace(/^[ \t]*/, '') ?? '')) {
        lines[i] = `${' '.repeat(context.target)}:  ${emptyTerm}\n`
        context.body = true
      }
      context.ready = true
      continue
    }
    if (!stack.at(-1)!.ready) {
      const continuation = lines[i]!.replace(/^[ \t]*/, '')
      const indent = leadingIndent(lines[i]!)[0]
      const visible = masked[i]?.[/^[ \t]*/.exec(lines[i]!)![0].length] === continuation[0] || fenceStarts.has(i)
      const marker = /^(?:#{1,6}(?:[ \t]|$)|>|:{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t])/.test(continuation) || /^(?:[*-][ \t]*){3,}$/.test(continuation) || fenceStarts.has(i)
      if (visible && indent <= stack.at(-1)!.source && marker) {
        while (stack.length && stack.at(-1)!.source >= indent) pop()
        if (!stack.length) continue
      } else {
        stack.at(-1)!.termEnd = i
        if (visible && marker && indent > stack.at(-1)!.source && /^(?:[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t])/.test(continuation)) {
          lines[i] = continuation.replace(/^([-*+])/, '\\$1').replace(/^([0-9A-Za-z]+)([.)])(?=[ \t])/, '$1\\$2').replace(/^\(/, '\\(')
          continue
        }
        if (!/^(?:[#>|{]|:{3,}|[`~]{3,}|[-*+] |(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)] )/.test(continuation)) lines[i] = visible ? (!marker ? continuation.replace(/^([ivxlcdmIVXLCDM]+)([.)])(?=[ \t])/, '$1\\$2') : continuation).replace(/^:(?=[ \t]|$)/, '\\:') : continuation
        continue
      }
    }
    const [indent] = leadingIndent(lines[i]!)
    while (stack.length && indent <= stack.at(-1)!.source) pop()
    const context = stack.at(-1)
    if (!context) continue
    const payload = lines[i]!.slice(charsThroughColumns(lines[i]!, context.source + 2))
    const extra = Math.max(0, indent - context.source - 2)
    lines[i] = context.body
      ? `${' '.repeat(context.target + 3 + extra)}${payload}`
      : `${' '.repeat(context.target)}:  ${' '.repeat(extra)}${payload}`
    context.body = true
  }
  while (stack.length) pop()
  return lines.join('\n')
}

function normalizeDjotDivOpeners(source: string): string {
  if (!source.includes(':::')) return source
  let mask: string | undefined, boundaries: Set<number> | undefined, offset = 0
  return source.split('\n').map(line => {
    const start = offset
    offset += line.length + 1
    const at = djotContentStart(line), prefix = line.slice(0, at)
    const opener = /^(:{3,})([ \t]*)([A-Za-z0-9_-]+)([ \t]*)(\r?)$/.exec(line.slice(at))
    if (!opener && /[\\{]/.test(line.slice(at)) && /^:{3,}[ \t]*(?:[A-Za-z0-9_-]|\\[_-])+/.test(line.slice(at))) {
      mask ??= maskDjotCodeAndDestinations(source)
      return mask[start + at] === ':' ? prefix + '\\' + line.slice(at) : line
    }
    if (!opener || opener[2] === ' ') return line
    mask ??= maskDjotCodeAndDestinations(source)
    boundaries ??= new Set(djotInlineBoundaries(source, mask, true))
    return mask[start + at] === ':' && boundaries.has(start)
      ? `${prefix}${opener[1]} ${opener[3]}${opener[4]}${opener[5]}` : line
  }).join('\n')
}

/** Rewrite Djot block spellings that Carve does not recognize. */

function convertDjotBlockMarkers(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const containers: { width: number; invalid: boolean }[] = []
  const nested: boolean[] = []
  const ancestors: { columns: number; marker: boolean }[] = []
  for (const line of masked) {
    if (line.trim() === '') {
      nested.push(false)
      continue
    }
    const [columns] = leadingIndent(line)
    while (ancestors.length && ancestors.at(-1)!.columns >= columns) ancestors.pop()
    nested.push(ancestors.at(-1)?.marker ?? false)
    const marker =
      !/^(?:([*-])[ \t]*){3,}$/.test(line.trim()) &&
      /^(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+\S/.test(line.trimStart())
    ancestors.push({ columns, marker })
  }
  for (let i = 0; i < lines.length; i++) {
    if ((masked[i] ?? '').trim() === '') continue
    const contentAt = /^[ \t]*/.exec(lines[i]!)![0].length
    if (masked[i]![contentAt] !== lines[i]![contentAt]) continue
    let view = lines[i]!
    const prefix =
      /^(?:[ \t]*> ?|[ \t]*(?:(?:[-*+]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-zA-Z])[.)]|\([0-9A-Za-z]+\)) +(?:\[[ xX]\] +)?|: |\[\^[^\]\r\n]+\]: +))/
    let host: RegExpExecArray | null
    while ((host = prefix.exec(view))) view = view.slice(host[0].length)
    view = view.replace(/^[ \t]+/, '')
    const containerOffset = lines[i]!.length - view.length
    // Carve numbers a list from a bare period; Djot reads the same line as text.
    if (/^\.(?=[ \t]|$|\{)/.test(view) && masked[i]![containerOffset] === '.') {
      lines[i] = lines[i]!.slice(0, containerOffset) + '\\' + view
      continue
    }
    const container =
      view.startsWith(':::') && masked[i]!.slice(containerOffset).startsWith(':::')
        ? [view, lines[i]!.slice(0, containerOffset), view]
        : null
    if (container) {
      const content = lines[i]!.slice(container[1]!.length)
      const width = colonFenceOpenerLen(content)
      const top = containers.at(-1)
      const close = /^:{3,}[ \t]*$/.test(content) && top?.width === width
      const invalid = close ? containers.pop()!.invalid : hasInvalidContainerMetadata(content)
      if (!close && width !== null) containers.push({ width, invalid })
      if (invalid) {
        lines[i] = lines[i]!.slice(0, container[1]!.length) + '\\' + lines[i]!.slice(container[1]!.length)
      }
    }
    const enclosed = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)\(((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,}))\)([ \t]+\S.*)$/.exec(masked[i]!)
    if (enclosed) {
      const authored = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)\(((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,}))\)([ \t]+\S.*)$/.exec(lines[i]!)
      if (authored)
        lines[i] = `${authored[1]}${enclosed[1] === '' && nested[i] ? authored[2] : ''}${authored[3]}.${authored[4]}`
      continue
    }
    const rule = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)([*-])(?:[ \t]*\3){2,}[ \t]*$/.exec(masked[i]!)
    if (!rule || !/^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)([*-])(?:[ \t]*\3){2,}[ \t]*$/.test(lines[i]!)) continue
    const quote = rule[1]!
    const indent = rule[2]!
    lines[i] = `${quote}${quote === '' && nested[i] ? indent : ''}***`
  }
  return lines.join('\n')
}

/** Keep a Djot loose list from becoming two Carve lists after 3+ blank lines. */
function collapseFalseListBoundaries(source: string): string {
  const lines = source.split('\n')
  const fenced = fencedLines(lines)
  const parts = lines.map(quoted)
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i] || parts[i]![1].trim() !== '') {
      result.push(lines[i]!)
      continue
    }
    const depth = parts[i]![0]
    let end = i
    while (
      end + 1 < lines.length &&
      !fenced[end + 1] &&
      parts[end + 1]![0] === depth &&
      parts[end + 1]![1].trim() === ''
    )
      end++
    const next = end + 1
    let above = i - 1
    while (above >= 0 && parts[above]![1].trim() === '') above--
    if (
      end - i + 1 >= 3 &&
      next < lines.length &&
      !fenced[next] &&
      parts[next]![0] === depth &&
      isMarkerLine(parts[next]![1]) &&
      above >= 0 &&
      parts[above]![0] === depth &&
      (isMarkerLine(parts[above]![1]) || /^[ \t]/.test(parts[above]![1]))
    ) {
      result.push(lines[i]!)
      i = end
      continue
    }
    for (let k = i; k <= end; k++) result.push(lines[k]!)
    i = end
  }
  return result.join('\n')
}

function carryDjotAttributesAcrossDivClosers(source: string): string {
  if (!source.includes('{') || !source.includes(':::')) return source
  const mask = maskDjotCodeAndDestinations(source, false)
  const closers = new Map<number, number[]>()
  const owners = new Map<number, { column: number | undefined; depth: number }>()
  djotInlineBoundaries(source, mask, true, closers, owners)
  if (closers.size === 0) return source
  const lines = source.split('\n'), removed = new Set<number>(), moved = new Map<number, string[]>(), residues = new Map<number, string>()
  let pending: Array<{ line: number; value: string }> = [], crossed = false
  let offset = 0, previous = '', previousDepth = 0
  let closedOwner: { column: number | undefined; depth: number } | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const physical = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/.exec(line)![0]
    const start = physical.length, content = line.slice(start)
    const depth = (physical.match(/>/g) ?? []).length
    const followsBlock = pending.length > 0 || previous === '' || /^(?:#{1,6} |:{3,}|[`~]{3,}|\[[^\]]+\]:|(?:[*-][ \t]*){3,}$)/.test(previous)
    const candidate = content[0] === '{' && (followsBlock || mask[offset + start] === '{') ? readAttributes(content, 0) : undefined
    if (followsBlock && depth === previousDepth && candidate?.source === '{}' && candidate.end === content.replace(/[ \t\r]+$/, '').length) { offset += line.length + 1; continue }
    const attrs = mask[offset + start] === '{' ? candidate : undefined
    const whole = attrs !== undefined && attrs.end === content.replace(/[ \t\r]+$/, '').length
    if (crossed && !closers.has(offset) && content.replace(/^[ \t\r]+|[ \t\r]+$/g, '') !== '' && (!whole || depth !== previousDepth)) {
      const indent = /^[ \t]*/.exec(line.slice(/^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0].length))![0].length
      const peerItem = closedOwner?.column !== undefined && depth === closedOwner.depth && indent < closedOwner.column && /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))(?:[ \t]+|$)/.test(line.slice(physical.length))
      if (!peerItem || /^(?:[-*][ \t]*){3,}$/.test(content)) {
        let prefix = physical
        if (depth > previousDepth) {
          const marker = Array.from(physical.matchAll(/>/g))[previousDepth]!.index!
          prefix = physical.slice(0, marker)
        }
        moved.set(index, pending.map(attr => { removed.add(attr.line); return prefix + attr.value }))
      }
      pending = []
      crossed = false
    }
    if (whole && followsBlock) {
      if (!crossed && depth > previousDepth) pending = []
      pending.push({ line: index, value: content.replace(/[ \t\r]+$/, '') })
      if (depth > previousDepth) residues.set(index, physical.trimEnd())
    } else if (closers.has(offset)) {
      crossed ||= pending.length > 0
      closedOwner = owners.get(offset)
    } else if (content.replace(/^[ \t\r]+|[ \t\r]+$/g, '') !== '') {
      pending = []
    }
    if (!whole) previous = content.replace(/^[ \t\r]+|[ \t\r]+$/g, '')
    previousDepth = content.replace(/^[ \t\r]+|[ \t\r]+$/g, '') === '' ? Math.min(previousDepth, depth) : depth
    offset += line.length + 1
  }
  if (crossed) {
    for (const attr of pending) removed.add(attr.line)
  }
  if (removed.size === 0) return source
  const out: string[] = []
  for (let index = 0; index <= lines.length; index++) {
    for (const attr of moved.get(index) ?? []) out.push(attr)
    if (index < lines.length) {
      if (!removed.has(index)) out.push(lines[index]!)
      else if (residues.has(index)) out.push(residues.get(index)!)
    }
  }
  return out.join('\n')
}

function consumeOrphanDjotAttributes(source: string): { source: string; restore: (text: string, transform?: (chunk: string) => string) => string } {
  if (!source.includes('{')) return { source, restore: (text, transform = chunk => chunk) => transform(text) }
  const masked = maskDjotCodeAndDestinations(source).replace(/\[\^[^\]\n]*\]/g, (value, at: number) => isDjotEscaped(source, at) ? value : ' '.repeat(value.length)).replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g, value => ' '.repeat(value.length)).split('\n')
  const item = String.raw`(?:[.#][A-Za-z0-9_:-]+|[A-Za-z][A-Za-z0-9_-]*=(?:"(?:\\.|[^"\\\n])*"|[A-Za-z0-9_:-]+))`
  const pattern = new RegExp(String.raw`\{[ \t]*${item}(?:[ \t]+${item})*[ \t]*\}`, 'g')
  const lines = source.split('\n')
  const tableRows = source.includes('|') ? djotTableRows(source, masked.join('\n')) : []
  const dangling = new Set<number>()
  const wholeAttribute = new RegExp(`^(?:${pattern.source})$`)
  let followsBlank = true, nextDepth: number | undefined
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!
    const first = /^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/.exec(line)![0].length
    const depth = (line.slice(0, first).match(/>/g) ?? []).length
    if (line.slice(first).trim() === '') {
      if (depth !== 0 && followsBlank) nextDepth = depth
      continue
    }
    if (masked[index]![first] === '{' && wholeAttribute.test(line.slice(first).trimEnd())) {
      if (nextDepth !== undefined && depth !== nextDepth) followsBlank = false
      if (followsBlank) dangling.add(index)
      nextDepth = depth
    } else { followsBlank = false; nextDepth = undefined }
  }
  const prefix = djotPlaceholderPrefix(source, '\x00DJOTORPHAN\x00')
  const spaces: string[] = []
  const nextBlock = new Int32Array(lines.length).fill(-1)
  const moved = new Map<number, string[]>()
  const blockAttributes = new Uint8Array(lines.length)
  const quoteScopeChanges = new Uint8Array(lines.length)
  const targetPrefixes: string[] = []
  let previousDepth = 0, previousNonblankDepth = 0
  const blockOwners: Array<{ start: number; depth: number }> = []
  for (let index = 0; index < lines.length; index++) {
    const prefix = /^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/.exec(lines[index]!)![0]
    const body = lines[index]!.slice(prefix.length).trimEnd()
    const depth = (prefix.match(/>/g) ?? []).length
    if (body.trim() === '' && depth <= previousDepth) { previousDepth = Math.min(previousDepth, depth); continue }
    const opens = depth > previousDepth
    quoteScopeChanges[index] = Number(opens || depth !== previousNonblankDepth)
    previousNonblankDepth = depth
    let marker = -1
    if (opens) for (let count = 0; count <= previousDepth; count++) marker = prefix.indexOf('>', marker + 1)
    targetPrefixes[index] = opens ? prefix.slice(0, marker) : prefix
    previousDepth = depth
    const previousLine = lines[index - 1] ?? ''
    const previous = previousLine.replace(/^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/, '').trim()
    const blockOwner = blockOwners.at(-1)
    const ownerOutdent = blockOwner !== undefined && (depth < blockOwner.depth || depth === blockOwner.depth && prefix.length < blockOwner.start)
    const canOpenOwner = index === 0 || previous === '' || ownerOutdent || blockAttributes[index - 1] === 1
    const rowEnd = lines[index]!.trimEnd().length - 1
    const exitsAtRow = ownerOutdent && body.startsWith('|') && rowEnd > prefix.length && masked[index]![prefix.length] === '|' && masked[index]![rowEnd] === '|' && lines[index]![rowEnd - 1] !== '\\'
    const closesOwner = exitsAtRow || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[-*][ \t]*){3,}$)/.test(body) && masked[index]![prefix.length] !== ' ' || tableRows[index] || /^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(body)
    if (previous === '' || wholeAttribute.test(body) || closesOwner || ownerOutdent && tableRows[index - 1]) {
      while (blockOwners.at(-1) && (depth < blockOwners.at(-1)!.depth || depth === blockOwners.at(-1)!.depth && prefix.length < blockOwners.at(-1)!.start)) blockOwners.pop()
    }
    const contentStart = djotContentStart(lines[index]!)
    const ownerPrefix = lines[index]!.slice(0, contentStart)
    const ownerNote = ownerPrefix.indexOf('[^')
    const ownerMarker = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.exec(ownerNote < 0 ? ownerPrefix : ownerPrefix.slice(0, ownerNote))
    if (canOpenOwner && ownerMarker && masked[index]![ownerMarker.index] !== ' ' && (blockOwners.at(-1)?.start !== ownerMarker.index + 1 || blockOwners.at(-1)?.depth !== depth)) blockOwners.push({ start: ownerMarker.index + 1, depth })
    if (masked[index]![prefix.length] !== '{' || !wholeAttribute.test(body)) continue
    const previousStart = djotContentStart(previousLine)
    const noteAt = previousLine.slice(0, previousStart).indexOf('[^')
    const ownerStart = noteAt < 0 ? previousStart : noteAt + 1
    const previousQuotes = /^(?:(?:[ \t]*>)+[ \t]*)?/.exec(previousLine)![0]
    const outdented = depth < (previousQuotes.match(/>/g) ?? []).length || prefix.length < ownerStart && (noteAt >= 0 || /(?:[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(previousLine.slice(0, previousStart)))
    blockAttributes[index] = Number(index === 0 || previous === '' || outdented || ownerOutdent || blockAttributes[index - 1] === 1 ||
      /^(?:`{3,}|~{3,}|:{3,}|#{1,6} |:{1,2} |(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|\|.*\||\[(?!\^)[^\]]+\]:|\[\^[^\]]+\]:[ \t]*$)/.test(previous))
  }
  let following = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    nextBlock[index] = following
    const first = /^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/.exec(lines[index]!)![0].length
    const body = lines[index]!.slice(first).trimEnd()
    if (quoteScopeChanges[index] || body.trim() !== '' && !(masked[index]![first] === '{' && wholeAttribute.test(body))) following = index
  }
  const converted = lines.map((line, index) => {
    const first = /^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/.exec(line)![0].length
    const last = line.trimEnd().length
    const strippedLine = line.replace(pattern, '')
    const markerOnly = /^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*(?:[-*+]|[0-9]+[.)]|#{1,6}|:{1,2}|\[\^[^\]]+\]:)[ \t]+(?:\[[ xX-]\][ \t]+)?$/.test(strippedLine)
    let orphanEnd = -1, dropLine = false
    const written = line.replace(pattern, (attrs: string, at: number) => {
      let before = at
      while (line[before - 1] === '\\') before--
      if (masked[index]![at] !== '{' || (at - before) % 2 !== 0) return attrs
      if (at !== orphanEnd && /[\]*_}^~]/.test(line[at - 1] ?? '') || (at > 0 && masked[index]![at - 1] === ' ' && line[at - 1] !== ' ')) return attrs
      if (markerOnly) return attrs
      const alone = at === first && at + attrs.length === last
      const block = blockAttributes[index] === 1
      if (alone && block) {
        if (!dangling.has(index)) {
          const target = nextBlock[index]!
          if (target >= 0) {
            const targetPrefix = targetPrefixes[target]!
            if ((line.slice(0, first).match(/>/g) ?? []).length > (targetPrefix.match(/>/g) ?? []).length) {
              const parts = moved.get(target) ?? []
              if (targetPrefixes[index] === line.slice(0, first)) {
                for (const pending of moved.get(index) ?? []) parts.push(pending)
                moved.delete(index)
              }
              parts.push(attrs)
              moved.set(target, parts)
              dropLine = true
              return ''
            }
          }
          return attrs
        }
        dropLine = true
        if (targetPrefixes[index] === line.slice(0, first)) moved.delete(index)
      }
      orphanEnd = at + attrs.length
      return prefix + (at === first ? 'L' : 'I')
    }).replace(new RegExp(`${prefix}([LI])([ \t]*)`, 'g'), (_all, kind: string, space: string) => {
      spaces.push(kind === 'I' ? space : space === '' ? '{%%}' : `!\`${space}\``)
      return `${prefix}${spaces.length - 1}\x00`
    })
    const retained = dropLine ? (line.slice(0, first).includes('>') ? line.slice(0, first).trimEnd() : undefined) : written
    const pending = moved.get(index)?.map(attrs => targetPrefixes[index] + attrs)
    return pending ? [...pending, retained ?? ''].join('\n') : retained
  })
    .filter((line) => line !== undefined)
    .join('\n')
  return {
    source: converted,
    restore: (text, transform = chunk => chunk) => {
      const chunks: string[] = []
      let end = 0
      for (const match of text.matchAll(new RegExp(`${prefix}(\\d+)\x00`, 'g'))) {
        chunks.push(transform(text.slice(end, match.index)), spaces[Number(match[1])] ?? match[0])
        end = match.index! + match[0].length
      }
      chunks.push(transform(text.slice(end)))
      return chunks.join('')
    },
  }
}

function removeInheritedAttributeMarkers(source: string, inherited: ReadonlySet<string>): string {
  return source.replace(/\0DJOTINVALIDATTR\x00\d+\0/g, value => inherited.has(value) ? '' : value)
}

function protectRejectedCommentQuotes(source: string): string {
  if (!source.includes('{%') || !source.includes('>')) return source
  const edits = new Map<number, string>()
  const mask = maskDjotCodeAndDestinations(source)
  for (const match of source.matchAll(/\{%/g)) {
    const at = match.index!
    if (mask[at] !== '{' || readAttributes(source, at)) continue
    const context = attributeContext(source, at)
    if (!context.depth || context.indent === undefined || continuesParagraph(source, at)) continue
    const firstEnd = source.indexOf('\n', at)
    if (firstEnd < 0 || !readAttributes(source.slice(at, firstEnd) + '}', 0)) continue
    const linePrefix = source.slice(source.lastIndexOf('\n', at - 1) + 1, at)
    const enclosing = /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))[.)]|\((?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))\))[ \t]+(?=>)/.exec(linePrefix)
    const openingQuote = /^(?:[ \t]*>(?:[ \t]|$))+/.exec(enclosing ? linePrefix.slice(enclosing[0].length) : linePrefix)?.[0]
    let line = firstEnd
    while (line >= 0) {
      const quote = /^(?:[ \t]*>(?:[ \t]|$))+/.exec(source.slice(line + 1))?.[0]
      const bodyAt = line + 1 + (quote?.length ?? 0)
      const end = source.indexOf('\n', bodyAt)
      const body = source.slice(bodyAt, end < 0 ? source.length : end)
      if (enclosing && quote && quote.length - quote.trimStart().length < enclosing[0].length) {
        if (quote.length - quote.trimStart().length > enclosing[0].length - enclosing[0].trimStart().length && quote.trimStart() === openingQuote?.trimStart() && (quote.match(/>/g)?.length ?? 0) === context.depth)
          edits.set(line + 1 + quote.length, quote.trim().replace(/>/g, '\\>') + ' ')
        break
      }
      if (quote && (quote.match(/>/g)?.length ?? 0) < context.depth) { edits.set(line + 1, quote.trimEnd() + '\n'); break }
      if (!quote || quote.trimStart() !== openingQuote?.trimStart() || (quote.match(/>/g)?.length ?? 0) !== context.depth) break
      if (!body.trim()) break
      const indent = /^[ \t]*/.exec(body)![0].length
      if (indent < context.minimum) {
        if (quote.length - quote.trimStart().length >= (openingQuote ? openingQuote.length - openingQuote.trimStart().length : 0) + context.minimum)
          edits.set(bodyAt, quote.trim().replace(/>/g, '\\>') + ' ')
        break
      }
      if (indent <= context.indent) {
        edits.set(bodyAt, quote.trim().replace(/>/g, '\\>') + ' ')
        break
      }
      if (/[}%]/.test(body)) break
      line = end
    }
  }
  let output = '', cursor = 0
  for (const [at, text] of [...edits].sort((a, b) => a[0] - b[0])) { output += source.slice(cursor, at) + text; cursor = at }
  return output + source.slice(cursor)
}

function escapeInvalidDjotAttributes(source: string): { source: string; inherited: Set<string>; restore: (text: string) => string } {
  source = protectRejectedCommentQuotes(source)
  const masked = maskDjotCodeAndDestinations(source).replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g, value => ' '.repeat(value.length))
  const escapes: number[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || masked[i] !== '{') continue
    let slashes = 0
    for (let before = i - 1; before >= 0 && source[before] === '\\'; before--) slashes++
    if (slashes % 2) continue
    const attrs = readAttributes(source, i)
    if (attrs) { i = attrs.end - 1; continue }
    if (/[.#% \tA-Za-z]/.test(source[i + 1] ?? '')) {
      escapes.push(i)
      // Every brace inside the same rejected run is literal Djot text too, so a later
      // pass must not read one as a forced quote and swallow it.
      for (let inner = i + 1; inner < source.length && source[inner] !== '\n' && source[inner] !== '}'; inner++)
        if (source[inner] === '{' && masked[inner] === '{' && !readAttributes(source, inner)) escapes.push(inner)
      if (source[i + 1] === '%' && continuesParagraph(source, i)) {
        for (let inner = Math.max(i + 2, escapes.at(-1)! + 1); inner < source.length && source[inner] !== '%' && source[inner] !== '}'; inner++) {
          if (source[inner] === '\n') {
            const nextEnd = source.indexOf('\n', inner + 1)
            const nextLine = source.slice(inner + 1, nextEnd < 0 ? source.length : nextEnd)
            if (!nextLine.slice(djotStructuralPrefixEnd(nextLine)).trim()) break
          }
          if (source[inner] === '{' && masked[inner] === '{') escapes.push(inner)
        }
      }
      i = escapes.at(-1)!
      continue
    }

  }
  const reserved = new Set([...source.matchAll(/\0DJOTINVALIDATTR\x00\d+\0/g)].map(match => match[0]))
  const inherited = new Set<string>()
  let serial = 0
  const marker = (): string => {
    let value: string
    do { value = `\0DJOTINVALIDATTR\x00${serial++}\0` } while (reserved.has(value))
    inherited.add(value)
    return value
  }
  let output = '', cursor = 0
  for (const at of escapes) {
    output += source.slice(cursor, at) + '\\{' + marker() + (source[at + 1] === '#' ? '\\#' + marker() : '')
    cursor = at + (source[at + 1] === '#' ? 2 : 1)
  }
  return { source: output + source.slice(cursor), inherited, restore: text => removeInheritedAttributeMarkers(text, inherited) }
}

/**
 * Make an angle run that only LOOKS like an autolink visible to the plain-text
 * escape again.
 *
 * An autolink body is opaque, so `<a--@b.c>` keeps its bare `@` and its link.
 * A body holding a LIFTED construct is not an autolink body at all - the reader
 * takes the comment out before it ever looks for an autolink - so
 * `<mailto:a{%%}@b.c>` is plain text whose `@` would open a mention and lose the
 * address (carve-php#3037, carve-js#2680). A lifted construct is a NUL-delimited
 * placeholder and Carve source carries no NUL of its own, so the byte is the
 * whole test.
 */

function foldHeadingContinuations(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const block =
    /^(?:[#>|{]|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|:[ \t]|:{2,}|\([0-9a-zA-Z]+\)[ \t]|[`~]{3,}|\^[ \t]|\[[^\]\n]*\]:|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$)/
  const container = /([ \t]*)(>(?:[ \t]|$)|\[\^[^\]\n]+\]:[ \t]*|[-*+][ \t]+|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]+|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]+)/y
  const task = /\[[ xX]\][ \t]+/y
  const quotePrefix = /^(?:[ \t]*>(?:[ \t]|$))*/
  const trimRight = (text: string): string => trimEndMatchingEdges(text, code => code === 32 || code === 9)
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes('#')) { result.push(line); continue }
    let at = 0, depth = 0, column = 0
    while (true) {
      container.lastIndex = at
      const token = container.exec(line)
      if (!token) break
      at = container.lastIndex
      if (token[2]!.startsWith('>')) { depth++; column = 0 }
      else if (token[2]!.startsWith('[^')) column = token[1]!.length + 2
      else {
        column += token[0].length
        if (/^[-*+]/.test(token[2]!)) {
          task.lastIndex = at
          if (task.exec(line)) at = task.lastIndex
        }
      }
    }
    const heading = /^([ \t]*)(#{1,6})(?:[ \t]+\S|[ \t]*$)/.exec(line.slice(at))
    if (!heading || masked[i]![at + heading[1]!.length] !== '#') {
      result.push(line)
      continue
    }
    const quoteHeading = depth > 0 && column === 0
    const firstLine = quoteHeading ? line.slice(0, at) + line.slice(at + heading[1]!.length) : line
    if (!quoteHeading) column += heading[1]!.length
    const marker = new RegExp(`^${heading[2]}[ \\t]+`)
    const parts = [trimRight(firstLine)]
    let tail = line
    while (i + 1 < lines.length) {
      let slashes = 0
      for (let end = tail.length - 1; end >= 0 && tail.charCodeAt(end) === 92; end--) slashes++
      if (slashes % 2) break
      const candidate = lines[i + 1]!
      const prefix = quotePrefix.exec(candidate)![0]
      if ((prefix.match(/>/g)?.length ?? 0) !== depth) break
      const remainder = candidate.slice(prefix.length)
      const indent = /^[ \t]*/.exec(remainder)![0].length
      if (indent < column) break
      const next = remainder.slice(indent)
      if (rejectedCommentStartsBlock(next)) break
      let part: string
      if (marker.test(next)) {
        part = next.replace(marker, '')
        if (!trimNonNbsp(part)) break
      } else {
        if (!trimNonNbsp(next) || block.test(next)) break
        part = next
      }
      parts.push(trimRight(part))
      tail = part
      i++
    }
    result.push(parts.length === 1 ? firstLine : parts.join(' '))
  }
  return result.join('\n')
}

function djotImageLabelText(normalizedLabel: string, convert: (source: string) => string, preserveSourceNuls = false): string {
  const whitespace: string[] = [], reserved = new Set<string>()
  for (const match of normalizedLabel.replace(/[^A-Za-z0-9]/g, '').matchAll(/DJOTALTSCALAR([0-9]+)Z/g)) reserved.add(match[1]!)
  let serial = 0
  while (reserved.has(String(serial))) serial++
  const whitespacePrefix = `DJOTALTSCALAR${serial}Z`
  const scalar = (value: string): string => { whitespace.push(value); return `${whitespacePrefix}${whitespace.length - 1}Z` }
  const codeMask = maskDjotOpaque(normalizedLabel, false, { code: false, rawCode: false })
  const codeEnds = backtickRunEnds(codeMask)
  const codeChunks: string[] = []
  const rawFormats = new Map(Array.from(normalizedLabel.matchAll(/\{=[^\s{}`]+\}/g), match => [match.index!, match.index! + match[0].length]))
  let codeCopied = 0
  if (codeEnds) for (let at = 0; at < codeMask.length; at++) {
    if (codeMask[at] !== '`' || isDjotEscaped(normalizedLabel, at)) continue
    let width = 1
    while (codeMask[at + width] === '`') width++
    const end = codeEnds[at]!
    if (end < 0) { at += width - 1; continue }
    let value = normalizedLabel.slice(at + width, end - width)
    const raw = rawFormats.get(end)
    if (raw) value = value.replace(/^ `/, '`').replace(/` $(?![\s\S])/, '`')
    else if (value.startsWith(' ') && value.endsWith(' ') && /[^ \t\n\r]/.test(value)) value = value.slice(1, -1)
    codeChunks.push(normalizedLabel.slice(codeCopied, at), '`' + scalar(value) + '`')
    codeCopied = raw ?? end
    at = codeCopied - 1
  }
  const codeProtected = codeCopied ? codeChunks.join('') + normalizedLabel.slice(codeCopied) : normalizedLabel
  const altMask = maskDjotCodeAndDestinations(codeProtected)
  const blockProtected = codeProtected.replace(/(\n[ \t]*)(#{1,6}(?=[ \t]|$)|>(?=[ \t]|$)|(?:[-*][ \t]*){3,}(?=\n|$)|[-*+](?=[ \t]|$)|:{1,}(?=[ \t]|$)|\||\^(?=[ \t]|$)|%%|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)](?=[ \t]|$))/gm, (all, prefix: string, marker: string, at: number) => altMask[at + prefix.length] === marker[0] ? prefix + scalar(marker) : all)
  let protectedLabel = blockProtected.replace(/^[ \t\u000b\u000c\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/gm, value => /^[ \t]*$/.test(value) ? value : scalar(value))
  // Reference keys retain NUL identity even though image text renders it as U+FFFD.
  if (preserveSourceNuls) protectedLabel = protectedLabel.replaceAll('\0U\0', () => scalar('\0U\0'))
  const converted = convert(`DJOTALT ${protectedLabel} DJOTEND`)
  const native = converted.replaceAll('\0U\0', '\0')
  const altDocument = parse(native)
  return renderDjotImageChildText(altDocument, normalizedLabel.includes('\n'))
    .replace(/ ?DJOTEND\n?$/, '')
    .replace(/^DJOTALT ?/, '')
    .replace(new RegExp(`${whitespacePrefix}(\\d+)Z`, 'g'), (all, index: string) => whitespace[Number(index)] ?? all)
}

function imageQuoteLayout(source: string, omitQuoteDelimiters: boolean): string {
  if (!omitQuoteDelimiters && source.includes('![') && /\{"|\{'|"\}|'\}/.test(source)) {
    source = replaceDjotImageLabels(source, maskDjotCodeAndDestinations(source), (image, label, _at, completeTarget) => {
      if (completeTarget || label.includes('![') || !/\{"|\{'|"\}|'\}/.test(label)) return image
      const comments = new Map<number, number>()
      maskDjotCodeAndDestinations(label, true, true, true, undefined, [], {
        onComment: (start, end) => comments.set(start, end),
      })
      for (const [start, end] of [...comments].reverse()) {
        const attrs = readAttributes(label, start)
        if (attrs && attrs.source !== '{}') continue
        label = label.slice(0, start) + '{%%}' + label.slice(attrs?.end ?? end)
      }
      const mask = maskDjotCodeAndDestinations(label).split('')
      for (let i = 0; i < label.length; i++) {
        if (mask[i] !== '{' || isDjotEscaped(label, i)) continue
        const attrs = readAttributes(label, i)
        if (!attrs) continue
        if (attrs.source !== '{}') for (let at = i; at < attrs.end; at++) if (mask[at] !== '\n') mask[at] = ' '
        i = attrs.end - 1
      }
      const quotes: Record<string, string> = { "{'": '‘', "'}": '’', '{"': '“', '"}': '”' }
      const text = label.replace(/\{["']|["']\}|\{\}/g, (token: string, at: number) => {
        if (mask[at] !== label[at] || isDjotEscaped(label, at)) return token
        if (token === '{}') return label[at - 1] === ']' ? token : '{%%}'
        return quotes[token]!
      })
      return '![' + text + ']'
    }, true)
  }
  const imageQuotes = new Set<number>()
  if (!omitQuoteDelimiters && source.includes('![') && /\{"|\{'|"\}|'\}/.test(source)) {
    const mask = maskDjotCodeAndDestinations(source)
    const imageLines = djotImageLineOwners(source, mask)
    let line = 0
    replaceDjotImageLabels(source, mask, (image, label, at) => {
      if (label.startsWith('^') || /\n[ \t]*\n/.test(label)) return image
      while (imageLines[line]!.end <= at) line++
      const owner = imageLines[line]!
      if (!djotImageAltLayout(label, owner.quotes, owner.itemColumn, owner.itemQuote, owner.div).valid) return image
      for (let i = 0; i < label.length; i++) if (label[i] === '"' || label[i] === "'") {
        imageQuotes.add(at + 2 + i)
        imageQuotes.add(at + 1 + i)
      }
      return image
    })
  }
  return djotInlineLayout(source, at => omitQuoteDelimiters || imageQuotes.has(at))
}

function collapseLiteralNestedImages(source: string): string {
  if (!source.includes('![![')) return source
  const mask = maskDjotCodeAndDestinations(source)
  const chunks: string[] = []
  let copied = 0
  for (let at = 0; at < source.length;) {
    if (source.slice(at, at + 2) !== '![' || mask[at] !== '!' || at > 0 && isDjotEscaped(source, at)) { at++; continue }
    const start = at
    while (source.slice(at, at + 2) === '![' && mask[at] === '!') at += 2
    const depth = (at - start) / 2
    if (depth < 2) continue
    const labelStart = at
    while (at < source.length) {
      const ch = source[at]!
      if (ch === '\\') {
        if (at + 1 >= source.length || source[at + 1] === '\n' || source[at + 1] === '\r') break
        at += 2
      } else if (ch === '[' || ch === ']' || ch === '\n' || ch === '\r') break
      else at++
    }
    if (at === labelStart) continue
    const label = source.slice(labelStart, at)
    if (label.includes('`')) continue
    let outerTarget = ''
    let valid = true
    for (let level = 0; level < depth; level++) {
      if (source.slice(at, at + 2) !== '](') { valid = false; break }
      at += 2
      const targetStart = at
      while (at < source.length && !/[\s()\[\]<>]/.test(source[at]!)) at++
      if (at === targetStart || source[at] !== ')') { valid = false; break }
      if (level === depth - 1) outerTarget = source.slice(targetStart, at)
      at++
    }
    if (!valid) continue
    chunks.push(source.slice(copied, start), `![${label}](${outerTarget})`)
    copied = at
  }
  if (!chunks.length) return source
  chunks.push(source.slice(copied))
  return chunks.join('')
}

/** Convert a Djot document to Carve source. */
export function djotToCarve(djot: string): string {
  resetParagraphContext()
  try { return convertDjotInput(djot) } finally { resetParagraphContext() }
}

function convertDjotInput(djot: string, preserveReferenceBreaks = false, omitQuoteDelimiters = false, nulShielded = false, skipHeadingTargets = false): string {
  djot = collapseLiteralNestedImages(djot)
  if (nulShielded || !djot.includes('\0')) return convertDjotDocument(djot, preserveReferenceBreaks, omitQuoteDelimiters, skipHeadingTargets)
  const token = '\0U\0'
  return convertDjotDocument(djot.replaceAll('\0', token), preserveReferenceBreaks, omitQuoteDelimiters, skipHeadingTargets).replaceAll(token, '\0')
}

function convertDjotDocument(djot: string, preserveReferenceBreaks = false, omitQuoteDelimiters = false, skipHeadingTargets = false): string {
  const strippedDefinitions = stripDjotFootnoteDefinitionAttributes(djot)
  const normalized = strippedDefinitions.source
  const [frontmatter, separator, sourceBody] = splitSiteFrontmatter(normalized)
  let body = escapeDjotTableAttributeBoundaries(normalizeDjotDivOpeners(sourceBody))
  const hasSourceNuls = body.includes('\0U\0')
  const headingCandidate = !skipHeadingTargets && hasSourceNuls && !/(?:^|\n)[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\[\^[^\]\n]+\]:/.test(body) && body.includes('][') && /(?:^|\n)[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?#{1,6}[ \t]/.test(body)
  const actualHeadingTargets = headingCandidate ? importedDjotHeadingTargets(convertDjotDocument(djot, preserveReferenceBreaks, omitQuoteDelimiters, true)) : undefined
  if (((body.includes('`') || body.includes('\0')) && body.split('\n').some(line => /^\[(?!\^)[^\]\n]*[`\0][^\]\n]*\]:/.test(line.slice(djotContentStart(line))) || hasSourceNuls && /^\[(?!\^)[^\]\n]*�[^\]\n]*\]:/.test(line.slice(djotContentStart(line))))) || headingCandidate)
  {
    const accepted = hasSourceNuls ? new Map<number, { label: string; target: string; end: number }>() : undefined
    if (accepted) foldDjotReferences(body, accepted)
    body = djotReferenceLayout(body, djotContentStart, false, accepted, false, true, actualHeadingTargets)
  }
  if (body.includes('[^') && body.includes(']:') && body.split('\n').some(line => /^\[\^[^\]\n]*\]:/.test(line.slice(djotContentStart(line))))) {
    const accepted = new Map<number, { label: string; target: string; end: number }>()
    foldDjotReferences(body, accepted)
    body = djotReferenceLayout(body, djotContentStart, true, accepted)
  }

  const convert = (text: string, transform?: (chunk: string) => string): string => {
    const emptyTerm = djotPlaceholderPrefix(text, '\x00DJOTEMPTYTERM\x00')
    const attrs = consumeOrphanDjotAttributes(convertDjotBlockMarkers(convertDefinitionLists(text, emptyTerm)))
    return attrs
      .restore(
        collapseFalseListBoundaries(
          djotEmphasis(attrs.source, (plain) => applyMigrationFixes(escapePlainDjotText(plain), true).output, undefined, omitQuoteDelimiters),
        ).replaceAll(emptyTerm, '%%'),
        transform,
      )
  }
  if (body.includes('![') && body.includes('][]') && body.includes('{') && body.includes('\n')) {
    const mask = maskDjotCodeAndDestinations(body)
    const owners = djotImageLineOwners(body, mask)
    let line = 0
    body = replaceDjotImageLabels(body, mask, (image, label, at) => {
      if (body.slice(at + image.length, at + image.length + 2) !== '[]' || !label.includes('{') || !label.includes('\n')) return image
      while (owners[line]!.end <= at) line++
      const owner = owners[line]!
      const layout = djotImageAltLayout(label, owner.quotes, owner.itemColumn, owner.itemQuote, owner.div)
      if (!layout.valid) return image
      let continuation = 0
      const normalized = djotImageLabelAttributes(layout.normalized, true)
        .replace(/\n/g, () => '\n' + (layout.continuations[continuation++] ?? ''))
      return '![' + normalized + ']'
    })
  }
  const spans: string[] = []
  const prefix = djotPlaceholderPrefix(body, '\x00DJOTSTRONG')
  const invalidAttributes = escapeInvalidDjotAttributes(carryDjotAttributesAcrossQuoteExits(carryDjotAttributesAcrossDivClosers(body)))
  const childTextCache = new Map<string, string>()
  const imageChildText = (label: string, omitQuotes = true, preserveSourceNuls = false): string => {
    preserveSourceNuls &&= label.includes('\0')
    const key = `${omitQuotes ? 1 : 0}:${preserveSourceNuls ? 1 : 0}:${label}`
    const cached = childTextCache.get(key)
    if (cached !== undefined) return cached
    const text = djotImageLabelText(djotImageEmptyDestinations(djotImageLabelAttributes(label)), source => invalidAttributes.restore(convertDjotInput(source, true, omitQuotes, true, true)), preserveSourceNuls)
    childTextCache.set(key, text)
    return text
  }
  // Carve has no empty footnote body: `[^b]:` alone is a paragraph, not a
  // definition, so an empty Djot body needs a body that renders nothing - a
  // comment. It travels as a NUL token so the text escaper cannot reach it and
  // turn the comment into a literal `%%%%` the reader was never shown.
  const emptyNote = djotPlaceholderPrefix(body, '\x00DJOTEMPTYNOTE\x00')
  const noteSourceWidths = new Map<string, number>()
  const normalizedBody = normalizeDjotFootnotes(
    djotReferenceLayout(
      djotCodePadding(normalizeDjotFences(foldDjotReferences(
        definitionTermBlockBoundaries(normalizeDjotAttributeLines(imageQuoteLayout(normalizeDjotAttributeLines(invalidAttributes.source), omitQuoteDelimiters))),
      ))),
      djotContentStart, false, undefined, preserveReferenceBreaks,
    ),
    strippedDefinitions.isBoundary,
    invalidAttributes.inherited,
    emptyNote,
    noteSourceWidths,
  )
  const links = normalizeDjotTablePipes(normalizeDjotAutolinks(normalizeDjotLinks(normalizedBody, invalidAttributes.inherited)))
  const itemAttributePrefix = djotPlaceholderPrefix(links, '\x00DJOTITEMATTR\x00')
  const itemAttributeValues: string[] = []
  const holdItemAttributes = (attributes: string, block = false): string => {
    itemAttributeValues.push(attributes)
    return `${itemAttributePrefix}${block ? 'B' : ''}${itemAttributeValues.length - 1}\x00`
  }
  const layout = djotBlockLayout(links, djotTableRows(links, maskDjotCodeAndDestinations(links, false, true, false)), strippedDefinitions.isBoundary, noteSourceWidths, emptyNote, holdItemAttributes)
  const headingFolded = foldHeadingContinuations(dropLeadingDjotSeparators(escapeDjotNonTableRows(layout)))
  let collapsedMask = maskDjotCodeAndDestinations(headingFolded, false).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value)

  const collapsedChars = collapsedMask.split('')
  for (let at = 0; at < headingFolded.length; at++) {
    if (collapsedChars[at] !== '{') continue
    const attrs = readAttributes(headingFolded, at)
    if (!attrs) continue
    for (let i = at; i < attrs.end; i++) if (collapsedChars[i] !== '\n') collapsedChars[i] = ' '
    at = attrs.end - 1
  }
  collapsedMask = collapsedChars.join('')
  const previousDefinitionLines = new Map<number, string>()
  let definitionOffset = 0, previousDefinitionLine = ''
  for (const line of headingFolded.split('\n')) { previousDefinitionLines.set(definitionOffset, previousDefinitionLine); definitionOffset += line.length + 1; previousDefinitionLine = line }
  const definitions = new Map(Array.from(headingFolded.matchAll(/^[ \t]*(?:>[ ]?)*(?:(?:[-*+]|[0-9]+[.)])[ \t]+)?\[([^\[\]\n]*)\]:[ \t]/gm)).filter(match => { const previous = (previousDefinitionLines.get(match.index!) ?? '').replace(/^[ \t]*(?:>[ ]?)*/, '').trim(); return collapsedMask[match.index! + match[0].indexOf('[')] === '[' && (previous === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%]|\[(?!\^)[^\]]*\]:)/.test(previous)) }).map(match => [match[1]!.trim().replace(/[ \t\r\n]+/g, ' '), match[1]!] as const))
  let collapsedImageLines: DjotImageLineOwner[] | undefined, collapsedImageLine = 0
  const flatFolded = headingFolded.replace(/(!?\[([^\[\]]*)\])\[\]/g, (value: string, label: string, key: string, at: number) => {
    const bracketAt = at + (label.startsWith('!') ? 1 : 0)
    if (definitions.size === 0 || isDjotEscaped(headingFolded, bracketAt) || collapsedMask[at] === ' ' || collapsedMask[at + value.length - 3] !== ']' || key.startsWith('^') && key.length > 1) return value
    if (key.includes('\n')) {
      if (/\n[ \t]*\n/.test(key) || isDjotEscaped(headingFolded, bracketAt)) return value
      collapsedImageLines ??= djotImageLineOwners(headingFolded, collapsedMask)
      while (collapsedImageLines[collapsedImageLine]!.end <= at) collapsedImageLine++
      const owner = collapsedImageLines[collapsedImageLine]!
      const layout = djotImageAltLayout(key, owner.quotes, owner.itemColumn, owner.itemQuote, owner.div)
      if (!layout.valid) return value
      key = imageChildText(layout.normalized, true, true).trim().replace(/[ \t\r\n]+/g, ' ')
    } else key = imageChildText(key, true, true)
    key = key.trim().replace(/[ \t\r\n]+/g, ' ')
    const definition = definitions.get(key)
    return definition !== undefined ? `${label}[${definition}]` : value
  })
  const referenceEdits: Array<[number, number, string]> = []
  if (definitions.size && flatFolded.includes('][]')) {
    const mask = maskDjotCodeAndDestinations(flatFolded)
    const owners = djotImageLineOwners(flatFolded, mask)
    let line = 0
    replaceDjotImageLabels(flatFolded, mask, (image, label, at) => {
      const end = at + image.length
      if (flatFolded.slice(end, end + 2) !== '[]' || label.startsWith('^') && label.length > 1) return image
      while (owners[line]!.end <= at) line++
      const owner = owners[line]!
      const layout = djotImageAltLayout(label, owner.quotes, owner.itemColumn, owner.itemQuote, owner.div)
      if (!layout.valid) return image
      const key = djotCollapsedReferenceText(layout.normalized, 0, true).trim().replace(/[ \t\r\n]+/g, ' ')
      const definition = definitions.get(key)
      if (definition !== undefined) referenceEdits.push([end + 1, end + 1, definition])
      return image
    })
  }
  const referenceParts: string[] = []
  let referenceCursor = 0
  for (const [start, end, text] of referenceEdits.sort((a, b) => a[0] - b[0])) {
    referenceParts.push(flatFolded.slice(referenceCursor, start), text)
    referenceCursor = end
  }
  const rawFolded = referenceParts.join('') + flatFolded.slice(referenceCursor)
  const imageParagraph = djotPlaceholderPrefix(body, '\x00DJOTIMAGEPARAGRAPH\x00')
  const imageMask = maskDjotCodeAndDestinations(rawFolded)
  const imageLines = djotImageLineOwners(rawFolded, imageMask)
  const imageStarts = new Set(imageLines.map(line => line.start))
  let imageLine = 0
  const folded = replaceDjotImageLabels(rawFolded, imageMask, (image, label, at) => {
    if (imageMask[at] !== '!' || imageMask[at + image.length - 1] !== ']' || /\n[ \t]*\n/.test(label) || isDjotEscaped(rawFolded, at)) return image
    const paragraph = imageStarts.has(at) ? imageParagraph : ''
    if (label.startsWith('^')) return image
    const pairedQuotes = ['"', "'"].some(quote => {
      const first = label.indexOf(quote)
      return first >= 0 && label.indexOf(quote, first + 1) >= 0
    })
    if (!label.includes('\n') && !/[_*`{^~\[\]<:]/.test(label) && !pairedQuotes && !/["']\}/.test(label) && !/(?<!\\)(?:\\\\)*\\[ \t]/.test(label)) {
      spans.push(label)
      return `${paragraph}![${prefix}${spans.length - 1}\x00]`
    }
    while (imageLines[imageLine]!.end <= at) imageLine++
    const altLayout = djotImageAltLayout(label, imageLines[imageLine]!.quotes, imageLines[imageLine]!.itemColumn, imageLines[imageLine]!.itemQuote, imageLines[imageLine]!.div)
    if (!altLayout.valid) return image
    const { normalized: normalizedLabel, continuations } = altLayout
    let continuation = 0
    const plain = imageChildText(normalizedLabel).replace(/\n(?:[ \t]*\n)+/g, '\n')
    spans.push(escapeImageAlt(plain, imageLines[imageLine]!.table)
      .replace(/\n/g, () => `\n${continuations[continuation++] ?? ''}`))
    return `${paragraph}![${prefix}${spans.length - 1}\x00]`
  })
  const wordMask = maskDjotCodeAndDestinations(folded).replace(/\[\^[^\]\n]*\]/g, (value, at: number) => isDjotEscaped(folded, at) ? value : ' '.repeat(value.length))
  const words = attributedDjotWords(folded, wordMask, convert, span => {
    spans.push(span)
    return `${prefix}${spans.length - 1}\x00`
  }, invalidAttributes.inherited)
  const restoreSpans = new RegExp(`${prefix}(\\d+)\x00`, 'g')
  const converted = invalidAttributes.restore(convert(words, chunk => chunk.replace(restoreSpans, (all, index: string) => spans[Number(index)] ?? all)))
    .replaceAll(emptyNote, '%%%%').replaceAll(imageParagraph, '{%%}')
    .replace(new RegExp(`^[ \t>]*${itemAttributePrefix}(B?)(\\d+)\x00\\n(?:[ \t>]*\\n)*([ \t>]*)([-*+]|[^ \t\\n]+)([ \t]+)`, 'gm'), (_match, block: string, index: string, container: string, marker: string, whitespace: string) => block ? `${container}${itemAttributeValues[Number(index)] ?? ''}\n${container}${marker}${whitespace}` : `${container}${marker}${itemAttributeValues[Number(index)] ?? ''}${whitespace}`)
    .replace(new RegExp(`(?<![ \t])([ \t]+)((?:\\[[ xX]\\][ \t]+)?)${itemAttributePrefix}(\\d+)\x00`, 'g'), (_match, whitespace: string, task: string, index: string) => `${itemAttributeValues[Number(index)] ?? ''}${whitespace}${task}`)
  const containers = genericDjotDivClasses(converted, djotContentStart)
  return strippedDefinitions.restore(frontmatter === '' ? containers : `${frontmatter}${separator}${containers}`)
}

function imageLossChildText(label: string, quoteDepth: number): string {
  if (quoteDepth) label = label.replace(/\n([^\n]*)/g, (_all, line: string) => {
    for (let depth = 0; depth < quoteDepth; depth++) line = line.replace(/^[ \t]*>(?:[ \t]|$)/, '')
    return '\n' + line
  })
  label = djotImageLabelAttributes(label, true)
  const child = (value: string): string => djotImageLabelText(value, source => convertDjotInput(source, true, true, true, true))
  const plain = child(label)
  const reserved = plain + '\n' + label.replace(/[^A-Za-z0-9]/g, '')
  let serial = 0
  while (reserved.includes(`DJOTTRAILSPACE${serial}Z`)) serial++
  const marker = `DJOTTRAILSPACE${serial}Z`
  const mask = maskDjotCodeAndDestinations(label)
  const probe = label.replace(/([ \t]+)((?:(?:\{%%\}|\[\]\{\}|\{\}|[\]}`_*~^+=-])[ \t]*)*)(\n)/g, (all, whitespace: string, hidden: string, newline: string, at: number) => {
    if (at > 0 && mask[at - 1] === '\\' && !isDjotEscaped(label, at - 1)) return all
    return whitespace + marker + hidden + newline
  })
  if (probe === label) return plain
  const protectedText = child(probe).replaceAll(marker, '')
  return protectedText.replace(/[ \t]+\n/g, '\n') === plain.replace(/[ \t]+\n/g, '\n') ? protectedText : plain
}

export function djotToCarveWithLosses(djot: string): { value: string; losses: DjotImportLoss[] } {
  const normalized = djot.replace(/\r\n?/g, '\n')
  const [frontmatter, separator, body] = splitSiteFrontmatter(normalized)
  const source = (frontmatter + separator).replace(/[^\n]/g, ' ') + body
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const rows = djotTableRows(source, mask)
  const rawCode: number[] = []
  if (hasDjotCodeLayoutCandidates(source)) closeDjotTableCode(source, at => rawCode.push(at))
  const accepted = new Map<number, { label: string; target: string; end: number }>()
  foldDjotReferences(source, accepted, mask, rows)
  const codeSource = source.includes('`') && source.includes(':::')
    ? replaceDjotImageLabels(source, maskDjotCodeAndDestinations(source), image => image.replace(/[^\n]/g, ' '))
    : source
  const imageLossCache = new Map<string, string>()
  const imageText = (label: string, depth: number): string => {
    const key = `${depth}:${label}`
    const cached = imageLossCache.get(key)
    if (cached !== undefined) return cached
    const text = imageLossChildText(label, depth)
    if (label.length <= 256) imageLossCache.set(key, text)
    return text
  }
  return { value: djotToCarve(djot), losses: djotImportLosses(source, rows, djotContentStart, rawCode, accepted, undefined, codeSource, imageText) }
}

function dropLeadingDjotSeparators(source: string): string {
  const lines = source.split('\n')
  const rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false))
  return lines
    .filter((line, n) => !(rows[n] && !rows[n - 1] && rows[n + 1] && /^\|(?:[ \t]*-+[ \t]*\|)+[ \t]*$/.test(line)))
    .join('\n')
}

function escapeDjotTableAttributeBoundaries(source: string): string {
  if (!source.includes('|') || !source.includes('{') && !source.includes('<')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { attributeValues: false, comments: false, commentAttributeBoundaries: true })
  const rows = djotTableRows(source, mask)
  let codeMask = mask
  if (source.includes('`')) {
    let offset = 0
    codeMask = source.split('\n').map((physical, index) => {
      const masked = rows[index] && physical.includes('`')
        ? maskDjotCodeAndDestinations(physical.replaceAll('{', ' '), false, false, false, undefined, [], { attributeValues: false, comments: false, destinations: false })
        : mask.slice(offset, offset + physical.length)
      offset += physical.length + 1
      return masked
    }).join('\n')
  }
  const rejectedRows = new Map<number, number>()
  const edits = new Map<number, { end: number; text: string; line: number }>()
  const codeEnds = new Map<number, number>()
  let line = 0, lineStart = 0
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\n') { line++; lineStart = at + 1; continue }
    const codeEnd = codeEnds.get(at)
    if (codeEnd !== undefined) { at = codeEnd - 1; continue }
    if (rows[line] && source[at] === '<' && !isDjotEscaped(source, at)) {
      const angle = /^<[^<>\s]+>/.exec(source.slice(at))
      if (angle) {
        let crossesCell = false
        for (let inner = at + 1; inner < at + angle[0].length; inner++) if (source[inner] === '|' && source[inner - 1] !== '\\') crossesCell = true
        if (crossesCell) edits.set(at, { end: at, text: '\\', line })
      }
    }
    if (!rows[line] || source[at] !== '{' || mask[at] !== '{' || isDjotEscaped(source, at)) continue
    const attrs = readAttributes(source, at)
    if (!attrs) continue
    let crossesCell = false, firstPipe = -1
    for (let inner = at + 1; inner < attrs.end; inner++) {
      if (source[inner] === '|' && source[inner - 1] !== '\\') {
        if (firstPipe < 0) firstPipe = inner
        if (mask[inner] === '|' && (source[at + 1] === '%' || codeMask[inner] === '|')) crossesCell = true
      }
    }
    if (firstPipe >= 0 && source[at + 1] !== '%' && codeMask[firstPipe] !== '|' && !rejectedRows.has(line)) {
      const newline = source.indexOf('\n', lineStart)
      const physical = source.slice(lineStart, newline < 0 ? source.length : newline)
      rejectedRows.set(line, lineStart + djotContentStart(physical))
    }
    if (crossesCell) {
      for (let inner = at + 1; inner < firstPipe; inner++) {
        if (source[inner] === '"' && source[inner + 1] === '}' && !isDjotEscaped(source, inner)) edits.set(inner, { end: inner + 2, text: '“\\}', line })
      }
    }
    if (crossesCell && firstPipe >= 0 && !rejectedRows.has(line)) {
      let open = -1, width = 0
      for (let inner = at + 1; inner < firstPipe; inner++) {
        if (source[inner] === '\\') { inner++; continue }
        if (source[inner] !== '`') continue
        let run = 1
        while (source[inner + run] === '`') run++
        if (open < 0) { open = inner; width = run }
        else if (width === run) open = -1
        inner += run - 1
      }
      if (open >= 0) {
        if (open + width === firstPipe) edits.set(open, { end: firstPipe, text: '`<code></code>`{=html}', line })
        else edits.set(firstPipe, { end: firstPipe, text: '`'.repeat(width), line })
        codeEnds.set(open, firstPipe)
      }
    }
    if (crossesCell) {
      edits.set(at, { end: at + 1, text: source[at - 1] === ']' || source[at - 1] === ')' ? '{}\\{' : '\\{', line })
      continue
    }
    for (let inner = at; inner < attrs.end; inner++) if (source[inner] === '\n') { line++; lineStart = inner + 1 }
    at = attrs.end - 1
  }
  let ownedRows = rows
  if (rejectedRows.size) {
    const chars = source.split('')
    for (const at of rejectedRows.values()) chars[at] = 'x'
    const paragraphSource = chars.join('')
    const physicalLines = paragraphSource.split('\n')
    const analysis: string[] = [], positions: number[] = []
    let owner: { depth: number; itemDepth: number; column: number } | undefined
    for (let index = 0; index < physicalLines.length; index++) {
      const physical = physicalLines[index]!
      const prefix = physical.slice(0, djotContentStart(physical))
      const depth = (prefix.replace(/\[\^[^\]\n]+\]:[ \t]*/g, '').match(/>/g) ?? []).length
      const leading = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/.exec(physical)![0]
      const quote = Array.from(leading.matchAll(/>/g))
      const column = owner && quote.length > owner.itemDepth ? quote[owner.itemDepth]!.index! : leading.length
      if (rows[index] && owner && (depth < owner.depth || owner.column >= 0 && column <= owner.column)) { analysis.push(''); owner = undefined }
      positions.push(analysis.length)
      analysis.push(physical)
      if (rejectedRows.has(index)) {
        let at = 0, itemDepth = 0, itemColumn = -1, quotes = 0
        while (at < prefix.length) {
          if (/[ \t]/.test(prefix[at]!)) { at++; continue }
          if (prefix[at] === '>') { quotes++; at++; continue }
          const marker = /^(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|\[\^[^\]\n]+\]:)[ \t]+/.exec(prefix.slice(at))
          if (!marker) break
          itemColumn = at + (marker[0].startsWith('[^') ? 1 : 0)
          itemDepth = quotes
          at += marker[0].length
        }
        owner = { depth, itemDepth, column: itemColumn }
      }
    }
    const analysisSource = analysis.join('\n')
    const analysisRows = djotTableRows(analysisSource, maskDjotCodeAndDestinations(analysisSource, false, true, false, undefined, [], { attributeValues: false, comments: false, commentAttributeBoundaries: true }))
    ownedRows = positions.map(position => analysisRows[position] ?? false)
  }
  const rowStarts = new Set(rejectedRows.values())
  let copied = 0
  const output: string[] = []
  for (let at = 0; at < source.length; at++) {
    if (rowStarts.has(at)) { output.push(source.slice(copied, at), '\\'); copied = at }
    const edit = edits.get(at)
    if (!edit || rejectedRows.has(edit.line) || !ownedRows[edit.line]) continue
    output.push(source.slice(copied, at), edit.text)
    copied = edit.end
    at = Math.max(at, edit.end - 1)
  }
  if (output.length === 0) return source
  output.push(source.slice(copied))
  return output.join('')
}

function normalizeDjotLinks(source: string, inherited: ReadonlySet<string> = new Set()): string {
  if (!source.includes('](')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false })
  const rows = djotTableRows(source, mask)
  let imageLines: DjotImageLineOwner[] | undefined
  const angles = new Map(
    [...source.matchAll(/<[^<>\s]+>/g)]
      .filter((match) => /[^:]@|[A-Za-z]:/.test(match[0]))
      .map((match) => [match.index!, match.index! + match[0].length]),
  )
  const quoteDepths = source
    .split('\n')
    .map((line) => (line.match(/^(?:[ \t]*>(?:[ \t]|$))*/)?.[0].match(/>/g) ?? []).length)
  const rejectedAttribute = /\0DJOTINVALIDATTR\x00\d+\0/y
  const stack: { at: number; image: boolean; depth: number; labelEnd?: number; target?: number; parens: number }[] = []
  const pendingNotes = new Set<number>(),
    literalNotes = new Map<number, number>()
  const edits = new Map<number, { end: number; text: string }>()
  const pipeTargets = new Map<string, string>()
  const pipeDefinitions = new Map<string, string>()
  let occupiedLabels: Set<string> | undefined
  let pipeSerial = 0
  let line = 0
  const boundaries = new Set(djotInlineBoundaries(source, mask))
  if (source.includes(':::')) {
    const divClosers = new Map<number, number[]>()
    djotInlineBoundaries(source, mask, true, divClosers)
    for (const at of divClosers.keys()) boundaries.add(at)
  }
  const labelOf = (start: number, limit: number): string => {
    let label = '',
      brackets = 0
    for (let at = start; at < limit; at++) {
      const edit = edits.get(at)
      if (edit && edit.end <= limit) {
        label += edit.text
        at = edit.end - 1
        continue
      }
      const end = angles.get(at)
      if (end !== undefined) {
        label += source.slice(at, end)
        at = end - 1
        continue
      }
      if (mask[at] === ' ') {
        label += source[at]
        continue
      }
      if (source[at] === '\\') {
        label += source.slice(at, at + 2)
        at++
        continue
      }
      if (source[at] === '[') brackets++
      if (source[at] === ']') {
        if (brackets) brackets--
        else label += '\\'
      }
      label += source[at]
    }
    return label
  }
  let destinationOwner: typeof stack[number] | undefined
  const clearScope = (): void => {
    if (destinationOwner) edits.set(destinationOwner.target! - 1, { end: destinationOwner.target!, text: '\\(' })
    stack.length = 0
    destinationOwner = undefined
    pendingNotes.clear()
  }
  for (let i = 0; i < source.length; i++) {
    if (boundaries.has(i)) { clearScope() }
    if (source[i] === '\n') { line++; if (/^\n[ \t]*(?:>[ \t]*)*\n/.test(source.slice(i))) { clearScope(); continue } }
    if (mask[i] === ' ') continue
    if (source[i] === '\\') {
      i++
      continue
    }
    const angle = angles.get(i)
    if (angle !== undefined) {
      i = angle - 1
      continue
    }
    if (source[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        i = attrs.end - 1
        continue
      }
    }
    if (rows[line] && source[i] === '|' && source[i - 1] !== '\\') {
      clearScope()
      continue
    }
    if (source[i] === '[') {
      if (stack.length >= 200) return source
      stack.push({ at: i, image: i > 0 && source[i - 1] === '!' && !isDjotEscaped(source, i - 1), depth: quoteDepths[line] ?? 0, parens: 0 })
      if (source[i + 1] === '^') pendingNotes.add(i)
      continue
    }
    const tip = stack.at(-1)
    if (!tip) continue
    if (source[i] === ']') {
      if (source[tip.at + 1] === '^') {
        literalNotes.set(tip.at, i + 1)
        pendingNotes.delete(tip.at)
        stack.pop()
        continue
      }
      if (source[i + 1] === '(') {
        if (destinationOwner && destinationOwner !== tip)
          edits.set(destinationOwner.target! - 1, { end: destinationOwner.target!, text: '\\(' })
        tip.labelEnd = i
        tip.target = i + 2
        tip.parens = 0
        destinationOwner = tip
        i++
        continue
      }
      if (source[i + 1] === '[') {
        let end = i + 2
        while (end < source.length && source[end] !== ']' && source[end] !== '[') {
          if (source[end] === '\\') end++
          end++
        }
        if (source[end] === ']' && mask[end] === ']') {
          if (tip.target !== undefined) edits.set(tip.at, { end: i + 1, text: '[' + labelOf(tip.at + 1, i) + ']' })
          if (destinationOwner === tip) destinationOwner = undefined
          stack.pop()
          i = end
        }
        continue
      }
      rejectedAttribute.lastIndex = i + 3
      const rejected = source[i + 1] === '\\' && source[i + 2] === '{' ? rejectedAttribute.exec(source)?.[0] : undefined
      if (source[i + 1] === '{' || rejected !== undefined && inherited.has(rejected)) {
        if (tip.target !== undefined) edits.set(tip.at, { end: i + 1, text: source[i + 1] === '{' && readAttributes(source, i + 1) ? '[' + labelOf(tip.at + 1, i) + ']' : '\\[' + source.slice(tip.at + 1, i + 1) })
        if (destinationOwner === tip) destinationOwner = undefined
        stack.pop()
      }
    }
    if (destinationOwner && source[i] === '(') destinationOwner.parens++
    if (source[i] === ')') {
      const owner = destinationOwner
      if (!owner) continue
      if (owner.parens > 0) {
        owner.parens--
        continue
      }
      if (tip !== owner) {
        edits.set(owner.target! - 1, { end: owner.target!, text: '\\(' })
        stack.length = 0
        destinationOwner = undefined
        pendingNotes.clear()
        continue
      }
      const authoredLabel = owner.image ? source.slice(owner.at + 1, owner.labelEnd!) : ''
      if (authoredLabel.includes('\n')) {
        imageLines ??= djotImageLineOwners(source, mask)
        let left = 0, right = imageLines.length
        while (left < right) {
          const middle = (left + right) >>> 1
          if (imageLines[middle]!.end <= owner.at) left = middle + 1
          else right = middle
        }
        const imageOwner = imageLines[left]!
        if (!djotImageAltLayout(authoredLabel, imageOwner.quotes, imageOwner.itemColumn, imageOwner.itemQuote).valid) {
          stack.pop()
          destinationOwner = undefined
          continue
        }
      }
      let label = labelOf(owner.at + 1, owner.labelEnd!)
      let rawDestination = ''
      for (let at = owner.target!; at < i;) {
        const end = literalNotes.get(at)
        if (end !== undefined && end <= i) {
          rawDestination += source
            .slice(at, end)
            .replace(/\\/g, rows[line] ? '\\\\' : '%5C')
            .replace(/\n[ \t]*/g, ' ')
          at = end
        } else rawDestination += source[at++]!
      }
      let destination = djotDestinationLines(rawDestination, owner.depth)
      if (owner.image && !authoredLabel.includes('\n') && label.includes('[')) {
        const definitions = Array.from(label.matchAll(/\[(carve-djot-pipe-target-\d+)\]/g), match => pipeDefinitions.get(match[1]!) ?? '').filter(Boolean).join('\n')
        label = renderDjotImageChildText(parse(convertDjotInput((definitions ? definitions + '\n\n' : '') + 'DJOTALT ' + removeInheritedAttributeMarkers(label, inherited) + ' DJOTEND', true, true, true, true).replaceAll('\0U\0', '\0')), label.includes('\n'))
          .replace(/ DJOTEND\n?$/, '')
          .slice(8)
          .replace(/[!-\/:-@\[-`{-~]/g, (value) => '\\' + value)
      }
      const target = destination.replace(
        rows[line] && destination.includes('|') ? /\\([ \t!-\/:-@\[-`{-~])|[\\\s"<>`]/g : /\\([ \t!-\/:-@\[-`{-~])|[\\\s"<>`()]/g,
        (value, escaped: string | undefined) =>
          escaped !== undefined
            ? /[()\\]/.test(escaped)
              ? '\\' + escaped
              : /[\s"<>`]/.test(escaped)
                ? encodeURIComponent(escaped)
                : escaped
            : value === '\\'
              ? '\\\\'
              : encodeURIComponent(value).replace(/[()]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()),
      )
      const protectedTarget = target.replace(/\](?=[\[{])/g, '%5D')
      if (rows[line] && protectedTarget.includes('|')) {
        let alias = pipeTargets.get(protectedTarget)
        if (alias === undefined) {
          occupiedLabels ??= new Set(Array.from(source.matchAll(/\[([^\[\]\n]*)\]/g), match => match[1]!.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1').trim().replace(/[ \t\r\n]+/g, ' ')))
          do { alias = `carve-djot-pipe-target-${++pipeSerial}` } while (occupiedLabels.has(alias))
          occupiedLabels.add(alias)
          pipeTargets.set(protectedTarget, alias)
          pipeDefinitions.set(alias, `[${alias}]: ${protectedTarget}`)
        }
        edits.set(owner.at, { end: i + 1, text: `[${label}][${alias}]` })
      } else edits.set(owner.at, { end: i + 1, text: `[${label}](${protectedTarget})` })
      stack.pop()
      destinationOwner = undefined
      for (const at of pendingNotes) edits.set(at, { end: at + 1, text: '\\[' })
      pendingNotes.clear()
    }
  }
  clearScope()
  const output: string[] = []
  for (let i = 0; i < source.length;) {
    const edit = edits.get(i)
    if (edit) {
      output.push(edit.text)
      i = edit.end
    } else output.push(source[i++]!)
  }
  const text = output.join('')
  const used = new Set(Array.from(text.matchAll(/\[(carve-djot-pipe-target-\d+)\]/g), match => match[1]!))
  const definitions = Array.from(pipeTargets).filter(([, alias]) => used.has(alias)).map(([target, alias]) => `[${alias}]: ${target}`).join('\n')
  return (definitions ? definitions + '\n\n' : '') + text
}

function carryDjotAttributesAcrossQuoteExits(source: string): string {
  if (!source.includes('>') || !source.includes('{')) return source
  const lines = source.split('\n'), mask = maskDjotCodeAndDestinations(source).split('\n')
  let offset = 0
  const offsets = lines.map(line => { const start = offset; offset += line.length + 1; return start })
  let previousDepth = 0
  const contexts = lines.map((line, index) => {
    const prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const body = line.slice(prefix.length), indent = /^[ \t]*/.exec(body)![0].length
    const attrs = mask[index]![prefix.length + indent] === '{' ? readAttributes(body, indent) : undefined
    const depth = (prefix.match(/>/g) ?? []).length, opens = depth > previousDepth
    previousDepth = depth
    return { opens, prefix, depth: (prefix.match(/>/g) ?? []).length, body, indent, attributes: attrs?.end === body.trimEnd().length, continued: false, listOwned: false }
  })
  const listColumns = new Map<number, number[]>()
  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index]!
    if (context.body.trim() === '') continue
    const columns = listColumns.get(context.depth) ?? []
    if (/^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(context.body.slice(context.indent))) {
      while (columns.length && columns.at(-1)! >= context.indent) columns.pop()
      columns.push(context.indent)
      listColumns.set(context.depth, columns)
    }
    if (context.attributes) {
      context.continued = continuesParagraph(source, offsets[index]! + context.prefix.length + context.indent)
      context.listOwned = columns.some(column => column < context.indent)
    } else if (context.indent <= (columns.at(-1) ?? -1) && !/^(?:[-*+]|[^ \t]+[.)])[ \t]+/.test(context.body.slice(context.indent))) listColumns.delete(context.depth)
  }
  const moved = new Map<number, string[]>()
  let following: number | undefined, destinationDepth: number | undefined, nextContent: number | undefined
  for (let index = lines.length - 1; index >= 0; index--) {
    const context = contexts[index]!
    if (context.attributes) {
      if (following !== undefined && destinationDepth !== undefined && context.depth > destinationDepth && !(nextContent !== undefined && contexts[nextContent]!.opens) && !context.continued && !context.listOwned) {
        const target = lines[following]!
        let end = 0
        for (let level = 0; level < destinationDepth; level++) end += /^[ \t]*>(?:[ \t]|$)/.exec(target.slice(end))![0].length
        end += /^[ \t]*/.exec(target.slice(end))![0].length
        const attributes = moved.get(following) ?? []
        let ownerEnd = 0
        for (let level = 0; level < destinationDepth; level++) ownerEnd += /^[ \t]*>(?:[ \t]|$)/.exec(context.prefix.slice(ownerEnd))![0].length
        const ownerIndent = /^[ \t]*/.exec(context.prefix.slice(ownerEnd))![0].length
        const targetPrefix = target.slice(0, end)
        attributes.push((ownerIndent ? context.prefix.slice(0, ownerEnd) + ' '.repeat(ownerIndent) : targetPrefix) + context.body.slice(context.indent))
        moved.set(following, attributes)
        lines[index] = context.prefix.trimEnd()
      } else if (destinationDepth !== undefined && context.depth <= destinationDepth) following = index
    } else if (context.body.trim() === '') {
      if (destinationDepth !== undefined) destinationDepth = Math.min(destinationDepth, context.depth)
    } else { following = index; destinationDepth = context.depth }
    if (context.body.trim() !== '' || context.opens) nextContent = index
  }
  return lines.flatMap((line, index) => [...(moved.get(index)?.reverse() ?? []), line]).join('\n')
}

function normalizeDjotAttributeLines(source: string): string {
  if (!source.includes('{')) return source
  const mask = maskDjotCodeAndDestinations(source).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value)
  const closes = new Map<number, number>()
  let close: number | undefined
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '\n') close = undefined
    else if (source[at] === '}') close = at + 1
    else if (source[at] === '{' && close !== undefined) closes.set(at, close)
  }
  const parts: string[] = []
  let copied = 0
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{' || isDjotEscaped(source, i)) continue
    const attrs = readAttributes(source, i, false, false, true, true)
    if (!attrs) {
      const end = closes.get(i)
      if (end !== undefined && /^[A-Za-z][A-Za-z0-9_-]*=/.test(source.slice(i + 1))) {
        parts.push(
          source.slice(copied, i),
          source.slice(i, end).replace(/[{}\[\]]/g, (value) => '\\' + value),
        )
        copied = end
        i = end - 1
      }
      continue
    }
    if (source.slice(i, attrs.end).includes('\n')) {
      parts.push(source.slice(copied, i), attrs.source)
      copied = attrs.end
    }
    i = attrs.end - 1
  }
  parts.push(source.slice(copied))
  return parts.join('')
}

function foldDjotReferences(source: string, accepted?: Map<number, { label: string; target: string; end: number }>, originalMask?: string, originalRows?: readonly boolean[]): string {
  if (!source.includes(']:')) return source
  const lines = source.split('\n'),
    mask = originalMask ?? maskDjotCodeAndDestinations(source, false, true, false)
  const rows = originalRows ? [...originalRows] : djotTableRows(source, mask)
  const removed = new Set<number>()
  let offset = 0, previous = '', previousDepth = 0, previousAttributeBlock = false
  const definitionOwners: Array<{ start: number; depth: number }> = []
  let fenceMask: string | undefined
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!,
      [depth] = quoted(line),
      at = djotContentStart(line),
      content = line.slice(at)
    const definition = /^\[(?!\^[^\]\n]+\]:(?:[ \t\r]|$))([^\]\n]*)\]:[ \t]*([^ \t\r\n]*)\r?$/.exec(content)
    const previousLine = lines[n - 1] ?? '', previousAt = djotContentStart(previousLine)
    const previousNote = previousLine.slice(0, previousAt).indexOf('[^')
    const previousOwner = previousNote < 0 ? previousAt : previousNote + 1
    const prefix = line.slice(0, at)
    const noteAt = prefix.indexOf('[^')
    const ownerMarker = noteAt < 0 ? /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.exec(prefix) : null
    const physicalPrefix = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/.exec(line)![0]
    const definitionOwner = definitionOwners.at(-1)
    const ownerExit = definitionOwner !== undefined && (depth < definitionOwner.depth || depth === definitionOwner.depth && physicalPrefix.length < definitionOwner.start)
    const metadata = definition !== null || content.startsWith('{') && readAttributes(content, 0)?.end === content.trimEnd().length
    if (ownerExit && metadata && mask[offset + at] === ' ') fenceMask ??= maskDjotFences(source, undefined, rows, true)
    const metadataExit = ownerExit && metadata && (mask[offset + at] !== ' ' || fenceMask?.[offset + at] !== ' ')
    const outdented = metadataExit || at < previousOwner && /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(previousLine.slice(0, previousNote < 0 ? previousAt : previousNote))
    const boundary: boolean = previous === '' || previousAttributeBlock || rows[n - 1] || depth !== previousDepth || /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*][ \t]*){3,}$/.test(previousLine) || outdented || /^(?:#{1,6} |:{3,}|[`~]{3,}|\[[^\]]*\]:|(?:[-*][ \t]*){3,}$)/.test(previous)
    const marker = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(noteAt < 0 ? prefix : prefix.slice(0, noteAt))
    const rowEnd = line.trimEnd().length - 1
    const boundaryRow = (ownerExit || rows[n - 1]) && line[physicalPrefix.length] === '|' && rowEnd > physicalPrefix.length && mask[offset + physicalPrefix.length] === '|' && mask[offset + rowEnd] === '|' && line[rowEnd - 1] !== '\\'
    const rowEntry = boundaryRow && ownerExit && !rows[n]
    if (boundaryRow) rows[n] = true
    const closesOwner = boundaryRow || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[-*][ \t]*){3,}$)/.test(line.slice(physicalPrefix.length)) && mask[offset + physicalPrefix.length] !== ' ' || rows[n] || /^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(line.slice(physicalPrefix.length))
    if (ownerExit && (metadataExit || previous === '' || closesOwner || rows[n - 1])) while (definitionOwners.at(-1) && (depth < definitionOwners.at(-1)!.depth || depth === definitionOwners.at(-1)!.depth && physicalPrefix.length < definitionOwners.at(-1)!.start)) definitionOwners.pop()
    if (boundary && (noteAt >= 0 || ownerMarker !== null)) {
      const start = noteAt >= 0 ? noteAt : ownerMarker!.index
      if (mask[offset + start] !== ' ' && (definitionOwners.at(-1)?.start !== start + 1 || definitionOwners.at(-1)?.depth !== depth)) definitionOwners.push({ start: start + 1, depth })
    }
    const separator = (metadataExit && !marker || rowEntry || definition !== null && rows[n - 1] && !marker && (ownerExit || definitionOwner === undefined)) && previous !== '' ? physicalPrefix + '\n' : ''
    if (separator) lines[n] = separator + line
    if (definition && (mask[offset + at] === '[' || metadataExit && fenceMask?.[offset + at] === '[') && (boundary || marker)) {
      let target = definition[2] ?? '',
        end = n
      while (end + 1 < lines.length) {
        const next = lines[end + 1]!,
          [nextDepth] = quoted(next),
          nextAt = djotContentStart(next)
        const nextPrefix = next.slice(0, nextAt), nextToken = next.slice(nextAt).replace(/\r$/, '')
        if (nextDepth !== depth || nextAt <= at || nextPrefix.includes('[^') || /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(nextPrefix) || !/^[^ \t\r\n]+$/.test(nextToken)) break
        target += nextToken
        end++
      }
      accepted?.set(n, { label: definition[1]!, target, end })
      const nextByte = content[definition[1]!.length + 3]
      if (end > n || target !== '' && nextByte !== ' ')
        lines[n] = separator + line.slice(0, at) + `[${definition[1]}]:${target ? ' ' + target : ''}`
      if (end > n) {
        for (let k = n + 1; k <= end; k++) {
          offset += lines[k]!.length + 1
          removed.add(k)
        }
        n = end
      }
    }
    const invalidDefinition = definition === null && /^\[(?!\^)[^\]\n]*\]:/.test(content)
    if ((invalidDefinition || definition && !(boundary || marker)) && mask[offset + at] === '[') lines[n] = line.slice(0, at) + line.slice(at).replace(']:', ']\\:')
    const attrs = content[0] === '{' ? readAttributes(content, 0) : undefined
    previousAttributeBlock = !!(boundary || marker) && attrs?.end === content.trimEnd().length
    previous = content.trim(); previousDepth = depth; offset += line.length + 1
  }
  return lines.filter((_line, n) => !removed.has(n)).join('\n')
}

function normalizeDjotParagraphFences(source: string): string {
  const rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false))
  const mask = maskDjotOpaque(maskDjotFences(source, undefined, rows, true), false, { code: false })
  if (!mask.includes('```')) return source
  const runs = new Map<number, { width: number; end: number }>()
  const next = new Map<number, number>()
  const matches = [...mask.matchAll(/`+/g)]
  for (let k = matches.length - 1; k >= 0; k--) {
    const match = matches[k]!,
      at = match.index!,
      width = match[0].length
    runs.set(at, { width, end: next.get(width) ?? source.length })
    next.set(width, at)
  }
  const breaks = [...mask.matchAll(/\n[ \t]*(?:>[ \t]*)*\n/g)].map((match) => match.index!)
  const angles = new Map(
    [...mask.matchAll(/<[^<>\s]+>/g)]
      .filter((match) => /[^:]@|[A-Za-z]:/.test(match[0]))
      .map((match) => [match.index!, match.index! + match[0].length]),
  )
  const lineHeads = new Set<number>()
  let lineOffset = 0
  for (const line of source.split('\n')) {
    lineHeads.add(lineOffset + /^[ \t]*(?:>[ ]?[ \t]*)*/.exec(line)![0].length)
    lineOffset += line.length + 1
  }
  const output: string[] = []
  let copied = 0,
    boundary = 0
  for (let i = 0; i < source.length;) {
    if (mask[i] === ' ') {
      i++
      continue
    }
    if (source[i] === '\\') {
      i += 2
      continue
    }
    const angle = angles.get(i)
    if (angle !== undefined) {
      i = angle
      continue
    }
    while ((breaks[boundary] ?? source.length) <= i) boundary++
    const run = runs.get(i)
    if (run) {
      const end = Math.min(run.end, breaks[boundary] ?? source.length)
      const closed = run.end < (breaks[boundary] ?? source.length)
      const rawPayload = source.slice(i + run.width, end)
      const payload = !closed && end === source.length ? rawPayload.replace(/\n[ \t]*(?:>[ \t]*)*$/, '') : rawPayload
      if (run.width >= 3 && lineHeads.has(i)) {
        let width = 1
        const widths = new Set([...payload.matchAll(/`+/g)].map((match) => match[0].length))
        while (widths.has(width)) width++
        const ticks = '`'.repeat(width)
        output.push(
          source.slice(copied, i),
          payload === '' ? '`<code></code>`{=html}' : (width >= 3 ? '{%%}' : '') + ticks + payload + ticks,
        )
        copied = end + (closed ? run.width : 0)
      }
      i = end + (closed ? run.width : 0)
      continue
    }
    i++
  }
  output.push(source.slice(copied))
  return output.join('')
}

function normalizeDjotFootnotes(source: string, isDefinitionBoundary: (line: string) => boolean = () => false, inherited: ReadonlySet<string> = new Set(), emptyNote = '%%%%', sourceWidths?: Map<string, number>): string {
  if (!source.includes('[^')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const rows = djotTableRows(source, mask)
  const nonRows = new Set<number>()
  let rowOffset = 0
  source.split('\n').forEach((line, n) => {
    const at = djotContentStart(line)
    if (!rows[n] && line[at] === '|' && mask[rowOffset + at] === '|') nonRows.add(rowOffset + at)
    rowOffset += line.length + 1
  })
  const unsupported = (key: string) => /[\[\]`<>|\\\f\x00]/.test(key)
  const labels = new Map<string, string>(),
    definitions = new Map<number, { key: string; end: number }>()
  const defined = new Set<string>(),
    used = new Set<string>(),
    reserved = new Set([...source.matchAll(/carve-djot-note-(\d+)/gi)].map((match) => Number(match[1])))
  let serial = 0,
    offset = 0
  const lineHeads = new Set<number>(),
    emptyDefinitions = new Set<number>()
  const keyOf = (label: string) => removeInheritedAttributeMarkers(label, inherited).trim().replace(/[ \t\r\n]+/g, ' ')
  const alias = (key: string): string => {
    let name = labels.get(key)
    if (!name) {
      while (reserved.has(serial)) serial++
      name = `carve-djot-note-${serial++}`
      labels.set(key, name)
    }
    return name
  }
  const noteLines = source.split('\n')
  const itemOwners: { depth: number, column: number }[] = []
  for (const [n, line] of noteLines.entries()) {
    const containerEnd = djotContentStart(line)
    const noteAt = line.slice(0, containerEnd).indexOf('[^')
    const prefix = noteAt >= 0 ? line.slice(0, noteAt) : /^[ \t]*(?:>[ \t]+|>$)*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})\))[ \t]+)*/.exec(line)![0]
    const at = prefix.length
    lineHeads.add(offset + at)
    const previousLine = noteLines[n - 1] ?? ''
    const previousPrefix = /^[ \t]*(?:>[ \t]+|>$)*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})\))[ \t]+)*/.exec(
      previousLine,
    )![0]
    const previous = previousLine.slice(previousPrefix.length).trim()
    const physicalPrefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const itemDepth = (physicalPrefix.match(/>/g) ?? []).length
    const itemColumn = /^[ \t]*/.exec(line.slice(physicalPrefix.length))![0].length
    const actualItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(line.slice(physicalPrefix.length + itemColumn))
    const siblingItem = actualItem && itemOwners.some(owner => owner.depth === itemDepth && itemColumn <= owner.column)
    let boundary = isDefinitionBoundary(previousLine) || previous === '' || rows[n - 1] || siblingItem || /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*][ \t]*){3,}$/.test(previousLine) || at < previousPrefix.length && /(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})\))[ \t]+/.test(previousPrefix) || itemDepth < (/^(?:[ \t]*>(?:[ \t]|$))*/.exec(previousLine)![0].match(/>/g)?.length ?? 0) || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]*\]:|(?:[-*][ \t]*){3,}$)/.test(previous)
    const previousNote = /^\[\^[^\]\n]+\]:[ \t]*(.+)$/.exec(previous)
    if (at > previousPrefix.length && previousNote && !/^(?:>(?:[ \t]|$)|[-*+][ \t]|#{1,6}(?:[ \t]|$)|[`~]{3,}|:{3,}|[|]|\{|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t])/.test(previousNote[1]!)) boundary = false
    if (line.trim() && (boundary || itemDepth < (itemOwners.at(-1)?.depth ?? 0))) {
      while (itemOwners.length && (itemDepth < itemOwners.at(-1)!.depth || itemDepth === itemOwners.at(-1)!.depth && itemColumn <= itemOwners.at(-1)!.column)) itemOwners.pop()
      if (actualItem) itemOwners.push({ depth: itemDepth, column: itemColumn })
    }
    const head = /^\[\^([^\]\n]+)\]:(?:[ \t]|$)/.exec(line.slice(at))
    if (head && boundary && mask[offset + at] === '[') {
      const key = keyOf(head[1]!)
      defined.add(key)
      definitions.set(offset + at, { key, end: offset + at + 2 + head[1]!.length })
      if (unsupported(key)) alias(key)
      if (!line.slice(at + head[0].length).trim()) emptyDefinitions.add(offset + at)
      const header = /^\[\^[^\]\n]+\]:[ \t]*/.exec(line.slice(at))![0]
      const bodyAt = at + header.length
      const body = line.slice(bodyAt)
      const bodyPrefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(body)![0]
      const bodyIndent = /^[ \t]*/.exec(body.slice(bodyPrefix.length))![0].length
      if (/^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(body.slice(bodyPrefix.length + bodyIndent))) {
        itemOwners.push({ depth: itemDepth + (bodyPrefix.match(/>/g) ?? []).length, column: bodyAt + bodyPrefix.length + bodyIndent - physicalPrefix.length })
      }
      for (const nested of line.slice(bodyAt, containerEnd).matchAll(/\[\^([^\]\n]+)\]:(?:[ \t]|$)/g)) {
        const nestedAt = bodyAt + nested.index!
        if (mask[offset + nestedAt] !== '[') continue
        const nestedKey = keyOf(nested[1]!)
        defined.add(nestedKey)
        definitions.set(offset + nestedAt, { key: nestedKey, end: offset + nestedAt + 2 + nested[1]!.length })
        lineHeads.add(offset + nestedAt)
        if (unsupported(nestedKey)) alias(nestedKey)
        if (!line.slice(nestedAt + nested[0].length).trim()) emptyDefinitions.add(offset + nestedAt)
      }
    }
    offset += line.length + 1
  }
  const angles = new Map(
    [...source.matchAll(/<[^<>\s]+>/g)]
      .filter((match) => /[^:]@|[A-Za-z]:/.test(match[0]))
      .map((match) => [match.index!, match.index! + match[0].length]),
  )
  const destinations = new Map<number, number>(),
    acceptedDestinations = new Set<number>(),
    parens: number[] = []
  let destinationLine = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === '\n') destinationLine++
    if (rows[destinationLine] && source[i] === '|' && source[i - 1] !== '\\') parens.length = 0
    if (source[i] === '(') parens.push(i)
    else if (source[i] === ')' && parens.length) {
      const at = parens.pop()!
      if (source[at - 1] === ']') destinations.set(at, i + 1)
    }
  }
  const malformedEnds = new Map<number, number>()
  let nextBrace = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '\n') nextBrace = -1
    else if (source[at] === '}') nextBrace = at + 1
    else if (source[at] === '{' && nextBrace >= 0) {
      const malformed = /^\{(\0DJOTINVALIDATTR\x00\d+\0)?[A-Za-z][\w-]*=/.exec(source.slice(at))
      if (malformed && (!malformed[1] || inherited.has(malformed[1]))) malformedEnds.set(at, nextBrace)
    }
  }
  const brackets = new Map<number, number>(),
    stack: number[] = []
  let lineIndex = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineIndex++
      if (/^\n[ \t]*(?:>[ \t]+)*>?\n/.test(source.slice(i))) stack.length = 0
    }
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        i = attrs.end - 1
        continue
      }
      const badEnd = malformedEnds.get(i)
      if (badEnd !== undefined) {
        i = badEnd - 1
        continue
      }
    }
    const angle = angles.get(i)
    if (angle !== undefined) {
      i = angle - 1
      continue
    }
    if (mask[i] === ' ') continue
    if (rows[lineIndex] && source[i] === '|' && source[i - 1] !== '\\') {
      stack.length = 0
      continue
    }
    const definition = definitions.get(i)
    if (definition) {
      i = definition.end
      continue
    }
    if (source[i] === '[') stack.push(i)
    else if (source[i] === ']' && stack.length) {
      const open = stack.at(-1)!
      if (source[open + 1] === '^') brackets.set(stack.pop()!, i)
      else if (source[i + 1] === '(' && destinations.has(i + 1)) {
        brackets.set(stack.pop()!, i)
        acceptedDestinations.add(i + 1)
        i = destinations.get(i + 1)! - 1
      } else if (source[i + 1] === '[') {
        let end = i + 2
        while (end < source.length && source[end] !== ']') {
          if (source[end] === '\\') end++
          end++
        }
        if (source[end] === ']') {
          brackets.set(stack.pop()!, i)
          i = end
        }
      } else if (source[i + 1] === '{' && readAttributes(source, i + 1)) {
        brackets.set(stack.pop()!, i)
      }
    }
  }
  const output: string[] = []
  const imageEnds = new Map(
    [...brackets].filter(([at, close]) => source[at - 1] === '!' && (source[at + 1] !== '^' || close === at + 2) && /[([]/.test(source[close + 1] ?? '')),
  )
  for (let i = 0; i < source.length;) {
    const destinationEnd = destinations.get(i)
    if (destinationEnd !== undefined && acceptedDestinations.has(i)) {
      output.push(source.slice(i, destinationEnd))
      i = destinationEnd
      continue
    }
    if (nonRows.has(i)) output.push('\\')
    const imageEnd = imageEnds.get(i)
    if (imageEnd !== undefined) {
      let cursor = i
      for (let at = i + 1; at < imageEnd; at++) {
        const end = brackets.get(at)
        if (source.startsWith('[^', at) && end !== undefined && end < imageEnd) {
          output.push(source.slice(cursor, at))
          cursor = end + 1
          at = end
        }
      }
      output.push(source.slice(cursor, imageEnd + 1))
      i = imageEnd + 1
      continue
    }
    if (source[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        output.push(source.slice(i, attrs.end))
        i = attrs.end
        continue
      }
      const badEnd = malformedEnds.get(i)
      if (badEnd !== undefined) {
        output.push(source.slice(i, badEnd))
        i = badEnd
        continue
      }
    }
    const definition = definitions.get(i),
      end = definition?.end ?? brackets.get(i)
    if (source.startsWith('[^', i) && (definition || mask[i] === '[') && end !== undefined && end > i + 2) {
      const key = definition?.key ?? keyOf(source.slice(i + 2, end))
      {
        const rename = labels.has(key) || unsupported(key) || !defined.has(key)
        const name = rename ? alias(key) : key
        const at = i
        if (definition && sourceWidths) sourceWidths.set(name, end - i + 1 + /^:[ \t]*/.exec(source.slice(end + 1))![0].length)
        if (!definition) used.add(key)
        output.push(rename || key !== source.slice(i + 2, end) ? `[^${name}]` : source.slice(i, end + 1))
        i = end + 1
        if (definition && emptyDefinitions.has(at)) {
          output.push(`: ${emptyNote}`)
          i++
        }
        if (definition && source[i] === ':' && source[i + 1] === '\t') {
          output.push(': ')
          i += 2
        }
        if (!definition && source[i] === ':' && lineHeads.has(at)) {
          output.push('\\:')
          i++
        }
        continue
      }
    }
    if (source[i] === '!' && !isDjotEscaped(source, i) && source.startsWith('[^', i + 1) && (brackets.get(i + 1) ?? 0) > i + 3 && mask[i + 1] === '[') output.push('\\')
    output.push(source[i++]!)
  }
  const stubs: string[] = []
  for (const key of used) if (!defined.has(key)) stubs.push(`[^${alias(key)}]: ${emptyNote}`)
  return (stubs.length ? stubs.join('\n\n') + '\n\n' : '') + output.join('')
}

function normalizeDjotFences(source: string): string {
  const quoteCode = hasDjotCodeLayoutCandidates(source)
  if (!source.includes('```') && !source.includes('~~~'))
    return source.includes('\\|') || quoteCode ? closeDjotTableCode(source) : source
  const lines = source.split('\n')
  const rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false))
  maskDjotCodeAndDestinations(
    source,
    false,
    true,
    false,
    (line, replacement) => {
      lines[line] = replacement
    },
    rows,
  )
  const normalized = normalizeDjotParagraphFences(lines.join('\n'))
  return quoteCode ? closeDjotTableCode(normalized) : normalized
}

function normalizeDjotAutolinks(source: string): string {
  if (!source.includes('<')) return source
  const codeMask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { autolinks: false })
  const mask = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], { autolinks: false }).split('')
  const rows = djotTableRows(source, codeMask)
  let definitionIndent = -1,
    definitionOffset = 0,
    definitionLine = 0,
    previousContent = ''
  for (const line of source.split('\n')) {
    const at = djotContentStart(line), content = line.slice(at)
    const boundary = previousContent === '' || rows[definitionLine - 1] || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%]|\[(?!\^)[^\]]*\]:)/.test(previousContent)
    const definition = codeMask[definitionOffset + at] === '[' && /^\[(?!\^)[^\]\n]*\]:/.test(content) && boundary
    const continuation = definitionIndent >= 0 && at > definitionIndent && /^\S+$/.test(content)
    if (definition || continuation) {
      for (let i = 0; i < line.length; i++) mask[definitionOffset + i] = ' '
      if (definition) definitionIndent = at
    } else definitionIndent = -1
    previousContent = content.trim()
    definitionOffset += line.length + 1
    definitionLine++
  }

  const angleEnds = new Map(
    Array.from(source.matchAll(/<[^<>\s]+>/g), (match) => [
      match.index!,
      /[^:]@|[A-Za-z]:/.test(match[0]) ? match.index! + match[0].length : -1,
    ]),
  )
  const bracketEnds = new Map<number, number>(),
    nestedBrackets = new Set<number>(),
    stack: number[] = []
  const imageAutolinks = new Set<number>()
  const parenEnds = new Map<number, number>(),
    parens: number[] = []
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (quote) {
      if (source[i] === quote || source[i] === '\n') quote = ''
      continue
    }
    if (parens.length && /[ \t]/.test(source[i - 1] ?? '') && /["']/.test(source[i]!)) {
      quote = source[i]!
      continue
    }
    if (source[i] === '(') parens.push(i)
    if (source[i] === ')' && parens.length) parenEnds.set(parens.pop()!, i)
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    const angleEnd = angleEnds.get(i)
    if (angleEnd !== undefined && angleEnd > i) {
      i = angleEnd - 1
      continue
    }
    if (source[i] === '[') {
      if (stack.length) nestedBrackets.add(stack.at(-1)!)
      stack.push(i)
    }
    if (source[i] === ']' && stack.length) bracketEnds.set(stack.pop()!, i)
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    let end: number | undefined
    if (source[i] === '{' && mask[i] === '{') end = readAttributes(source, i)?.end
    if (source[i] === '!' && mask[i] === '!' && source[i + 1] === '[') {
      const close = bracketEnds.get(i + 1)
      if (close !== undefined && /[([]/.test(source[close + 1] ?? '')) {
        const angles: number[] = []
        let plain = true
        for (let at = i + 2; at < close; at++) {
          const angleEnd = angleEnds.get(at)
          if (angleEnd !== undefined && angleEnd > at && angleEnd <= close) {
            angles.push(at)
            at = angleEnd - 1
          } else if ('`{_*~^\\['.includes(source[at]!)) {
            plain = false
            break
          }
        }
        if (plain) for (const at of angles) imageAutolinks.add(at)
        end = close + 1
      }
    }
    if (source[i] === ']' && source[i + 1] === '[') {
      const close = bracketEnds.get(i + 1)
      if (close !== undefined) end = close + 1
    }
    if (source[i] === ']' && source[i + 1] === '(') {
      const close = parenEnds.get(i + 1)
      if (close !== undefined) end = close + 1
    }
    if (source[i] === '[' && source[i + 1] === '^') {
      const close = bracketEnds.get(i)
      if (close !== undefined && !nestedBrackets.has(i)) end = close + 1
    }
    if (end !== undefined) {
      for (let at = i; at < end; at++) if (mask[at] !== '\n') mask[at] = ' '
      i = end - 1
    }
  }
  const parts: string[] = []
  let copied = 0,
    line = 0,
    offset = 0
  for (const match of source.matchAll(/<([^<>\s]+)>/g)) {
    const at = match.index!,
      end = at + match[0].length
    while (offset < at) {
      if (source[offset] === '\n') line++
      offset++
    }
    const image = imageAutolinks.has(at) && codeMask[at] === '<'
    if ((!image && mask[at] !== '<') || isDjotEscaped(source, at)) continue
    const body = match[1]!
    // A body that already carries a scheme is a URL, not a bare address: djot.js
    // prefixes it with a second `mailto:` (jgm/djot.js#162), which we do not copy.
    const email = /[^:]@/.test(body) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(body)
    // Such an address keeps its autolink, but only where Carve reads one back: a dash
    // run or an ellipsis inside it becomes punctuation instead.
    const written =
      /[\[\]{}`|\\]/.test(body) ||
      (email && body.includes(':')) ||
      (!email && /[^:]@/.test(body) && /--|\.\.\./.test(body))
    if (!/[^:]@|[A-Za-z]:/.test(body) || (!image && !written)) continue
    if (rows[line] && /[|`]/.test(body)) continue
    const label = body.replace(/[!-\/:-@\[-`{-~]/g, (value) => '\\' + value)
    const destination = email ? 'mailto:' + body : body
    // carve#2854: a square bracket is not encoded. A Carve destination holds it
    // literally, balanced or not, so encoding it would change the href against a
    // body the angle form promises to show verbatim.
    const target = destination.replace(/[`|\\()]/g, (value) =>
      value === '\\' ? '\\\\' : '%' + value.charCodeAt(0).toString(16).toUpperCase(),
    )
    parts.push(source.slice(copied, at), image ? label : '[' + label + '](' + target + ')')
    copied = end
  }
  parts.push(source.slice(copied))
  return parts.join('')
}

function renameDjotPipeFootnotes(source: string): string {
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const prefix = 'carve-djot-footnote-'
  const reserved = new Set(Array.from(source.matchAll(/carve-djot-footnote-(\d+)/gi), (match) => Number(match[1])))
  let serial = 0
  const labels = new Map<string, string>(),
    definitionEnds = new Map<number, number>()
  for (const match of source.matchAll(/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\[\^([^\]\n]+)\]:/gm)) {
    const at = match.index! + match[0].indexOf('[')
    const key = match[1]!.replace(/\s+/g, ' ').trim()
    if (mask[at] === '[') definitionEnds.set(at, at + 2 + match[1]!.length)
    if (mask[at] === '[' && !key.includes('[') && key.includes('|') && !labels.has(key)) {
      while (reserved.has(serial)) serial++
      labels.set(key, prefix + serial++)
    }
  }
  if (labels.size === 0 && !source.includes('[^')) return source
  const parens = new Map<number, number>(),
    stack: number[] = []
  const rowRanges: [number, number][] = []
  let lineOffset = 0,
    previousRow = false,
    previousBlock = true
  for (const line of source.split('\n')) {
    const at = djotContentStart(line),
      end = line.trimEnd().length - 1
    const content = line.slice(at)
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(djotItemPrefix(line, at))
    const row: boolean =
      (previousBlock || previousRow || opensItem) &&
      line[at] === '|' &&
      mask[lineOffset + at] === '|' &&
      line[end] === '|' &&
      mask[lineOffset + end] === '|' &&
      line[end - 1] !== '\\'
    previousBlock = content.trim() === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]+\]:)/.test(content)
    previousRow = row
    if (row) rowRanges.push([lineOffset + at, lineOffset + line.length])
    if (row || content.trim() === '') stack.length = 0
    for (let i = 0; i < line.length; i++) {
      if (mask[lineOffset + i] === ' ') continue
      if (line[i] === '{') {
        const attrs = readAttributes(line, i)
        if (attrs) {
          i = attrs.end - 1
          continue
        }
      }
      if (line[i] === '\\' && /[!-\/:-@\[-`{-~]/.test(line[i + 1] ?? '')) {
        i++
        continue
      }
      if (row && line[i] === '|' && line[i - 1] !== '\\') stack.length = 0
      else if (line[i] === '(') stack.push(lineOffset + i)
      else if (line[i] === ')' && stack.length) parens.set(stack.pop()!, lineOffset + i)
    }
    if (row) stack.length = 0
    lineOffset += line.length + 1
  }
  let rowIndex = 0
  const out: string[] = [],
    images: boolean[] = []
  let imageDepth = 0
  for (let i = 0; i < source.length;) {
    if (source[i] === '\n' && /^\n[ \t]*\n/.test(source.slice(i))) {
      images.length = 0
      imageDepth = 0
    }
    if (mask[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        out.push(source.slice(i, attrs.end))
        i = attrs.end
        continue
      }
    }
    if (mask[i] === ' ') {
      out.push(source[i++]!)
      continue
    }
    if (source[i] === '\\') {
      out.push(source[i++]!)
      if (/[!-\/:-@\[-`{-~]/.test(source[i] ?? '')) out.push(source[i++]!)
      continue
    }
    while (rowRanges[rowIndex] && rowRanges[rowIndex]![1] <= i) rowIndex++
    const inRow = rowRanges[rowIndex] !== undefined && rowRanges[rowIndex]![0] <= i
    if (inRow && source[i] === '|' && source[i - 1] !== '\\') {
      images.length = 0
      imageDepth = 0
    }
    if (source.startsWith('[^', i)) {
      let end = i + 2
      while (end < source.length && !'[]\n'.includes(source[end]!)) end++
      if (source[end] === '[') {
        const definitionEnd = definitionEnds.get(i)
        if (definitionEnd !== undefined) {
          out.push(source.slice(i, definitionEnd + 1))
          i = definitionEnd + 1
          continue
        }
        out.push('\\[^')
        i += 2
        continue
      }
      if (source[end] === ']') {
        const label = source.slice(i + 2, end)
        const rawPipe = inRow && /(^|[^\\])\|/.test(label)
        if (rawPipe) {
          images.length = 0
          imageDepth = 0
        }
        const renamed = imageDepth === 0 && !rawPipe ? labels.get(label.replace(/\s+/g, ' ').trim()) : undefined
        out.push(renamed === undefined ? source.slice(i, end + 1) : `[^${renamed}]`)
        i = end + 1
        continue
      }
    }
    if (source[i] === '[') {
      const image = source[i - 1] === '!'
      images.push(image)
      if (image) imageDepth++
    } else if (source[i] === ']' && images.length) {
      if (images.pop()) imageDepth--
      const end = source[i + 1] === '(' ? parens.get(i + 1) : undefined
      if (end !== undefined) {
        out.push(source.slice(i, end + 1))
        i = end + 1
        continue
      }
    }
    out.push(source[i++]!)
  }
  return out.join('')
}

function closeDjotTableCode(source: string, onRawCode?: (at: number) => void): string {
  if (!source.includes('`')) return source
  const blockAttributes = (value: string): boolean => {
    const attrs = value.startsWith('{') ? readAttributes(value, 0) : undefined
    return attrs !== undefined && /^[ \t]*$/.test(value.slice(attrs.end))
  }
  const mask = maskDjotOpaque(maskDjotFences(source), false, { code: false })
  const runs = new Map<number, number[]>()
  for (const run of source.matchAll(/`+/g)) {
    const positions = runs.get(run[0].length) ?? []
    positions.push(run.index!)
    runs.set(run[0].length, positions)
  }
  const closeRun = (open: number, width: number): number => {
    const positions = runs.get(width) ?? []
    let low = 0,
      high = positions.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (positions[mid]! < open + width) low = mid + 1
      else high = mid
    }
    return positions[low] ?? source.length
  }
  const tickStarts: number[] = [],
    tickWidths: number[] = []
  const queryEnd =
    source.includes('![') || source.includes('[^') || source.includes('](')
      ? Math.max(source.lastIndexOf(']'), source.lastIndexOf(')'))
      : 0
  for (let at = 0; at < queryEnd;) {
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) {
      at += 2
      continue
    }
    if (source[at] !== '`') {
      at++
      continue
    }
    let width = 1
    while (source[at + width] === '`') width++
    tickStarts.push(at)
    tickWidths.push(width)
    at += width
  }
  const tickIndex = (position: number): number => {
    let low = 0,
      high = tickStarts.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (tickStarts[mid]! < position) low = mid + 1
      else high = mid
    }
    return low
  }
  const count = tickStarts.length
  const next = Array<number>(count + 1).fill(count),
    ends = Array<number>(count + 1).fill(source.length + 1)
  const jumps = Array<number>(count + 1).fill(count),
    depths = Array<number>(count + 1).fill(0)
  // Merge equal-length ancestor jumps so each tick stores one pointer.
  for (let at = count - 1; at >= 0; at--) {
    const finish = closeRun(tickStarts[at]!, tickWidths[at]!) + tickWidths[at]!
    const parent = tickIndex(finish),
      jump = jumps[parent]!,
      farther = jumps[jump]!
    next[at] = parent
    ends[at] = finish
    depths[at] = depths[parent]! + 1
    jumps[at] = depths[parent]! - depths[jump]! === depths[jump]! - depths[farther]! ? farther : parent
  }
  const balancedTicks = (from: number, end: number): boolean => {
    let at = tickIndex(from)
    while (at < count && tickStarts[at]! < end) {
      const jump = jumps[at]!
      if (jump < count && ends[jump]! <= end) at = jump
      else if (ends[at]! <= end) at = next[at]!
      else return false
    }
    return true
  }
  const parens = new Map<number, number>(),
    labels = new Map<number, number>()
  const parenthesisStack: number[] = [],
    bracketStack: number[] = []
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) {
      at++
      continue
    }
    if (source[at] === '(') parenthesisStack.push(at)
    else if (source[at] === ')' && parenthesisStack.length) parens.set(parenthesisStack.pop()!, at)
    else if (source[at] === '[') bracketStack.push(at)
    else if (source[at] === ']' && bracketStack.length) labels.set(bracketStack.pop()!, at)
  }
  const imageParagraphValid = source.includes('![') ? djotImageBoundaryIndex(source, mask) : undefined
  const block =
    /^(?:[-*+] |(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)] |\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\) |: |#{1,6} |`{3,}|~{3,}|:{3,}(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$|>(?:[ \t]|$)|\||\^ |\[[^\]]+\]:)/
  const marker =
    /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+)/
  const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/y
  let offset = 0,
    cursor = 0,
    consumed = 0,
    codeHostDepth = 0,
    itemColumn = 0,
    itemQuote = 0,
    previousQuote = 0
  let itemKind = '',
    previousBlock = true
  let fenced: { width: number; ch: string; depth: number; column: number; item: number } | undefined
  const divs: { width: number; depth: number; column: number; at: number }[] = []
  const output: string[] = []
  for (const line of source.split('\n')) {
    const at = djotContentStart(line),
      lineEnd = offset + line.length
    let codeDepth = 0, prefixAt = 0
    while (prefixAt < line.length) {
      const rest = line.slice(prefixAt), space = /^[ \t]*/.exec(rest)![0].length
      prefixAt += space
      const content = line.slice(prefixAt)
      const quote = /^>(?:[ \t]|$)/.exec(content)
      if (quote) { codeDepth++; prefixAt += quote[0].length; continue }
      const itemPrefix = marker.exec(content)
      if (!itemPrefix) break
      prefixAt += itemPrefix[0].length
      if (/^[-*+]/.test(itemPrefix[0])) {
        const task = /^\[[ xX]\][ \t]+/.exec(line.slice(prefixAt))
        if (task) prefixAt += task[0].length
      }
    }
    const [parsedDepth, content] = quoted(line),
      trimmed = trimStartNonNbsp(content)
    const indent = content.length - trimmed.length
    let item = marker.exec(trimmed)
    if (item?.[0].startsWith('[^') && !previousBlock && parsedDepth >= previousQuote && !(itemColumn > 0 && parsedDepth === itemQuote && indent < itemColumn)) item = null
    const oldColumn = itemColumn,
      oldQuote = itemQuote
    const beganInside = offset < consumed
    const depth = beganInside ? codeHostDepth : parsedDepth
    if (beganInside) codeDepth = codeHostDepth
    else if (!previousBlock && parsedDepth < previousQuote && trimmed && !block.test(trimmed))
      codeDepth = Math.max(codeDepth, previousQuote)
    if (!beganInside) {
      if (fenced && trimmed && (depth < fenced.depth || (depth === fenced.depth && indent < fenced.item)))
        fenced = undefined
      if (fenced) {
        if (
          depth === fenced.depth &&
          indent <= fenced.column &&
          new RegExp(`^${fenced.ch}{${fenced.width},}[ \t]*$`).test(trimmed)
        ) {
          fenced = undefined
          previousBlock = true
        }
        offset = lineEnd + 1
        continue
      }
      const opening = /^(`{3,}|~{3,})[ \t]*=?[a-zA-Z0-9_+#.-]*$/.exec(line.slice(at))
      if (opening && (previousBlock || item)) {
        if (!item && (depth < itemQuote || (depth === itemQuote && indent < itemColumn))) {
          itemColumn = indent
          itemQuote = depth
          itemKind = ''
        }
        fenced = {
          width: opening[1]!.length,
          ch: opening[1]![0]!,
          depth,
          column: at,
          item: item ? indent + (item[0].startsWith('[^') ? 2 : item[0].length) : Math.min(itemColumn, indent),
        }
        offset = lineEnd + 1
        continue
      }
    }
    if (offset >= consumed) {
      if (item) {
        itemColumn = indent + 1
        itemQuote = depth
        itemKind = item[0]
          .replace(/^[0-9]+/, '1')
          .replace(/^[A-Za-z]+/, 'a')
          .trim()
      } else if (trimmed && itemColumn > 0) {
        let ownerContent = line
        for (let q = 0; q < itemQuote; q++) {
          const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(ownerContent)
          if (!prefix) break
          ownerContent = ownerContent.slice(prefix[0].length)
        }
        const ownerText = trimStartNonNbsp(ownerContent)
        const ownerIndent = ownerContent.length - ownerText.length
        if (depth < itemQuote || (ownerIndent < itemColumn && (previousBlock || block.test(ownerText) || blockAttributes(ownerText)))) {
          itemColumn = 0
          itemKind = ''
        }
      }
      const div = /^(:{3,})(?:[ \t]+\S.*)?[ \t]*$/.exec(line.slice(at))
      if (div) {
        const owner = divs.at(-1)
        if (owner && depth === owner.depth && /^:{3,}[ \t]*$/.test(line.slice(at)) && div[1]!.length >= owner.width)
          divs.pop()
        else if (mask[offset + at] !== ' ') divs.push({ width: div[1]!.length, depth, column: at, at: offset })
      }
      if (line[at] === '|' && ((oldColumn > 0 && depth <= oldQuote && indent < oldColumn) || depth < previousQuote)) {
        output.push(source.slice(cursor, offset), /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0].trimEnd(), '\n')
        cursor = offset
      }
      previousQuote = Math.max(depth, codeDepth)
    }
    let i = Math.max(offset + at, consumed)
    const pending: number[] = [],
      footnotes: number[] = []
    while (i < lineEnd) {
      if (mask[i] === ' ' && source[i] !== ' ') {
        i++
        continue
      }
      if (source[i] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[i + 1] ?? '')) {
        i += 2
        continue
      }
      if (source[i] === '{') {
        const attrs = readAttributes(source, i)
        if (attrs) {
          i = attrs.end
          continue
        }
      }
      if (source[i] === '<') {
        autolink.lastIndex = i
        const auto = autolink.exec(source)
        if (auto) {
          i += auto[0].length
          continue
        }
      }
      if (source.startsWith('![', i)) {
        const end = labels.get(i + 1)
        if (end !== undefined && balancedTicks(i + 2, end)) {
          if (end >= lineEnd && /[([]/.test(source[end + 1] ?? '') && imageParagraphValid?.(i, end, codeDepth, itemColumn, itemQuote, divs.at(-1)?.at)) { consumed = end + 1; codeHostDepth = codeDepth }
          i = end + 1
          continue
        }
      }
      if (source.startsWith('[^', i)) {
        let end = i + 2
        while (end < lineEnd && !'[]'.includes(source[end]!)) end++
        if (source[end] === ']' && balancedTicks(i + 2, end)) {
          i = end + 1
          continue
        }
        footnotes.push(i)
      }
      if (source[i] === ']' && source[i + 1] === '(') {
        const end = parens.get(i + 1)
        if (end !== undefined && end <= lineEnd && balancedTicks(i + 2, end)) {
          i = end + 1
          continue
        }
      }
      if (source[i] === ']') footnotes.length = 0
      if (source[i] === '(') pending.push(i)
      else if (source[i] === ')') pending.pop()
      if (source[i] !== '`') {
        i++
        continue
      }
      let width = 1
      while (source[i + width] === '`') width++
      codeHostDepth = codeDepth
      const candidate = closeRun(i, width)
      if (candidate + width <= lineEnd) {
        i = candidate + width
        consumed = i
        continue
      }
      let limit = Math.min(candidate, source.length),
        separate = false,
        separateDepth = 0
      for (let next = lineEnd + 1; next < limit;) {
        const newline = source.indexOf('\n', next),
          end = newline < 0 ? source.length : newline
        const following = source.slice(next, end),
          [nextDepth, nextContent] = quoted(following),
          nextTrimmed = trimStartNonNbsp(nextContent)
        const nextIndent = nextContent.length - nextTrimmed.length
        let ownerContent = following
        for (let q = 0; q < itemQuote; q++) {
          const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(ownerContent)
          if (!prefix) break
          ownerContent = ownerContent.slice(prefix[0].length)
        }
        const ownerIndent = ownerContent.length - trimStartNonNbsp(ownerContent).length
        const outside =
          (codeDepth > 0 && nextDepth < codeDepth) || (itemColumn > 0 && ownerIndent < itemColumn)
        if ((nextDepth <= codeDepth || outside) && trimNonNbsp(nextContent) === '') {
          limit = next - 1
          break
        }
        const owner = divs.at(-1)
        const closesDiv =
          owner &&
          nextDepth === owner.depth &&
          nextIndent <= owner.column + 3 &&
          /^:{3,}[ \t]*$/.test(nextTrimmed) &&
          nextTrimmed.trim().length >= owner.width
        const attributes = blockAttributes(nextTrimmed)
        if (closesDiv || (outside && (block.test(nextTrimmed) || (itemColumn > 0 && ownerIndent < itemColumn && block.test(trimStartNonNbsp(ownerContent))) || attributes))) {
          limit = next - 1
          const nextItem = marker
            .exec(nextTrimmed)?.[0]
            .replace(/^[0-9]+/, '1')
            .replace(/^[A-Za-z]+/, 'a')
            .trim()
          separate = outside && (nextDepth < depth || nextItem !== itemKind)
          separateDepth = Math.min(depth, nextDepth)
          break
        }
        if (newline < 0) break
        next = newline + 1
      }
      const closed = candidate <= limit && candidate < source.length
      const end = closed ? candidate : limit
      let payload = source
        .slice(i + width, !closed && source[end - 1] === '\n' ? end - 1 : end)
        .replace(/^ `/, '`')
        .replace(/` $/, '`')
      const normalized = payload.split('\n').map((value, n) => {
        if (n === 0) return value
        for (let q = 0; q < codeDepth; q++) {
          const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(value)
          if (!prefix) break
          value = value.slice(prefix[0].length)
        }
        return trimStartNonNbsp(value)
      })
      const rawCode =
        normalized
          .slice(1)
          .some(
            (value) =>
              (block.test(value) || value.startsWith(':::') || value.startsWith('{')) && (!/^\|[ \t:|-]*\|$/.test(value) || line[at] !== '|'),
          ) ||
        (itemColumn > 0 && itemKind.startsWith('[^') && normalized.length > 1)
      if (codeDepth > 0 && !rawCode) payload = normalized.join('\n')
      let codeEnd = closed ? end + width : end
      let codeTag = '<code>'
      if (rawCode && closed && source[codeEnd] === '{') {
        const parts: string[] = []
        while (source[codeEnd] === '{') {
          const attrs = readAttributes(source, codeEnd)
          if (!attrs) break
          parts.push(attrs.source.slice(1, -1))
          codeEnd = attrs.end
        }
        if (parts.length) {
          const html = renderHtml(parse('`X`{' + parts.join(' ') + '}'))
          codeTag = /<code\b[^>]*>/.exec(html)?.[0] ?? codeTag
        }
      }
      if (rawCode) {
        onRawCode?.(i)
        payload =
          codeTag + normalized.join('\n').replace(/[!-\/:-@\[-`{-~]|\n/g, (ch) => `&#${ch.charCodeAt(0)};`) + '</code>'
      }
      let fenceWidth = 1
      for (const run of payload.matchAll(/`+/g)) fenceWidth = Math.max(fenceWidth, run[0].length + 1)
      const fence = '`'.repeat(fenceWidth)
      const escapes = [...pending.filter((k) => source[k - 1] === ']'), ...footnotes].sort((a, b) => a - b)
      for (const escape of escapes) {
        output.push(source.slice(cursor, escape), '\\')
        cursor = escape
      }
      const pad = payload.startsWith('`') || payload.endsWith('`') ? ' ' : ''
      output.push(source.slice(cursor, i), fence + pad + payload + pad + fence + (rawCode ? '{=html}' : ''))
      cursor = codeEnd
      consumed = cursor
      if (separate && !closed) output.push('\n' + '> '.repeat(separateDepth).trimEnd())
      i = consumed
    }
    previousBlock =
      !beganInside &&
      consumed <= lineEnd &&
      (trimmed === '' ||
        /^(?:#{1,6} |:{3,}(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$|\[[^\]]+\]:)/.test(trimmed) ||
        blockAttributes(trimmed) ||
        (line[at] === '|' && line.trimEnd().endsWith('|') && !line.trimEnd().endsWith('\\|')))
    offset = lineEnd + 1
  }
  output.push(source.slice(cursor))
  return output.join('')
}

function escapeDjotNonTableRows(source: string): string {
  if (!source.includes('|')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false, autolinks: false, attributeValues: false })
  const rows = djotTableRows(source, mask)
  let offset = 0
  return source.split('\n').map((line, n) => {
    const start = djotContentStart(line), end = line.trimEnd().length - 1
    const escape = !rows[n] && line[start] === '|' && line[end] === '|' && mask[offset + start] === '|' && mask[offset + end] !== '|'
    offset += line.length + 1
    return escape ? line.slice(0, start) + '\\' + line.slice(start) : line
  }).join('\n')
}

function normalizeDjotTablePipes(source: string): string {
  if (!source.includes('\\|')) return source
  source = renameDjotPipeFootnotes(source)
  const mask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], {
    autolinks: false,
    attributeValues: false,
    destinations: false,
  })
  const lines = source.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  const rowFlags = djotTableRows(source, mask)
  const definitions = new Map<string, { target: string; attrs: string }>()
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!,
      at = djotContentStart(line)
    if (mask[offsets[n]! + at] !== '[') continue
    const definition = /^\[([^\[\]\n^][^\[\]\n]*)\]:[ \t]*([^ \t\r\n]*)\r?$/.exec(line.slice(at))
    if (!definition || !definition[1]!.includes('|')) continue
    const previousLine = lines[n - 1] ?? '',
      previousAt = djotContentStart(previousLine)
    const previous = previousLine.slice(previousAt).trim()
    const quoteDepth = (value: string) => value.split('>').length - 1
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(djotItemPrefix(line, at))
    const previousAttrs = previous.startsWith('{') ? readAttributes(previous, 0) : undefined
    if (
      previous !== '' &&
      !rowFlags[n - 1] &&
      at >= previousAt &&
      !/^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$/.test(previous) &&
      !/^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\[[^\]]+\]:)/.test(previous) &&
      previousAttrs?.end !== previous.length &&
      !opensItem &&
      quoteDepth(line.slice(0, at)) <= quoteDepth(previousLine.slice(0, previousAt))
    ) {
      lines[n] = line.slice(0, at) + '\\' + line.slice(at)
      continue
    }
    let target = definition[2]!
    let end = n
    while (end + 1 < lines.length) {
      const next = lines[end + 1]!,
        nextAt = djotContentStart(next)
      if (nextAt <= at || !/^\S+$/.test(next.slice(nextAt)) || mask[offsets[end + 1]! + nextAt] === ' ') break
      target += next.slice(nextAt)
      end++
    }
    if (!target) continue
    const attributeParts: string[] = []
    for (let k = n - 1; k >= 0; k--) {
      const value = lines[k]!.slice(djotContentStart(lines[k]!)).trim()
      const parsed = value.startsWith('{') ? readAttributes(value, 0) : undefined
      if (!parsed || parsed.end !== value.length) break
      attributeParts.push(value)
    }
    definitions.set(definition[1]!.replace(/\s+/g, ' ').trim(), { target, attrs: attributeParts.reverse().join('') })
    lines[n] = line.slice(0, at) + `[${definition[1]}]: ${target}`
    for (let k = n + 1; k <= end; k++) lines[k] = ''
  }
  const punctuation = (char: string | undefined) => char !== undefined && /[!-\/:-@\[-`{-~]/.test(char)
  const decode = (label: string) =>
    label
      .replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  return lines
    .map((line, n) => {
      const at = djotContentStart(line),
        lineMask = mask.slice(offsets[n]!, offsets[n]! + line.length)
      const row = line[at] === '|' && lineMask[at] === '|'
      if (!row) return line
      if (!rowFlags[n]) return line.slice(0, at) + '\\' + line.slice(at)
      const brackets = new Map<number, number>(),
        parens = new Map<number, number>()
      const bracketStack: number[] = [],
        parenStack: number[] = []
      for (let i = at; i < line.length; i++) {
        if (lineMask[i] === ' ') continue
        if (line[i] === '{') {
          const attrs = readAttributes(line, i)
          if (attrs) {
            i = attrs.end - 1
            continue
          }
        }
        if (line[i] === '|' && line[i - 1] !== '\\') {
          bracketStack.length = 0
          parenStack.length = 0
          continue
        }
        if (line[i] === '\\') {
          const begin = i
          while (line[i] === '\\') i++
          if ((i - begin) % 2 !== 0 && punctuation(line[i])) continue
          i--
          continue
        }
        if (line[i] === '[') bracketStack.push(i)
        else if (line[i] === ']' && bracketStack.length) brackets.set(bracketStack.pop()!, i)
        else if (line[i] === '(') parenStack.push(i)
        else if (line[i] === ')' && parenStack.length) parens.set(parenStack.pop()!, i)
      }
      const destinations = new Int32Array(line.length + 1)
      const references = new Map<number, { end: number; text: string }>()
      for (const [open, close] of brackets) {
        if (line[open + 1] === '^') continue
        const next = close + 1
        if (line[next] === '(' && parens.has(next)) {
          const last = parens.get(next)!
          destinations[next + 1] = destinations[next + 1]! + 1
          destinations[last] = destinations[last]! - 1
        } else if (line[next] === '[' && brackets.has(next) && !references.has(open)) {
          const last = brackets.get(next)!
          const key = decode(line.slice(next + 1, last) || line.slice(open + 1, close))
          const definition = definitions.get(key)
          if (!definition) continue
          const target = definition.target.replace(
            /[\\|()<> ]/g,
            (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
          )
          references.set(next, {
            end: last + 1,
            text: `(${target})${definition.attrs.replace(/\\+\|?|\|/g, (value) => (value.endsWith('|') && (value.length - 1) % 2 === 0 ? value.slice(0, -1) + '\\|' : value))}`,
          })
        }
      }
      for (let k = 1; k < line.length; k++) destinations[k] = destinations[k]! + destinations[k - 1]!
      const output: string[] = []
      for (let i = 0; i < line.length;) {
        const reference = references.get(i)
        if (reference) {
          output.push(reference.text)
          i = reference.end
          continue
        }
        if (lineMask[i] === ' ' || line[i] !== '\\') {
          output.push(line[i++]!)
          continue
        }
        const begin = i
        while (line[i] === '\\') i++
        const run = i - begin
        if (line[i] !== '|') {
          output.push(line.slice(begin, i))
          if (run % 2 !== 0 && punctuation(line[i])) output.push(line[i++]!)
          continue
        }
        output.push(
          destinations[begin]! > 0
            ? '%5C'.repeat(Math.floor(run / 2)) + '%7C'
            : '\\'.repeat(run + (run % 2 === 0 ? 1 : 0)) + '|',
        )
        i++
      }
      return output.join('')
    })
    .join('\n')
}

export interface DjotFootnoteAttributeLoss { line: number }

export function stripDjotFootnoteDefinitionAttributes(input: string): { source: string; losses: DjotFootnoteAttributeLoss[]; restore: (text: string) => string; isBoundary: (line: string) => boolean } {
  const source = input.replace(/\r\n?/g, '\n')
  if (!source.includes('{') || !source.includes('[^')) return { source, losses: [], restore: text => text, isBoundary: () => false }
  const [frontmatter, separator, body] = splitSiteFrontmatter(source)
  const header = frontmatter === '' ? '' : frontmatter + separator
  const headerLines = header.split('\n').length - 1
  const fenceLines = new Set<number>()
  maskDjotFences(body, line => { fenceLines.add(line) }, [], true)
  const mask = maskDjotCodeAndDestinations(body, false, true, false)
  const lines = body.split('\n'), losses: DjotFootnoteAttributeLoss[] = []
  const reserved = new Set([...source.matchAll(/\0DJOTNOTEATTR\x00(\d+)\0/g)].map(match => Number(match[1])))
  const comments = new Set<number>()
  let serial = 0
  let offset = 0, boundary = true, pending: Array<{ line: number; end: number; start: number; wire: string }> = [], quoteDepth = 0
  const noteParents: number[] = []
  let metadataNote = false
  let consumedUntil = -1
  let dedent: { column: number; delta: number; depth: number } | undefined
  let listColumn: number | undefined, listQuoteDepth = 0
  let heading = false, table = false, noteColumn: number | undefined, referenceColumn: number | undefined
  const divWidths: number[] = []
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    if (offset < consumedUntil) { offset += line.length + 1; continue }
    const prefix = /^(?:[ \t]*>[ \t]?|[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)*[ \t]*/.exec(line)![0]
    const content = line.slice(prefix.length).replace(/[ \t]+$/, '')
    const depth = (prefix.match(/>/g) ?? []).length
    const marker = /[-*+.)]/.test(prefix)
    let column = prefix.replace(/^(?:[ \t]*>[ \t]?)*/, '').length
    if (mask[offset + prefix.length] !== ' ' && prefix.includes('\t') && (boundary || pending.length > 0 || listColumn !== undefined)) {
      if (!marker && listColumn !== undefined && depth === listQuoteDepth && column === listColumn - 1) {
        column = listColumn
        const quotes = /^(?:[ \t]*>[ \t]?)*/.exec(prefix)![0]
        lines[n] = quotes.replaceAll('\t', ' ') + ' '.repeat(column) + line.slice(prefix.length)
      } else lines[n] = prefix.replaceAll('\t', ' ') + line.slice(prefix.length)
    }
    if (dedent) {
      const quotes = /^(?:[ \t]*>[ \t]?)*/.exec(line)![0]
      const indent = /^[ \t]*/.exec(line.slice(quotes.length))![0].length
      if (content !== '' && (depth !== dedent.depth || indent < dedent.column)) dedent = undefined
      else if (content !== '') lines[n] = quotes + line.slice(quotes.length + dedent.delta)
    }
    let exitedNote = false
    while (noteColumn !== undefined && content !== '' && column + 1 < noteColumn) {
      exitedNote = true
      if (metadataNote && listColumn !== undefined && column >= listColumn && n > 0 && /^[ \t]*$/.test(lines[n - 1]!)) {
        while (reserved.has(serial)) serial++
        comments.add(serial)
        lines[n - 1] = ' '.repeat(listColumn) + `\0DJOTNOTEATTR\x00${serial++}\0`
      }
      noteColumn = noteParents.pop(); metadataNote = false; boundary = true
    }
    if (noteColumn !== undefined && content !== '' && column === noteColumn - 1) {
      const raw = lines[n]!, quotes = /^(?:[ \t]*>[ \t]?)*/.exec(raw)![0]
      lines[n] = quotes + ' ' + raw.slice(quotes.length)
      column++
    }
    const parentNoteColumn = noteColumn
    if (depth < quoteDepth) { boundary = true; heading = false }
    if (listColumn !== undefined && (depth !== listQuoteDepth || content !== '' && !marker && column < listColumn)) {
      listColumn = undefined; boundary = true; heading = false
    }
    const opensItem: boolean = marker && (boundary || pending.length > 0 || listColumn !== undefined)
    const opensQuote: boolean = depth > quoteDepth && (boundary || pending.length > 0 || opensItem)
    if (opensItem || opensQuote) { pending = []; heading = false }
    if (opensItem) { listColumn = column; listQuoteDepth = depth }
    if (opensQuote || depth < quoteDepth) quoteDepth = depth
    if (referenceColumn !== undefined) {
      if (content !== '' && column > referenceColumn && !marker && /^\S+$/.test(content)) {
        offset += line.length + 1; boundary = false; pending = []; continue
      }
      referenceColumn = undefined
      if (content !== '') boundary = true
    }
    const blockAllowed: boolean = boundary || pending.length > 0 || opensItem || opensQuote
    let handledNote = false
    const attrs = content.startsWith('{') && mask[offset + prefix.length] === '{' ? readAttributes(body, offset + prefix.length) : undefined
    const trailingEnd = attrs ? body.indexOf('\n', attrs.end) : -1
    const standalone = attrs !== undefined && /^[ \t]*$/.test(body.slice(attrs.end, trailingEnd < 0 ? body.length : trailingEnd))
    if (standalone && (boundary || pending.length > 0 || opensItem || opensQuote)) {
      pending.push({ line: n, end: attrs!.end, start: offset, wire: attrs!.source })
      consumedUntil = attrs!.end
    } else if (content !== '') {
      if (pending.length && /^\[\^[^\]\n]+\]:(?:[ \t]|$)/.test(content) && mask[offset + prefix.length] === '[') {
        handledNote = true
        const quotePrefix = /^(?:[ \t]*>[ \t]?)*/.exec(prefix)![0]
        const targetColumn = Math.max(listColumn ?? 0, parentNoteColumn ?? 0)
        const notePrefix = quotePrefix + ' '.repeat(targetColumn)
        if (column > targetColumn) dedent = { column, delta: column - targetColumn, depth }
        lines[n] = notePrefix + line.slice(prefix.length)
        for (const group of pending) {
          if (group.wire !== '{}') losses.push({ line: headerLines + group.line + 1 })
          let end = group.line, position = group.start
          while (end < n && position < group.end) {
            const raw = lines[end]!
            const lead = end === group.line ? raw.slice(0, raw.indexOf('{')) : /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(raw)![0]
            while (reserved.has(serial)) serial++
            comments.add(serial)
            lines[end] = lead + `\0DJOTNOTEATTR\x00${serial++}\0`
            position += raw.length + 1; end++
          }
        }
      }
      if (content !== '') pending = []
    }
    const reference: boolean = blockAllowed && mask[offset + prefix.length] === '[' && /^\[(?!\^)[^\]\n]*\]:(?:[ \t]+\S*[ \t]*|)$/.test(content)
    if (reference) { referenceColumn = column; heading = false }
    const note = /^\[\^[^\]\n]+\]:(?:[ \t]|$)/.exec(content)
    if (note && blockAllowed && mask[offset + prefix.length] === '[') {
      if (noteColumn !== undefined) noteParents.push(noteColumn)
      noteColumn = column + 2; metadataNote = handledNote; heading = false
    }
    if (standalone || fenceLines.has(n) || content === '') heading = false
    else if (blockAllowed && /^#{1,6}(?:[ \t]|$)/.test(content)) heading = true
    const row: boolean = (blockAllowed || table) && content.startsWith('|') && content.endsWith('|') && mask[offset + prefix.length] === '|' && !isDjotEscaped(body, offset + line.replace(/[ \t]+$/, '').length - 1)
    table = row
    const colon = /^(:{3,})(?:[ \t].*)?$/.exec(content)
    let div = false
    if (colon && (blockAllowed || divWidths.length > 0 && /^:{3,}$/.test(content))) {
      div = true
      if (divWidths.length > 0 && /^:{3,}$/.test(content) && colon[1]!.length >= divWidths.at(-1)!) divWidths.pop()
      else divWidths.push(colon[1]!.length)
      heading = false
    }
    boundary = content === '' || reference || fenceLines.has(n) || row || div || heading || blockAllowed && /^(?:[-*][ \t]*){3,}$/.test(content)
    if (exitedNote && !marker && content.startsWith('{') && readAttributes(content, 0)?.end === content.length && n > 0 && lines[n - 1]!.trim() !== '') lines[n] = prefix + '\n' + lines[n]
    offset += line.length + 1
  }
  return { source: header + lines.join('\n'), losses, isBoundary: line => { const token = /\0DJOTNOTEATTR\x00(\d+)\0$/.exec(line.replace(/[ \t]+$/, '')); return token !== null && comments.has(Number(token[1])) }, restore: text => text.replace(/\0DJOTNOTEATTR\x00(\d+)\0/g, (value, index: string) => comments.has(Number(index)) ? '%%' : value) }
}
