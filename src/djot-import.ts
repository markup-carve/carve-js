import { trimEndMatchingEdges } from './trim-non-nbsp.js'
import { parse, hasInvalidContainerMetadata, colonFenceOpenerLen } from './parse.js'
import { renderPlainText } from './render-plain.js'
import { djotEmphasis } from './djot-emphasis.js'
import { attributedDjotWords } from './djot-word-attributes.js'
import { readAttributes } from './djot-attributes.js'
/* Convert Djot source to Carve without treating it as already-Carve source. */

import { escapePlainCarveInlineSyntax, HANDLED_DJOT } from './carve-escape.js'
import { applyMigrationFixes, isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences } from './djot-migrate.js'

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
    const prefix = /^[ \t]*>[ ]?/.exec(content)
    if (!prefix) return [depth, content]
    depth++
    content = content.slice(prefix[0].length)
  }
}

const isMarkerLine = (line: string): boolean =>
  /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+\S/.test(line)

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
    columns = line[chars] === '\t' ? columns + (4 - columns % 4) : columns + 1
    chars++
  }
  return [columns, chars]
}

function charsThroughColumns(line: string, wanted: number): number {
  let columns = 0
  let chars = 0
  while (chars < line.length && columns < wanted && (line[chars] === ' ' || line[chars] === '\t')) {
    columns = line[chars] === '\t' ? columns + (4 - columns % 4) : columns + 1
    chars++
  }
  return chars
}

/** Translate Djot definition-item structure without touching unrelated source. */
function convertDefinitionLists(source: string, emptyTerm: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const stack: Array<{ source: number; target: number; body: boolean; ready: boolean }> = []
  for (let i = 0; i < lines.length; i++) {
    const fenceCandidate = /^([ \t]*):[ \t]+(`{3,}|~{3,})(.*)$/.exec(lines[i]!)
    const rawFence = fenceCandidate && !(fenceCandidate[2]![0] === '`' && fenceCandidate[3]!.includes('`')) ? fenceCandidate : null
    const term = /^([ \t]*):[ \t]+(\S.*)$/.exec(masked[i] ?? '') ?? (fenceCandidate && masked[i]?.trimStart().startsWith(':') ? /^([ \t]*):[ \t]+(\S.*)$/.exec(lines[i]!) : null)
    if (term) {
      const [indent] = leadingIndent(term[1]!)
      while (stack.length && indent < stack.at(-1)!.source) stack.pop()
      const top = stack.at(-1)
      const mayStart = top !== undefined || i === 0 || lines[i - 1]!.trim() === ''
      if (mayStart) {
        const authoredTerm = /^([ \t]*):[ \t]+(\S.*)$/.exec(lines[i]!)
        const termText = authoredTerm?.[2] ?? term[2]!
        if (!top || indent === top.source) {
          const target = top?.target ?? indent
          if (!top) stack.push({ source: indent, target, body: false, ready: false })
          else {
            top.body = false
            top.ready = false
          }
          const prefix = ' '.repeat(target)
          lines[i] = `${top ? '' : `${prefix}{loose}\n`}${prefix}:: ${rawFence ? emptyTerm : termText}`
          if (rawFence) {
            lines[i] += `\n${prefix}:  ${termText}`
            stack.at(-1)!.body = true
            stack.at(-1)!.ready = true
          }
          continue
        }
        if (top.ready && indent >= top.source + 2) {
          const target = top.target + 3
          const lead = top.body ? ' '.repeat(target) : `${' '.repeat(top.target)}:  `
          top.body = true
          lines[i] = `${lead}{loose}\n${' '.repeat(target)}:: ${termText}`
          stack.push({ source: indent, target, body: false, ready: false })
          continue
        }
      }
    }
    if (!stack.length) continue
    if (lines[i]!.trim() === '') {
      stack.at(-1)!.ready = true
      continue
    }
    if (!stack.at(-1)!.ready) continue
    const [indent] = leadingIndent(lines[i]!)
    while (stack.length && indent < stack.at(-1)!.source + 2) stack.pop()
    const context = stack.at(-1)
    if (!context) continue
    const payload = lines[i]!.slice(charsThroughColumns(lines[i]!, context.source + 2))
    const extra = Math.max(0, indent - context.source - 2)
    lines[i] = context.body
      ? `${' '.repeat(context.target + 3 + extra)}${payload}`
      : `${' '.repeat(context.target)}:  ${' '.repeat(extra)}${payload}`
    context.body = true
  }
  return lines.join('\n')
}

/** Rewrite Djot block spellings that Carve does not recognize. */
function convertDjotBlockMarkers(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const containers: { width: number; invalid: boolean }[] = []
  const nested: boolean[] = []
  const ancestors: { columns: number; marker: boolean }[] = []
  for (const line of masked) {
    if (line.trim() === '') { nested.push(false); continue }
    const [columns] = leadingIndent(line)
    while (ancestors.length && ancestors.at(-1)!.columns >= columns) ancestors.pop()
    nested.push(ancestors.at(-1)?.marker ?? false)
    const marker = !/^(?:([*-])[ \t]*){3,}$/.test(line.trim()) && /^(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+\S/.test(line.trimStart())
    ancestors.push({ columns, marker })
  }
  for (let i = 0; i < lines.length; i++) {
    if ((masked[i] ?? '').trim() === '') continue
    let view = lines[i]!
    const prefix = /^(?:[ \t]*> ?|[ \t]*(?:(?:[-*+]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-zA-Z])[.)]|\([0-9A-Za-z]+\)) +(?:\[[ xX]\] +)?|: |\[\^[^\]\r\n]+\]: +))/
    let host: RegExpExecArray | null
    while ((host = prefix.exec(view))) view = view.slice(host[0].length)
    view = view.replace(/^[ \t]+/, '')
    const containerOffset = lines[i]!.length - view.length
    const container = view.startsWith(':::') && masked[i]!.slice(containerOffset).startsWith(':::')
      ? [view, lines[i]!.slice(0, containerOffset), view] : null
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
    const enclosed = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)\(([0-9A-Za-z]+)\)([ \t]+\S.*)$/.exec(masked[i]!)
    if (enclosed) {
      const authored = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)\(([0-9A-Za-z]+)\)([ \t]+\S.*)$/.exec(lines[i]!)
      if (authored) lines[i] = `${authored[1]}${enclosed[1] === '' && nested[i] ? authored[2] : ''}${authored[3]}.${authored[4]}`
      continue
    }
    const rule = /^((?:(?:[ \t]*>)+[ \t]*)?)([ \t]*)([*-])(?:[ \t]*\3){2,}[ \t]*$/.exec(masked[i]!)
    if (!rule) continue
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
      end + 1 < lines.length && !fenced[end + 1] &&
      parts[end + 1]![0] === depth && parts[end + 1]![1].trim() === ''
    ) end++
    const next = end + 1
    let above = i - 1
    while (above >= 0 && parts[above]![1].trim() === '') above--
    if (
      end - i + 1 >= 3 && next < lines.length && !fenced[next] &&
      parts[next]![0] === depth && isMarkerLine(parts[next]![1]) &&
      above >= 0 && parts[above]![0] === depth &&
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

function consumeOrphanDjotAttributes(source: string): { source: string; restore: (text: string) => string } {
  const masked = maskDjotCodeAndDestinations(source).replace(/\[\^[^\]\n]*\]/g, (value, at: number) => isDjotEscaped(source, at) ? value : ' '.repeat(value.length)).replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g, value => ' '.repeat(value.length)).split('\n')
  const item = String.raw`(?:[.#][A-Za-z0-9_][A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9_-]*=(?:"(?:\\.|[^"\\\n])*"|[A-Za-z0-9_:-]+))`
  const pattern = new RegExp(String.raw`\{[ \t]*${item}(?:[ \t]+${item})*[ \t]*\}`, 'g')
  const lines = source.split('\n')
  let prefix = '\x00DJOTORPHAN\x00'
  while (source.includes(prefix)) prefix += '\x00'
  const spaces: string[] = []
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
      const previous = (lines[index - 1] ?? '').replace(/^(?:(?:[ \t]*>)+[ \t]*)?[ \t]*/, '').trim()
      const block = index === 0 || previous === '' || /^\{.*\}$/.test(previous) || /^(?:`{3,}|~{3,}|:{3,}|#{1,6} |[-*+] |[0-9]+[.)] |> |:{1,2} |(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|\|.*\||\[[^\]]+\]:)/.test(previous)
      if (alone && block) { if ((lines[index + 1] ?? '').trim() !== '') return attrs; dropLine = true }
      orphanEnd = at + attrs.length
      return prefix + (at === first ? 'L' : 'I')
    }).replace(new RegExp(`${prefix}([LI])([ \t]*)`, 'g'), (_all, kind: string, space: string) => {
      spaces.push(kind === 'I' ? space : space === '' ? '{%%}' : `!\`${space}\``)
      return `${prefix}${spaces.length - 1}\x00`
    })
    return dropLine ? undefined : written
  }).filter(line => line !== undefined).join('\n')
  return { source: converted, restore: text => text.replace(new RegExp(`${prefix}(\\d+)\x00`, 'g'), (_all, index: string) => spaces[Number(index)]!) }
}

function escapeInvalidDjotAttributes(source: string): string {
  const masked = maskDjotCodeAndDestinations(source).replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g, value => ' '.repeat(value.length))
  const escapes: number[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || masked[i] !== '{') continue
    let slashes = 0
    for (let before = i - 1; before >= 0 && source[before] === '\\'; before--) slashes++
    if (slashes % 2) continue
    const attrs = readAttributes(source, i)
    if (attrs) { i = attrs.end - 1; continue }
    if (/[.#% \tA-Za-z]/.test(source[i + 1] ?? '')) { escapes.push(i); continue }

  }
  let output = '', cursor = 0
  for (const at of escapes) {
    output += source.slice(cursor, at) + '\\{' + (source[at + 1] === '#' ? '\\#' : '')
    cursor = at + (source[at + 1] === '#' ? 2 : 1)
  }
  return output + source.slice(cursor)
}

/** Escape plain Djot text while leaving code spans, fences and destinations opaque. */
function escapePlainDjotText(source: string): string {
  let masked = maskDjotCodeAndDestinations(source)
  if (source.includes('{')) {
    const chars = masked.split('')
    for (let at = 0; at < source.length; at++) {
      if (chars[at] !== '{' || isDjotEscaped(source, at)) continue
      const attrs = readAttributes(source, at)
      if (!attrs) continue
      for (let i = at; i < attrs.end; i++) if (chars[i] !== '\n') chars[i] = ' '
      at = attrs.end - 1
    }
    masked = chars.join('')
  }
  let output = ''
  let plain = ''
  for (let i = 0; i < source.length; i++) {
    if (masked[i] === ' ' && source[i] !== '\n') {
      if (plain !== '') {
        output += escapePlainCarveInlineSyntax(plain, HANDLED_DJOT)
        plain = ''
      }
      output += source[i]
    } else plain += source[i]
  }
  return output + escapePlainCarveInlineSyntax(plain, HANDLED_DJOT)
}

function foldHeadingContinuations(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const block = /^(?:[#>|{]|[-*+][ \t]|[0-9]+[.)][ \t]|:[ \t]|:{2,}|\([0-9a-zA-Z]+\)[ \t]|[`~]{3,}|\^[ \t]|%{3,}|\[[^\]\n]*\]:|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$)/
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!
    const heading = /^(#{1,6}) +\S/.exec(line)
    if (!heading || (i > 0 && lines[i - 1]!.trim() !== '') || !masked[i]!.startsWith('#')) {
      result.push(line)
      continue
    }
    const marker = new RegExp(`^${heading[1]} +`)
    while (i + 1 < lines.length && (line.length - trimEndMatchingEdges(line, (code) => code === 92).length) % 2 === 0) {
      const next = lines[i + 1]!.replace(/^[ \t]+/, '')
      let part: string
      if (marker.test(next)) {
        part = next.replace(marker, '')
        if (!part.trim()) break
      } else {
        if (!next.trim() || block.test(next)) break
        part = next
      }
      line += ` ${part}`
      i++
    }
    result.push(line)
  }
  return result.join('\n')
}

/** Convert a Djot document to Carve source. */
export function djotToCarve(djot: string): string {
  const strippedDefinitions = stripDjotFootnoteDefinitionAttributes(djot)
  const normalized = strippedDefinitions.source
  const [frontmatter, separator, body] = splitSiteFrontmatter(normalized)
  const convert = (text: string): string => {
    let emptyTerm = '\x00DJOTEMPTYTERM\x00'
    while (text.includes(emptyTerm)) emptyTerm += '\x00'
    const attrs = consumeOrphanDjotAttributes(convertDefinitionLists(convertDjotBlockMarkers(text), emptyTerm))
    return attrs.restore(collapseFalseListBoundaries(djotEmphasis(attrs.source, plain => applyMigrationFixes(escapePlainDjotText(plain), true).output))).replaceAll(emptyTerm, '%%')
  }
  const spans: string[] = []
  let prefix = '\x00DJOTSTRONG'
  while (body.includes(prefix)) prefix += '\x00'
  const normalizedBody = normalizeDjotFootnotes(foldDjotReferences(normalizeDjotFences(normalizeDjotAttributeLines(escapeInvalidDjotAttributes(body)))), strippedDefinitions.isBoundary)
  const headingFolded = foldHeadingContinuations(normalizeDjotTablePipes(normalizeDjotAutolinks(normalizeDjotLinks(normalizedBody))))
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
  const definitions = new Set(Array.from(headingFolded.matchAll(/^[ \t]*(?:>[ ]?)*(?:(?:[-*+]|[0-9]+[.)])[ \t]+)?\[([^\[\]\n]*)\]:[ \t]/gm)).filter(match => { const previous = (previousDefinitionLines.get(match.index!) ?? '').replace(/^[ \t]*(?:>[ ]?)*/, '').trim(); return collapsedMask[match.index! + match[0].indexOf('[')] === '[' && (previous === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%]|\[(?!\^)[^\]]*\]:)/.test(previous)) }).map(match => match[1]!))
  const rawFolded = headingFolded.replace(/(!?\[([^\[\]\n]*)\])\[\]/g, (value: string, label: string, key: string, at: number) => collapsedMask[at] !== ' ' && definitions.has(key) ? `${label}[${key}]` : value)
  const imageMask = maskDjotCodeAndDestinations(rawFolded)
  const folded = rawFolded.replace(/!\[([^\[\]\n]*)\](?=[([])/g, (image: string, label: string, at: number) => {
    if (imageMask[at] !== '!' || isDjotEscaped(rawFolded, at) || label.includes('\\')) return image
    if (!/[_*`{^~]/.test(label)) { spans.push(label); return `![${prefix}${spans.length - 1}\x00]` }
    spans.push(renderPlainText(parse(convert(`DJOTALT ${label} DJOTEND`)), { smartTypography: false }).replace(/ DJOTEND\n?$/, '').slice(8))
    return `![${prefix}${spans.length - 1}\x00]`
  })
  const wordMask = maskDjotCodeAndDestinations(folded).replace(/\[\^[^\]\n]*\]/g, (value, at: number) => isDjotEscaped(folded, at) ? value : ' '.repeat(value.length))
  const words = attributedDjotWords(folded, wordMask, convert, span => {
    spans.push(span)
    return `${prefix}${spans.length - 1}\x00`
  })
  const converted = convert(words).replace(new RegExp(`${prefix}(\\d+)\x00`, 'g'), (_all, index: string) => spans[Number(index)]!)
  return strippedDefinitions.restore(frontmatter === '' ? converted : `${frontmatter}${separator}${converted}`)
}


function normalizeDjotLinks(source: string): string {
  if (!source.includes('](')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const rows = djotTableRows(source, mask)
  const angles = new Map([...source.matchAll(/<[^<>\s]+>/g)].filter(match => /[^:]@|[A-Za-z]:/.test(match[0])).map(match => [match.index!, match.index! + match[0].length]))
  const quoteDepths = source.split("\n").map(line => (line.match(/^(?:[ \t]*>(?:[ \t]|$))*/)?.[0].match(/>/g) ?? []).length)
  const stack: { at: number; depth: number; labelEnd?: number; target?: number; parens: number }[] = []
  const pendingNotes = new Set<number>(), literalNotes = new Map<number, number>()
  const edits = new Map<number, { end: number; text: string }>()
  let line = 0
  let destinationOwner: typeof stack[number] | undefined
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') { line++; if (/^\n[ \t]*(?:>[ \t]*)*\n/.test(source.slice(i))) { stack.length = 0; destinationOwner = undefined; pendingNotes.clear(); continue } }
    if (mask[i] === ' ') continue
    if (source[i] === '\\') { i++; continue }
    const angle = angles.get(i); if (angle !== undefined) { i = angle - 1; continue }
    if (source[i] === '{') { const attrs = readAttributes(source, i); if (attrs) { i = attrs.end - 1; continue } }
    if (rows[line] && source[i] === '|' && source[i - 1] !== '\\') { stack.length = 0; destinationOwner = undefined; pendingNotes.clear(); continue }
    if (source[i] === '[') { if (stack.length >= 200) return source; stack.push({ at: i, depth: quoteDepths[line] ?? 0, parens: 0 }); if (source[i + 1] === '^') pendingNotes.add(i); continue }
    const tip = stack.at(-1)
    if (!tip) continue
    if (source[i] === ']') {
      if (source[tip.at + 1] === '^') { literalNotes.set(tip.at, i + 1); pendingNotes.delete(tip.at); stack.pop(); continue }
      if (source[i + 1] === '(') { if (destinationOwner && destinationOwner !== tip) edits.set(destinationOwner.at, { end: destinationOwner.at + 1, text: '\\[' }); tip.labelEnd = i; tip.target = i + 2; destinationOwner = tip; i++; continue }
      if (source[i + 1] === '[') { let end = i + 2; while (end < source.length && source[end] !== ']') { if (source[end] === '\\') end++; end++ }; if (source[end] === ']') { stack.pop(); i = end }; continue }
      if (source[i + 1] === '{' && readAttributes(source, i + 1)) stack.pop()
    }
    if (destinationOwner && source[i] === '(') destinationOwner.parens++
    if (source[i] === ')') {
      const owner = destinationOwner
      if (!owner) continue
      if (owner.parens > 0) { owner.parens--; continue }
      if (tip !== owner) { edits.set(owner.at, { end: owner.at + 1, text: '\\[' }); stack.length = 0; destinationOwner = undefined; pendingNotes.clear(); continue }
      let label = '', brackets = 0
      for (let at = owner.at + 1; at < owner.labelEnd!; at++) {
        const edit = edits.get(at); if (edit && edit.end <= owner.labelEnd!) { label += edit.text; at = edit.end - 1; continue }
        const end = angles.get(at)
        if (end !== undefined) { label += source.slice(at, end); at = end - 1; continue }
        if (mask[at] === ' ') { label += source[at]; continue }
        if (source[at] === '\\') { label += source.slice(at, at + 2); at++; continue }
        if (source[at] === '[') brackets++
        if (source[at] === ']') { if (brackets) brackets--; else label += '\\' }
        label += source[at]
      }
      let rawDestination = ''
      for (let at = owner.target!; at < i;) {
        const end = !rows[line] ? literalNotes.get(at) : undefined
        if (end !== undefined && end <= i) { rawDestination += source.slice(at, end).replace(/\\/g, '%5C').replace(/\n[ \t]*/g, ' '); at = end }
        else rawDestination += source[at++]!
      }
      let destination = rawDestination.replace(/\\(?:\r?\n|[^\r\n])/g, value => value.endsWith('\n') ? '\n' : value).replace(/\n([ \t]*[^\n]*)/g, (_all, tail: string) => { let rest = tail.replace(/^[ \t]*/, ''); for (let n = 0; n < owner.depth && /^>(?:[ \t]|$)/.test(rest); n++) rest = rest.slice(1).replace(/^[ \t]*/, ''); return rest })
      if (rows[line]) destination = destination.replace(/\\+\|/g, value => '%5C'.repeat(Math.floor((value.length - 1) / 2)) + '%7C')
      if (source[owner.at - 1] === '!' && !isDjotEscaped(source, owner.at - 1) && label.includes('[')) { label = renderPlainText(parse(djotToCarve('DJOTALT ' + label + ' DJOTEND')), { smartTypography: false }).replace(/ DJOTEND\n?$/, '').slice(8).replace(/[\[\]\\]/g, value => '\\' + value) }
      const target = destination.replace(rows[line] ? /\\([ \t!-\/:-@\[-`{-~])|[\\\s"<>`()|]/g : /\\([ \t!-\/:-@\[-`{-~])|[\\\s"<>`()]/g, (value, escaped: string | undefined) => escaped !== undefined ? /[()\\]/.test(escaped) ? '\\' + escaped : /[\s"<>`]/.test(escaped) ? encodeURIComponent(escaped) : escaped : value === '\\' ? '\\\\' : encodeURIComponent(value).replace(/[()]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()))
      edits.set(owner.at, { end: i + 1, text: `[${label}](${target})` }); stack.pop(); destinationOwner = undefined
      for (const at of pendingNotes) edits.set(at, { end: at + 1, text: '\\[' }); pendingNotes.clear()
    }
  }
  const output: string[] = []
  for (let i = 0; i < source.length;) { const edit = edits.get(i); if (edit) { output.push(edit.text); i = edit.end } else output.push(source[i++]!) }
  return output.join('')
}

function normalizeDjotAttributeLines(source: string): string {
  if (!source.includes('{')) return source
  const mask = maskDjotCodeAndDestinations(source).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value)
  const closes = new Map<number, number>()
  let close: number | undefined
  for (let at = source.length - 1; at >= 0; at--) { if (source[at] === '\n') close = undefined; else if (source[at] === '}') close = at + 1; else if (source[at] === '{' && close !== undefined) closes.set(at, close) }
  const parts: string[] = []
  let copied = 0
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{' || isDjotEscaped(source, i)) continue
    const attrs = readAttributes(source, i)
    if (!attrs) {
      const end = closes.get(i)
      if (end !== undefined && /^[A-Za-z][A-Za-z0-9_-]*=/.test(source.slice(i + 1))) {
        parts.push(source.slice(copied, i), source.slice(i, end).replace(/[{}\[\]]/g, value => '\\' + value)); copied = end; i = end - 1
      }
      continue
    }
    if (source.slice(i, attrs.end).includes('\n')) { parts.push(source.slice(copied, i), attrs.source); copied = attrs.end }
    i = attrs.end - 1
  }
  parts.push(source.slice(copied)); return parts.join('')
}

function foldDjotReferences(source: string): string {
  if (!source.includes(']:')) return source
  const lines = source.split('\n'), mask = maskDjotCodeAndDestinations(source, false, true, false)
  const rows = djotTableRows(source, mask)
  const removed = new Set<number>()
  let offset = 0, previous = '', previousDepth = 0, previousAttributeBlock = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!, [depth] = quoted(line), at = djotContentStart(line), content = line.slice(at)
    const definition = /^\[(?!\^)([^\]\n]*)\]:(?:[ \t]+(\S*)[ \t]*|)$/.exec(content)
    const previousLine = lines[n - 1] ?? '', previousAt = djotContentStart(previousLine)
    const boundary: boolean = previous === '' || previousAttributeBlock || rows[n - 1] || depth !== previousDepth || /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*][ \t]*){3,}$/.test(previousLine) || at < previousAt && /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(previousLine.slice(0, previousAt)) || /^(?:#{1,6} |:{3,}|\[[^\]]*\]:|(?:[-*][ \t]*){3,}$)/.test(previous)
    const marker = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(line.slice(0, at))
    if (definition && mask[offset + at] === '[' && (boundary || marker)) {
      let target = definition[2] ?? '', end = n
      while (end + 1 < lines.length) {
        const next = lines[end + 1]!, [nextDepth] = quoted(next), nextAt = djotContentStart(next)
        if (nextDepth !== depth || nextAt <= at || !/^\S+$/.test(next.slice(nextAt))) break
        target += next.slice(nextAt); end++
      }
      if (end > n) {
        lines[n] = line.slice(0, at) + `[${definition[1]}]: ${target}`
        for (let k = n + 1; k <= end; k++) { offset += lines[k]!.length + 1; removed.add(k) }
        n = end
      }
    }
    if (definition && mask[offset + at] === '[' && !(boundary || marker)) lines[n] = line.replace(']:', ']\\:')
    const attrs = content[0] === '{' ? readAttributes(content, 0) : undefined
    previousAttributeBlock = !!(boundary || marker) && attrs?.end === content.trimEnd().length
    previous = content.trim(); previousDepth = depth; offset += line.length + 1
  }
  return lines.filter((_line, n) => !removed.has(n)).join('\n')
}

function normalizeDjotParagraphFences(source: string): string {
  const rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false))
  const mask = maskDjotFences(source, undefined, rows, true)
  if (!mask.includes('```') && !mask.includes('~~~')) return source
  const runs = new Map<number, { width: number; end: number }>()
  const next = new Map<number, number>()
  const matches = [...mask.matchAll(/`+/g)]
  for (let k = matches.length - 1; k >= 0; k--) {
    const match = matches[k]!, at = match.index!, width = match[0].length
    runs.set(at, { width, end: next.get(width) ?? source.length }); next.set(width, at)
  }
  const breaks = [...mask.matchAll(/\n[ \t]*(?:>[ \t]*)*\n/g)].map(match => match.index!)
  const angles = new Map([...mask.matchAll(/<[^<>\s]+>/g)].filter(match => /[^:]@|[A-Za-z]:/.test(match[0])).map(match => [match.index!, match.index! + match[0].length]))
  const lineHeads = new Set<number>()
  let lineOffset = 0
  for (const line of source.split('\n')) { lineHeads.add(lineOffset + /^[ \t]*(?:>[ ]?[ \t]*)*/.exec(line)![0].length); lineOffset += line.length + 1 }
  const output: string[] = []
  let copied = 0, boundary = 0
  for (let i = 0; i < source.length;) {
    if (mask[i] === ' ') { i++; continue }
    if (source[i] === '\\') { i += 2; continue }
    const angle = angles.get(i); if (angle !== undefined) { i = angle; continue }
    while ((breaks[boundary] ?? source.length) <= i) boundary++
    const run = runs.get(i)
    if (run) {
      const end = Math.min(run.end, breaks[boundary] ?? source.length)
      const closed = run.end < (breaks[boundary] ?? source.length)
      const rawPayload = source.slice(i + run.width, end)
      const payload = !closed && end === source.length ? rawPayload.replace(/\n[ \t]*(?:>[ \t]*)*$/, '') : rawPayload
      if (run.width >= 3 && lineHeads.has(i)) {
        let width = 1
        const widths = new Set([...payload.matchAll(/`+/g)].map(match => match[0].length))
        while (widths.has(width)) width++
        const ticks = '`'.repeat(width)
        output.push(source.slice(copied, i), payload === '' ? '`<code></code>`{=html}' : (width >= 3 ? '{%%}' : '') + ticks + payload + ticks)
        copied = end + (closed ? run.width : 0)
      }
      i = end + (closed ? run.width : 0); continue
    }
    if (source[i] === '~' && lineHeads.has(i)) {
      const fence = /^~{3,}[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*(?=\n|$)/.exec(source.slice(i))
      if (fence) { output.push(source.slice(copied, i), '\\' + fence[0]); copied = i + fence[0].length; i = copied; continue }
    }
    i++
  }
  output.push(source.slice(copied)); return output.join('')
}

function normalizeDjotFootnotes(source: string, isDefinitionBoundary: (line: string) => boolean = () => false): string {
  if (!source.includes('[^')) return source
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const rows = djotTableRows(source, mask)
  const nonRows = new Set<number>()
  let rowOffset = 0
  source.split('\n').forEach((line, n) => { const at = djotContentStart(line); if (!rows[n] && line[at] === '|' && mask[rowOffset + at] === '|') nonRows.add(rowOffset + at); rowOffset += line.length + 1 })
  const unsupported = (key: string) => /[\[\]`<>|\\\f\x00]/.test(key)
  const labels = new Map<string, string>(), definitions = new Map<number, { key: string; end: number }>()
  const defined = new Set<string>(), used = new Set<string>(), reserved = new Set([...source.matchAll(/carve-djot-note-(\d+)/gi)].map(match => Number(match[1])))
  let serial = 0, offset = 0
  const lineHeads = new Set<number>(), emptyDefinitions = new Set<number>()
  const keyOf = (label: string) => label.trim().replace(/[ \t\r\n]+/g, ' ')
  const alias = (key: string): string => { let name = labels.get(key); if (!name) { while (reserved.has(serial)) serial++; name = `carve-djot-note-${serial++}`; labels.set(key, name) }; return name }
  const noteLines = source.split('\n')
  for (const [n, line] of noteLines.entries()) {
    const prefix = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)*/.exec(line)![0]
    const at = prefix.length; lineHeads.add(offset + at)
    const previousLine = noteLines[n - 1] ?? ''
    const previousPrefix = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)*/.exec(previousLine)![0]
    const previous = previousLine.slice(previousPrefix.length).trim()
    const item = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(prefix)
    const boundary = isDefinitionBoundary(previousLine) || previous === '' || rows[n - 1] || item || /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*][ \t]*){3,}$/.test(previousLine) || at < previousPrefix.length && /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(previousPrefix) || (prefix.match(/>/g)?.length ?? 0) < (previousPrefix.match(/>/g)?.length ?? 0) || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]*\]:|(?:[-*][ \t]*){3,}$)/.test(previous)
    const head = /^\[\^([^\]\n]+)\]:(?:[ \t]|$)/.exec(line.slice(at))
    if (head && boundary && mask[offset + at] === '[') { const key = keyOf(head[1]!); defined.add(key); definitions.set(offset + at, { key, end: offset + at + 2 + head[1]!.length }); if (unsupported(key)) alias(key); if (!line.slice(at + head[0].length).trim()) emptyDefinitions.add(offset + at) }
    offset += line.length + 1
  }
  const angles = new Map([...source.matchAll(/<[^<>\s]+>/g)].filter(match => /[^:]@|[A-Za-z]:/.test(match[0])).map(match => [match.index!, match.index! + match[0].length]))
  const destinations = new Map<number, number>(), acceptedDestinations = new Set<number>(), parens: number[] = []
  let destinationLine = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '\n') destinationLine++
    if (rows[destinationLine] && source[i] === '|' && source[i - 1] !== '\\') parens.length = 0
    if (source[i] === '(') parens.push(i)
    else if (source[i] === ')' && parens.length) { const at = parens.pop()!; if (source[at - 1] === ']') destinations.set(at, i + 1) }
  }
  const malformedEnds = new Map<number, number>()
  let nextBrace = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '\n') nextBrace = -1
    else if (source[at] === '}') nextBrace = at + 1
    else if (source[at] === '{' && nextBrace >= 0 && /^\{[A-Za-z][\w-]*=/.test(source.slice(at))) malformedEnds.set(at, nextBrace)
  }
  const brackets = new Map<number, number>(), stack: number[] = []
  let lineIndex = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') { lineIndex++; if (/^\n[ \t]*(?:>[ \t]*)*\n/.test(source.slice(i))) stack.length = 0 }
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '{') { const attrs = readAttributes(source, i); if (attrs) { i = attrs.end - 1; continue }; const badEnd = malformedEnds.get(i); if (badEnd !== undefined) { i = badEnd - 1; continue } }
    const angle = angles.get(i); if (angle !== undefined) { i = angle - 1; continue }
    if (mask[i] === ' ') continue
    if (rows[lineIndex] && source[i] === '|' && source[i - 1] !== '\\') { stack.length = 0; continue }
    const definition = definitions.get(i); if (definition) { i = definition.end; continue }
    if (source[i] === '[') stack.push(i)
    else if (source[i] === ']' && stack.length) {
      const open = stack.at(-1)!
      if (source[open + 1] === '^') brackets.set(stack.pop()!, i)
      else if (source[i + 1] === '(' && destinations.has(i + 1)) { brackets.set(stack.pop()!, i); acceptedDestinations.add(i + 1); i = destinations.get(i + 1)! - 1 }
      else if (source[i + 1] === '[') {
        let end = i + 2; while (end < source.length && source[end] !== ']') { if (source[end] === '\\') end++; end++ }
        if (source[end] === ']') { brackets.set(stack.pop()!, i); i = end }
      } else if (source[i + 1] === '{' && readAttributes(source, i + 1)) { brackets.set(stack.pop()!, i) }
    }
  }
  const output: string[] = []
  const imageEnds = new Map([...brackets].filter(([at, close]) => source[at - 1] === '!' && /[([]/.test(source[close + 1] ?? '')))
  for (let i = 0; i < source.length;) {
    const destinationEnd = destinations.get(i); if (destinationEnd !== undefined && acceptedDestinations.has(i)) { output.push(source.slice(i, destinationEnd)); i = destinationEnd; continue }
    if (nonRows.has(i)) output.push('\\')
    const imageEnd = imageEnds.get(i); if (imageEnd !== undefined) {
      let cursor = i
      for (let at = i + 1; at < imageEnd; at++) {
        const end = brackets.get(at)
        if (source.startsWith('[^', at) && end !== undefined && end < imageEnd) { output.push(source.slice(cursor, at)); cursor = end + 1; at = end }
      }
      output.push(source.slice(cursor, imageEnd + 1)); i = imageEnd + 1; continue
    }
    if (source[i] === '{') { const attrs = readAttributes(source, i); if (attrs) { output.push(source.slice(i, attrs.end)); i = attrs.end; continue }; const badEnd = malformedEnds.get(i); if (badEnd !== undefined) { output.push(source.slice(i, badEnd)); i = badEnd; continue } }
    const definition = definitions.get(i), end = definition?.end ?? brackets.get(i)
    if (source.startsWith('[^', i) && (definition || mask[i] === '[') && end !== undefined) {
      const key = definition?.key ?? keyOf(source.slice(i + 2, end))
      {
        const rename = labels.has(key) || unsupported(key) || !defined.has(key)
        const name = rename ? alias(key) : key
        const at = i
        if (!definition) used.add(key)
        output.push(rename || key !== source.slice(i + 2, end) ? `[^${name}]` : source.slice(i, end + 1)); i = end + 1
        if (definition && emptyDefinitions.has(at)) { output.push(': %%%%'); i++ }
        if (!definition && source[i] === ':' && lineHeads.has(at)) { output.push('\\:'); i++ }
        continue
      }
    }
    output.push(source[i++]!)
  }
  const stubs: string[] = []
  for (const key of used) if (!defined.has(key)) stubs.push(`[^${alias(key)}]: %%%%`)
  return (stubs.length ? stubs.join('\n\n') + '\n\n' : '') + output.join('')
}

function normalizeDjotFences(source: string): string {
  if (!source.includes('```') && !source.includes('~~~')) return source.includes('\\|') ? closeDjotTableCode(source) : source
  const lines = source.split('\n')
  const rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false))
  maskDjotCodeAndDestinations(source, false, true, false, (line, replacement) => { lines[line] = replacement }, rows)
  const normalized = normalizeDjotParagraphFences(lines.join('\n'))
  return source.includes('\\|') || source.split('\n').some(line => /^[ \t]+`{3,}/.test(quoted(line)[1])) ? closeDjotTableCode(normalized) : normalized
}

function normalizeDjotAutolinks(source: string): string {
  if (!source.includes('<')) return source
  const codeMask = maskDjotCodeAndDestinations(source, false, true, false)
  const mask = maskDjotCodeAndDestinations(source).split('')
  const rows = djotTableRows(source, codeMask)
  let definitionIndent = -1, definitionOffset = 0, definitionLine = 0, previousContent = ''
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

  const angleEnds = new Map(Array.from(source.matchAll(/<[^<>\s]+>/g), match => [match.index!, /[^:]@|[A-Za-z]:/.test(match[0]) ? match.index! + match[0].length : -1]))
  const bracketEnds = new Map<number, number>(), nestedBrackets = new Set<number>(), stack: number[] = []
  const imageAutolinks = new Set<number>()
  const parenEnds = new Map<number, number>(), parens: number[] = []
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (quote) { if (source[i] === quote || source[i] === '\n') quote = ''; continue }
    if (parens.length && /[ \t]/.test(source[i - 1] ?? '') && /["']/.test(source[i]!)) { quote = source[i]!; continue }
    if (source[i] === '(') parens.push(i)
    if (source[i] === ')' && parens.length) parenEnds.set(parens.pop()!, i)
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    const angleEnd = angleEnds.get(i)
    if (angleEnd !== undefined && angleEnd > i) { i = angleEnd - 1; continue }
    if (source[i] === '[') { if (stack.length) nestedBrackets.add(stack.at(-1)!); stack.push(i) }
    if (source[i] === ']' && stack.length) bracketEnds.set(stack.pop()!, i)
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    let end: number | undefined
    if (source[i] === '{' && mask[i] === '{') end = readAttributes(source, i)?.end
    if (source[i] === '!' && mask[i] === '!' && source[i + 1] === '[') {
      const close = bracketEnds.get(i + 1)
      if (close !== undefined && /[([]/.test(source[close + 1] ?? '')) {
        const angles: number[] = []
        let plain = true
        for (let at = i + 2; at < close; at++) {
          const angleEnd = angleEnds.get(at)
          if (angleEnd !== undefined && angleEnd > at && angleEnd <= close) { angles.push(at); at = angleEnd - 1 }
          else if ('`{_*~^\\['.includes(source[at]!)) { plain = false; break }
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
  let copied = 0, line = 0, offset = 0
  for (const match of source.matchAll(/<([^<>\s]+)>/g)) {
    const at = match.index!, end = at + match[0].length
    while (offset < at) { if (source[offset] === '\n') line++; offset++ }
    const image = imageAutolinks.has(at) && codeMask[at] === '<'
    if ((!image && mask[at] !== '<') || isDjotEscaped(source, at)) continue
    const body = match[1]!
    if (!/[^:]@|[A-Za-z]:/.test(body) || (!image && !/[\[\]{}`|\\]/.test(body) && !(/[^:]@/.test(body) && body.includes(':')))) continue
    if (rows[line] && /[|`]/.test(body)) continue
    const label = body.replace(/[!-\/:-@\[-`{-~]/g, value => '\\' + value)
    const destination = /[^:]@/.test(body) ? 'mailto:' + body : body
    const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\\]*/.exec(destination)?.[0].length ?? 0
    const encode = (text: string, brackets: boolean) => text.replace(brackets ? /[`|\\()[\]]/g : /[`|\\()]/g, value => value === '\\' ? '\\\\' : '%' + value.charCodeAt(0).toString(16).toUpperCase())
    const target = encode(destination.slice(0, authority), false) + encode(destination.slice(authority), true)
    parts.push(source.slice(copied, at), image ? label : '[' + label + '](' + target + ')')
    copied = end
  }
  parts.push(source.slice(copied))
  return parts.join('')
}

function djotContentStart(line: string): number {
    let at = 0
    while (at < line.length) {
      while (line[at] === ' ' || line[at] === '\t') at++
      if (line[at] === '>') { at++; continue }
      const marker = /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+)/.exec(line.slice(at))
      if (!marker) break
      at += marker[0].length
    }
    return at
  }

function djotTableRows(source: string, mask: string): boolean[] {
  let offset = 0, previousRow = false, previousBlock = true, footnoteColumn = -1
  return source.split('\n').map(line => {
    const at = djotContentStart(line), end = line.trimEnd().length - 1, content = line.slice(at)
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(line.slice(0, at))
    const closesNote = footnoteColumn >= 0 && at < footnoteColumn
    if (closesNote) footnoteColumn = -1
    const allowed = previousBlock || previousRow || opensItem || closesNote
    const note = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)*\[\^[^\]\n]+\]:/.exec(line)
    if (note && allowed) footnoteColumn = note[0].indexOf('[^') + 2
    const row: boolean = allowed && line[at] === '|' && mask[offset + at] === '|' && line[end] === '|' && mask[offset + end] === '|' && line[end - 1] !== '\\'
    previousBlock = content.trim() === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]+\]:)/.test(content)
    previousRow = row
    offset += line.length + 1
    return row
  })
}

function renameDjotPipeFootnotes(source: string): string {
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const prefix = 'carve-djot-footnote-'
  const reserved = new Set(Array.from(source.matchAll(/carve-djot-footnote-(\d+)/gi), match => Number(match[1])))
  let serial = 0
  const labels = new Map<string, string>(), definitionEnds = new Map<number, number>()
  for (const match of source.matchAll(/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\[\^([^\]\n]+)\]:/gm)) {
    const at = match.index! + match[0].indexOf('[')
    const key = match[1]!.replace(/\s+/g, ' ').trim()
    if (mask[at] === '[') definitionEnds.set(at, at + 2 + match[1]!.length)
    if (mask[at] === '[' && !key.includes('[') && key.includes('|') && !labels.has(key)) { while (reserved.has(serial)) serial++; labels.set(key, prefix + serial++) }
  }
  if (labels.size === 0 && !source.includes('[^')) return source
  const parens = new Map<number, number>(), stack: number[] = []
  const rowRanges: [number, number][] = []
  let lineOffset = 0, previousRow = false, previousBlock = true
  for (const line of source.split('\n')) {
    const at = djotContentStart(line), end = line.trimEnd().length - 1
    const content = line.slice(at)
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(line.slice(0, at))
    const row: boolean = (previousBlock || previousRow || opensItem) && line[at] === '|' && mask[lineOffset + at] === '|' && line[end] === '|' && mask[lineOffset + end] === '|' && line[end - 1] !== '\\'
    previousBlock = content.trim() === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]+\]:)/.test(content)
    previousRow = row
    if (row) rowRanges.push([lineOffset + at, lineOffset + line.length])
    if (row || content.trim() === '') stack.length = 0
    for (let i = 0; i < line.length; i++) {
      if (mask[lineOffset + i] === ' ') continue
      if (line[i] === '{') { const attrs = readAttributes(line, i); if (attrs) { i = attrs.end - 1; continue } }
      if (line[i] === '\\' && /[!-\/:-@\[-`{-~]/.test(line[i + 1] ?? '')) { i++; continue }
      if (row && line[i] === '|' && line[i - 1] !== '\\') stack.length = 0
      else if (line[i] === '(') stack.push(lineOffset + i)
      else if (line[i] === ')' && stack.length) parens.set(stack.pop()!, lineOffset + i)
    }
    if (row) stack.length = 0
    lineOffset += line.length + 1
  }
  let rowIndex = 0
  const out: string[] = [], images: boolean[] = []
  let imageDepth = 0
  for (let i = 0; i < source.length;) {
    if (source[i] === '\n' && /^\n[ \t]*\n/.test(source.slice(i))) { images.length = 0; imageDepth = 0 }
    if (mask[i] === '{') { const attrs = readAttributes(source, i); if (attrs) { out.push(source.slice(i, attrs.end)); i = attrs.end; continue } }
    if (mask[i] === ' ') { out.push(source[i++]!); continue }
    if (source[i] === '\\') { out.push(source[i++]!); if (/[!-\/:-@\[-`{-~]/.test(source[i] ?? '')) out.push(source[i++]!); continue }
    while (rowRanges[rowIndex] && rowRanges[rowIndex]![1] <= i) rowIndex++
    const inRow = rowRanges[rowIndex] !== undefined && rowRanges[rowIndex]![0] <= i
    if (inRow && source[i] === '|' && source[i - 1] !== '\\') { images.length = 0; imageDepth = 0 }
    if (source.startsWith('[^', i)) {
      let end = i + 2
      while (end < source.length && !'[]\n'.includes(source[end]!)) end++
      if (source[end] === '[') {
        const definitionEnd = definitionEnds.get(i)
        if (definitionEnd !== undefined) { out.push(source.slice(i, definitionEnd + 1)); i = definitionEnd + 1; continue }
        out.push('\\[^'); i += 2; continue
      }
      if (source[end] === ']') {
        const label = source.slice(i + 2, end)
        const rawPipe = inRow && /(^|[^\\])\|/.test(label)
        if (rawPipe) { images.length = 0; imageDepth = 0 }
        const renamed = imageDepth === 0 && !rawPipe ? labels.get(label.replace(/\s+/g, ' ').trim()) : undefined
        out.push(renamed === undefined ? source.slice(i, end + 1) : `[^${renamed}]`)
        i = end + 1
        continue
      }
    }
    if (source[i] === '[') { const image = source[i - 1] === '!'; images.push(image); if (image) imageDepth++ }
    else if (source[i] === ']' && images.length) {
      if (images.pop()) imageDepth--
      const end = source[i + 1] === '(' ? parens.get(i + 1) : undefined
      if (end !== undefined) { out.push(source.slice(i, end + 1)); i = end + 1; continue }
    }
    out.push(source[i++]!)
  }
  return out.join('')
}

function closeDjotTableCode(source: string): string {
  if (!source.includes('`')) return source
  const mask = source
  const paragraphEnds = Array.from(source.matchAll(/\n[ \t]*(?:>[ \t]*)*\n/g), match => match.index!)
  const runs = new Map<number, number[]>()
  for (const run of source.matchAll(/`+/g)) {
    const positions = runs.get(run[0].length) ?? []
    positions.push(run.index!); runs.set(run[0].length, positions)
  }
  const closeRun = (open: number, width: number): number => {
    const positions = runs.get(width) ?? []
    let low = 0, high = positions.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (positions[mid]! < open + width) low = mid + 1
      else high = mid
    }
    return positions[low] ?? source.length
  }
  const tickStarts: number[] = [], tickWidths: number[] = []
  const queryEnd = source.includes('![') || source.includes('[^') || source.includes('](') ? Math.max(source.lastIndexOf(']'), source.lastIndexOf(')')) : 0
  for (let at = 0; at < queryEnd;) {
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at += 2; continue }
    if (source[at] !== '`') { at++; continue }
    let width = 1
    while (source[at + width] === '`') width++
    tickStarts.push(at); tickWidths.push(width); at += width
  }
  const tickIndex = (position: number): number => {
    let low = 0, high = tickStarts.length
    while (low < high) { const mid = (low + high) >>> 1; if (tickStarts[mid]! < position) low = mid + 1; else high = mid }
    return low
  }
  const count = tickStarts.length
  const next = Array<number>(count + 1).fill(count), ends = Array<number>(count + 1).fill(source.length + 1)
  const jumps = Array<number>(count + 1).fill(count), depths = Array<number>(count + 1).fill(0)
  // Merge equal-length ancestor jumps so each tick stores one pointer.
  for (let at = count - 1; at >= 0; at--) {
    const finish = closeRun(tickStarts[at]!, tickWidths[at]!) + tickWidths[at]!
    const parent = tickIndex(finish), jump = jumps[parent]!, farther = jumps[jump]!
    next[at] = parent; ends[at] = finish; depths[at] = depths[parent]! + 1
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
  const parens = new Map<number, number>(), labels = new Map<number, number>()
  const parenthesisStack: number[] = [], bracketStack: number[] = []
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at++; continue }
    if (source[at] === '(') parenthesisStack.push(at)
    else if (source[at] === ')' && parenthesisStack.length) parens.set(parenthesisStack.pop()!, at)
    else if (source[at] === '[') bracketStack.push(at)
    else if (source[at] === ']' && bracketStack.length) labels.set(bracketStack.pop()!, at)
  }
  const block = /^(?:[-*+] |(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)] |\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\) |: |#{1,6} |`{3,}|~{3,}|:{3,}|>|\||\^ |\[[^\]]+\]:)/
  const marker = /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+)/
  const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/y
  let paragraph = 0, offset = 0, cursor = 0, consumed = 0, itemColumn = 0, itemQuote = 0, previousQuote = 0
  let itemKind = '', previousBlock = true
  let fenced: { width: number; ch: string; depth: number; column: number; item: number } | undefined
  const divs: { width: number; depth: number; column: number }[] = []
  const output: string[] = []
  for (const line of source.split('\n')) {
    const at = djotContentStart(line), lineEnd = offset + line.length
    const [depth, content] = quoted(line), trimmed = content.trimStart()
    const indent = content.length - trimmed.length, item = marker.exec(trimmed)
    const oldColumn = itemColumn, oldQuote = itemQuote
    const beganInside = offset < consumed
    if (!beganInside) {
      if (fenced && trimmed && (depth < fenced.depth || (depth === fenced.depth && indent < fenced.item))) fenced = undefined
      if (fenced) {
        if (depth === fenced.depth && indent <= fenced.column && new RegExp(`^${fenced.ch}{${fenced.width},}[ \t]*$`).test(trimmed)) { fenced = undefined; previousBlock = true }
        offset = lineEnd + 1
        continue
      }
      const opening = /^(`{3,}|~{3,})[ \t]*=?[a-zA-Z0-9_+#.-]*$/.exec(line.slice(at))
      if (opening && (previousBlock || item)) {
        if (!item && (depth < itemQuote || (depth === itemQuote && indent < itemColumn))) { itemColumn = indent; itemQuote = depth; itemKind = '' }
        fenced = { width: opening[1]!.length, ch: opening[1]![0]!, depth, column: at, item: item ? indent + (item[0].startsWith('[^') ? 2 : item[0].length) : Math.min(itemColumn, indent) }
        offset = lineEnd + 1
        continue
      }
    }
    if (offset >= consumed) {
      if (item) { itemColumn = indent + (item[0].startsWith('[^') ? 2 : item[0].length); itemQuote = depth; itemKind = item[0].replace(/^[0-9]+/, '1').replace(/^[A-Za-z]+/, 'a').trim() }
      else if (trimmed && (depth < itemQuote || (depth === itemQuote && indent < itemColumn && (block.test(trimmed) || (trimmed.startsWith('{') && readAttributes(trimmed, 0)))))) itemColumn = 0
      const div = /^(:{3,})(?:[ \t]+\S.*)?[ \t]*$/.exec(line.slice(at))
      if (div) {
        const owner = divs.at(-1)
        if (owner && depth === owner.depth && /^:{3,}[ \t]*$/.test(line.slice(at)) && div[1]!.length >= owner.width) divs.pop()
        else if (mask[offset + at] !== ' ') divs.push({ width: div[1]!.length, depth, column: at })
      }
      if (line[at] === '|' && ((oldColumn > 0 && depth <= oldQuote && indent < oldColumn) || depth < previousQuote)) { output.push(source.slice(cursor, offset), '\n'); cursor = offset }
      previousQuote = depth
    }
    let i = Math.max(offset + at, consumed)
    const pending: number[] = [], footnotes: number[] = []
    while (i < lineEnd) {
      if (mask[i] === ' ' && source[i] !== ' ') { i++; continue }
      if (source[i] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[i + 1] ?? '')) { i += 2; continue }
      if (source[i] === '{') { const attrs = readAttributes(source, i); if (attrs) { i = attrs.end; continue } }
      if (source[i] === '<') { autolink.lastIndex = i; const auto = autolink.exec(source); if (auto) { i += auto[0].length; continue } }
      if (source.startsWith('![', i)) {
        const end = labels.get(i + 1)
        if (end !== undefined && balancedTicks(i + 2, end)) { i = end + 1; continue }
      }
      if (source.startsWith('[^', i)) {
        let end = i + 2
        while (end < lineEnd && !'[]'.includes(source[end]!)) end++
        if (source[end] === ']' && balancedTicks(i + 2, end)) { i = end + 1; continue }
        footnotes.push(i)
      }
      if (source[i] === ']' && source[i + 1] === '(') {
        const end = parens.get(i + 1)
        if (end !== undefined && end <= lineEnd && balancedTicks(i + 2, end)) { i = end + 1; continue }
      }
      if (source[i] === ']') footnotes.length = 0
      if (source[i] === '(') pending.push(i)
      else if (source[i] === ')') pending.pop()
      if (source[i] !== '`') { i++; continue }
      let width = 1
      while (source[i + width] === '`') width++
      const candidate = closeRun(i, width)
      if (candidate + width <= lineEnd) { i = candidate + width; consumed = i; continue }
      while ((paragraphEnds[paragraph] ?? source.length) <= i) paragraph++
      let limit = Math.min(candidate, paragraphEnds[paragraph] ?? source.length), separate = false
      for (let next = lineEnd + 1; next < limit;) {
        const newline = source.indexOf('\n', next), end = newline < 0 ? source.length : newline
        const following = source.slice(next, end), [nextDepth, nextContent] = quoted(following), nextTrimmed = nextContent.trimStart()
        const nextIndent = nextContent.length - nextTrimmed.length, owner = divs.at(-1)
        const closesDiv = owner && nextDepth === owner.depth && nextIndent <= owner.column + 3 && /^:{3,}[ \t]*$/.test(nextTrimmed) && nextTrimmed.trim().length >= owner.width
        const outside = (depth > 0 && nextDepth < depth) || (itemColumn > 0 && nextDepth <= itemQuote && nextIndent < itemColumn)
        const attributes = nextTrimmed.startsWith('{') && readAttributes(nextTrimmed, 0)
        if (closesDiv || (outside && (block.test(nextTrimmed) || attributes))) {
          limit = next - 1
          const nextItem = marker.exec(nextTrimmed)?.[0].replace(/^[0-9]+/, '1').replace(/^[A-Za-z]+/, 'a').trim()
          separate = outside && (nextDepth < depth || nextItem !== itemKind)
          break
        }
        if (newline < 0) break
        next = newline + 1
      }
      const closed = candidate <= limit && candidate < source.length
      const end = closed ? candidate : limit
      let payload = source.slice(i + width, end).replace(/\n$/, '').replace(/^ `/, '`').replace(/` $/, '`')
      const normalized = payload.split('\n').map((value, n) => {
        if (n === 0) return value.replace(/[ \t]+$/, '')
        for (let q = 0; q < depth; q++) { const prefix = /^[ \t]*>[ ]?/.exec(value); if (!prefix) break; value = value.slice(prefix[0].length) }
        return value.replace(/^[ \t]+|[ \t]+$/g, '')
      })
      const rawCode = normalized.slice(1).some(value => (block.test(value) || value.startsWith('{')) && (!/^\|[ \t:|-]*\|$/.test(value) || line[at] !== '|')) || (itemKind.startsWith('[^') && normalized.length > 1)
      if (rawCode) payload = '<code>' + normalized.join('\n').replace(/[!-\/:-@\[-`{-~]|\n/g, ch => `&#${ch.charCodeAt(0)};`) + '</code>'
      let fenceWidth = 1
      for (const run of payload.matchAll(/`+/g)) fenceWidth = Math.max(fenceWidth, run[0].length + 1)
      const fence = '`'.repeat(fenceWidth), pad = payload.startsWith('`') || payload.endsWith('`') || (payload.startsWith(' ') && payload.endsWith(' ') && payload.trim()) ? ' ' : ''
      const escapes = [...pending.filter(k => source[k - 1] === ']'), ...footnotes].sort((a, b) => a - b)
      for (const escape of escapes) { output.push(source.slice(cursor, escape), '\\'); cursor = escape }
      output.push(source.slice(cursor, i), fence + pad + payload + pad + fence + (rawCode ? '{=html}' : ''))
      cursor = closed ? end + width : end
      consumed = cursor
      if (separate && !closed) output.push('\n')
      i = consumed
    }
    previousBlock = !beganInside && consumed <= lineEnd && (trimmed === '' || /^(?:#{1,6} |:{3,}|\[[^\]]+\]:)/.test(trimmed) || (trimmed.startsWith('{') && readAttributes(trimmed, 0) !== undefined) || (line[at] === '|' && line.trimEnd().endsWith('|') && !line.trimEnd().endsWith('\\|')))
    offset = lineEnd + 1
  }
  output.push(source.slice(cursor))
  return output.join('')
}

function normalizeDjotTablePipes(source: string): string {
  if (!source.includes('\\|')) return source
  source = renameDjotPipeFootnotes(source)
  const mask = maskDjotCodeAndDestinations(source, false, true, false)
  const lines = source.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) { offsets.push(offset); offset += line.length + 1 }
  const rowFlags = djotTableRows(source, mask)
  const definitions = new Map<string, { target: string; attrs: string }>()
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!, at = djotContentStart(line)
    if (mask[offsets[n]! + at] !== '[') continue
    const definition = /^\[([^\[\]\n^][^\[\]\n]*)\]:[ \t]*(\S*)[ \t]*$/.exec(line.slice(at))
    if (!definition || !definition[1]!.includes('|')) continue
    const previousLine = lines[n - 1] ?? '', previousAt = djotContentStart(previousLine)
    const previous = previousLine.slice(previousAt).trim()
    const quoteDepth = (value: string) => value.split('>').length - 1
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(line.slice(0, at))
    const previousAttrs = previous.startsWith('{') ? readAttributes(previous, 0) : undefined
    if (previous !== '' && !rowFlags[n - 1] && at >= previousAt && !/^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$/.test(previous) && !/^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\[[^\]]+\]:)/.test(previous) && previousAttrs?.end !== previous.length && !opensItem && quoteDepth(line.slice(0, at)) <= quoteDepth(previousLine.slice(0, previousAt))) {
      lines[n] = line.slice(0, at) + '\\' + line.slice(at)
      continue
    }
    let target = definition[2]!
    let end = n
    while (end + 1 < lines.length) {
      const next = lines[end + 1]!, nextAt = djotContentStart(next)
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
  const decode = (label: string) => label.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1').replace(/\s+/g, ' ').trim()
  return lines.map((line, n) => {
    const at = djotContentStart(line), lineMask = mask.slice(offsets[n]!, offsets[n]! + line.length)
    const row = line[at] === '|' && lineMask[at] === '|'
    if (!row) return line
    if (!rowFlags[n]) return line.slice(0, at) + '\\' + line.slice(at)
    const brackets = new Map<number, number>(), parens = new Map<number, number>()
    const bracketStack: number[] = [], parenStack: number[] = []
    for (let i = at; i < line.length; i++) {
      if (lineMask[i] === ' ') continue
      if (line[i] === '{') { const attrs = readAttributes(line, i); if (attrs) { i = attrs.end - 1; continue } }
      if (line[i] === '|' && line[i - 1] !== '\\') { bracketStack.length = 0; parenStack.length = 0; continue }
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
        destinations[next + 1] = destinations[next + 1]! + 1; destinations[last] = destinations[last]! - 1
      } else if (line[next] === '[' && brackets.has(next) && !references.has(open)) {
        const last = brackets.get(next)!
        const key = decode(line.slice(next + 1, last) || line.slice(open + 1, close))
        const definition = definitions.get(key)
        if (!definition) continue
        const target = definition.target.replace(/[\\|()<> ]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
        references.set(next, { end: last + 1, text: `(${target})${definition.attrs.replace(/\\+\|?|\|/g, value => value.endsWith('|') && (value.length - 1) % 2 === 0 ? value.slice(0, -1) + '\\|' : value)}` })
      }
    }
    for (let k = 1; k < line.length; k++) destinations[k] = destinations[k]! + destinations[k - 1]!
    const output: string[] = []
    for (let i = 0; i < line.length;) {
      const reference = references.get(i)
      if (reference) { output.push(reference.text); i = reference.end; continue }
      if (lineMask[i] === ' ' || line[i] !== '\\') { output.push(line[i++]!); continue }
      const begin = i
      while (line[i] === '\\') i++
      const run = i - begin
      if (line[i] !== '|') { output.push(line.slice(begin, i)); if (run % 2 !== 0 && punctuation(line[i])) output.push(line[i++]!); continue }
      output.push(destinations[begin]! > 0 ? '%5C'.repeat(Math.floor(run / 2)) + '%7C' : '\\'.repeat(run + (run % 2 === 0 ? 1 : 0)) + '|')
      i++
    }
    return output.join('')
  }).join('\n')
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
  const reserved = new Set([...source.matchAll(/\0DJOTNOTEATTR(\d+)\0/g)].map(match => Number(match[1])))
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
    while (noteColumn !== undefined && content !== '' && column + 1 < noteColumn) {
      if (metadataNote && listColumn !== undefined && column >= listColumn && n > 0 && /^[ \t]*$/.test(lines[n - 1]!)) {
        while (reserved.has(serial)) serial++
        comments.add(serial)
        lines[n - 1] = ' '.repeat(listColumn) + `\0DJOTNOTEATTR${serial++}\0`
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
    } else {
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
            lines[end] = lead + `\0DJOTNOTEATTR${serial++}\0`
            position += raw.length + 1; end++
          }
        }
      }
      pending = []
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
    offset += line.length + 1
  }
  return { source: header + lines.join('\n'), losses, isBoundary: line => { const token = /\0DJOTNOTEATTR(\d+)\0$/.exec(line.replace(/[ \t]+$/, '')); return token !== null && comments.has(Number(token[1])) }, restore: text => text.replace(/\0DJOTNOTEATTR(\d+)\0/g, (value, index: string) => comments.has(Number(index)) ? '%%' : value) }
}
