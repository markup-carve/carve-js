import { parseFragment } from 'parse5'
import { carveToHtml } from './index.js'
import type { MigrationDiagnostic } from './migration.js'
import { ORDERED_TASK_ITEM_UNSPELLABLE } from './import-report-messages.js'

interface Assessment {
  diagnostics: MigrationDiagnostic[]
  complete: boolean
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Compare document structure while ignoring generated heading wrappers and layout whitespace. */
function htmlShape(html: string): string {
  const visit = (node: any, pre = false): any[] => {
    if (node.nodeName === '#text') {
      return [node.value]
    }
    if (node.nodeName === '#comment') return [['comment', node.data]]
    const tag = node.tagName ?? 'root'
    const children: any[] = (node.childNodes ?? []).flatMap((child: any) => visit(child, pre || tag === 'pre' || tag === 'code'))
    const layout = (child: any): boolean => typeof child === 'string' && /^[ \t\r\n]*$/.test(child)
    if (tag === 'section' && (node.childNodes ?? []).some((child: any) => /^h[1-6]$/.test(child.tagName ?? ''))) return children.filter((child: any) => !layout(child))
    const structural = /^(root|ul|ol|li|blockquote|table|thead|tbody|tr)$/.test(tag)
    const attrs = (node.attrs ?? []).filter((attr: any) => !(attr.name === 'id' && /^h[1-6]$/.test(tag)) && !(attr.name === 'scope' && tag === 'th')).map((attr: any) => [attr.name, attr.value]).sort()
    return [[tag, attrs, structural ? children.filter((child: any) => !layout(child)) : children]]
  }
  return JSON.stringify(visit(parseFragment(html)))
}

/** A bounded grammar proves the constructs it reads; ambiguous syntax remains unassessed. */
export function assessMarkdown(source: string, value: string): Assessment {
  if (source.length > 1_000_000) return { diagnostics: [], complete: false }
  const diagnostics: MigrationDiagnostic[] = []
  let complete = true
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const definitions = new Map<string, { destination: string; title?: string }>()
  const labelKey = (label: string): string => label.trim().replace(/[ \t\n]+/g, ' ').toLowerCase()
  for (const line of lines) {
    const definition = /^ {0,3}\[([^\]\n]+)\]:[ \t]+(\S+)(?:[ \t]+"([^"\n]*)")?[ \t]*$/.exec(line)
    if (definition && !definitions.has(labelKey(definition[1]!))) definitions.set(labelKey(definition[1]!), { destination: definition[2]!, title: definition[3] })
  }
  const emit = (construct: string, line: number, fidelity: MigrationDiagnostic['fidelity'] = 'preserved', code = `markdown-${construct}`): void => {
    diagnostics.push({ code, message: construct === 'ordered-task' ? ORDERED_TASK_ITEM_UNSPELLABLE : `Assessed Markdown ${construct}.`, severity: fidelity === 'dropped' ? 'warning' : 'info', fidelity, confidence: 'exact', path: `line:${line}` })
  }
  const inline = (text: string, line: number): string => {
    let result = ''
    for (let i = 0; i < text.length;) {
      const rest = text.slice(i)
      let match: RegExpExecArray | null
      if (rest[0] === '`' && /^`+/.exec(rest)![0].length > 64) { complete = false; return result + escape(rest) }
      if ((match = /^(`{1,64})([\s\S]*?)\1(?!`)/.exec(rest)) && !match[2]!.includes('`')) {
        let body = match[2]!.replace(/\n/g, ' ')
        if (/^ .* $/.test(body) && /[^ ]/.test(body)) body = body.slice(1, -1)
        emit('code-span', line); result += `<code>${escape(body)}</code>`; i += match[0].length
      } else if ((match = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(rest))) {
        emit('escape', line, 'normalized'); result += escape(match[1]!); i += match[0].length
      } else if ((match = /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/.exec(rest))) {
        emit('entity', line, 'normalized'); result += match[0]; i += match[0].length
      } else if ((match = /^(!?)\[([^\]\n]*)\]\(([^ ()\n]+)(?:[ \t]+"([^"\n]*)")?\)/.exec(rest))) {
        const image = match[1] === '!'
        const href = match[3]!
        if (!/^(https?:\/\/|mailto:|[./#])/.test(href) && /^[A-Za-z][\w+.-]*:/.test(href)) complete = false
        emit(image ? 'image' : 'link', line)
        const title = match[4] === undefined ? '' : ` title="${escape(match[4])}"`
        result += image ? `<img src="${escape(href)}" alt="${escape(match[2]!)}"${title}>` : `<a href="${escape(href)}"${title}>${inline(match[2]!, line)}</a>`
        i += match[0].length
      } else if ((match = /^(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/.exec(rest)) && definitions.has(labelKey(match[3] || match[2]!))) {
        const definition = definitions.get(labelKey(match[3] || match[2]!))!
        emit('reference-link', line, 'normalized')
        const title = definition.title === undefined ? '' : ` title="${escape(definition.title)}"`
        result += match[1] === '!' ? `<img src="${escape(definition.destination)}" alt="${escape(match[2]!)}"${title}>` : `<a href="${escape(definition.destination)}"${title}>${inline(match[2]!, line)}</a>`
        i += match[0].length
      } else if ((match = /^<(https?:\/\/[^<>\s]+|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/.exec(rest))) {
        emit('autolink', line, 'normalized'); const label = match[1]!; const href = label.includes('://') ? label : `mailto:${label}`
        result += `<a href="${escape(href)}">${escape(label)}</a>`; i += match[0].length
      } else if ((match = /^(\*\*|__|~~|\*|_)([^\n]+?)\1/.exec(rest)) && !/[*_~]/.test(match[2]!)) {
        const kind = match[1] === '~~' ? 'strikethrough' : match[1]!.length === 2 ? 'strong' : 'emphasis'
        if ((match[1]!.includes('_') && /[\p{L}\p{N}]/u.test(text[i - 1] ?? '')) || /^\s|\s$/.test(match[2]!)) complete = false
        emit(kind, line); const tag = kind === 'strong' ? 'strong' : kind === 'emphasis' ? 'em' : 's'
        result += `<${tag}>${inline(match[2]!, line)}</${tag}>`; i += match[0].length
      } else if ((match = /^(?: {2,}|\\)\n/.exec(rest))) {
        emit('hard-break', line, 'normalized'); result += '<br>\n'; line++; i += match[0].length
      } else if (rest[0] === '\n') {
        emit('soft-break', line); result += '\n'; line++; i++
      } else if ((match = /^<(?:!--[\s\S]*?--|\/?[A-Za-z][^<>]*|\?[\s\S]*?\?)>/.exec(rest))) {
        if (/^<\/?(?:section|h[1-6])\b/i.test(match[0])) complete = false
        emit('raw-html', line, 'degraded', 'raw-preserved'); result += match[0]; i += match[0].length
      } else {
        const char = rest[0]!
        if ('*_`[\\'.includes(char) || rest.startsWith('~~') || rest.startsWith('https://') || rest.startsWith('http://') || rest.startsWith('www.') || ((i === 0 || !/[\w.+-]/.test(text[i - 1]!)) && /^[\w.+-]+@[\w.-]+\.[A-Za-z]/.test(rest))) { complete = false; return result + escape(rest) }
        result += escape(char); i++
      }
    }
    return result
  }
  const blocks = (input: string[], first: number, depth = 0): string => {
    if (depth > 64) { complete = false; return '' }
    let html = ''
    for (let i = 0; i < input.length;) {
      const line = input[i]!, n = first + i
      let match: RegExpExecArray | null
      if (line.trim() === '') { i++; continue }
      if (/^ {0,3}\[[^\]\n]+\]:[ \t]+\S+(?:[ \t]+"[^"\n]*")?[ \t]*$/.test(line)) { emit('reference-definition', n, 'normalized'); i++; continue }
      if ((match = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(line))) {
        const fence = match[1]!, info = match[2]!.trim(); const body: string[] = []; i++
        while (i < input.length && !(new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`)).test(input[i]!)) body.push(input[i++]!)
        if (i < input.length) i++
        emit('fenced-code', n)
        if (info && !/^[A-Za-z0-9_+./-]+$/.test(info)) complete = false
        html += `<pre><code${info ? ` class="language-${escape(info)}"` : ''}>${escape(body.join('\n') + (body.length ? '\n' : ''))}</code></pre>\n`; continue
      }
      if (/^ {4}/.test(line)) {
        const body: string[] = []
        while (i < input.length && (/^ {4}/.test(input[i]!) || input[i]!.trim() === '')) body.push(input[i++]!.replace(/^ {4}/, ''))
        while (body.at(-1) === '') body.pop()
        emit('indented-code', n, 'normalized'); html += `<pre><code>${escape(body.join('\n') + '\n')}</code></pre>\n`; continue
      }
      if ((match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line))) {
        const body = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(); emit('atx-heading', n)
        html += `<h${match[1]!.length}>${inline(body, n)}</h${match[1]!.length}>\n`; i++; continue
      }
      if (i + 1 < input.length && line.includes('|')) {
        const cells = (row: string): string[] => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
        const separators = cells(input[i + 1]!)
        const headers = cells(line)
        if (separators.length === headers.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
          emit('table', n); emit('table-row', n)
          const cellHtml = (body: string, column: number, tag: string, row: number): string => {
            emit('table-cell', row)
            const separator = separators[column]!
            const align = separator.startsWith(':') && separator.endsWith(':') ? 'center' : separator.endsWith(':') ? 'right' : separator.startsWith(':') ? 'left' : ''
            return `<${tag}${align ? ` style="text-align: ${align};"` : ''}>${inline(body, row)}</${tag}>`
          }
          html += `<table>\n<thead>\n<tr>${headers.map((cell, column) => cellHtml(cell, column, 'th', n)).join('')}</tr>\n</thead>\n`
          i += 2
          const rows: string[] = []
          while (i < input.length && input[i]!.trim() && input[i]!.includes('|')) {
            const row = cells(input[i]!), location = first + i
            if (row.length > headers.length || input[i]!.includes('\\|')) complete = false
            emit('table-row', location)
            rows.push(`<tr>${headers.map((_, column) => cellHtml(row[column] ?? '', column, 'td', location)).join('')}</tr>\n`)
            i++
          }
          if (rows.length) html += `<tbody>\n${rows.join('')}</tbody>\n`
          html += '</table>\n'; continue
        }
      }
      if (i + 1 < input.length && /^ {0,3}(?:=+|-+)[ \t]*$/.test(input[i + 1]!)) {
        const level = input[i + 1]!.trim()[0] === '=' ? 1 : 2; emit('setext-heading', n, 'normalized')
        html += `<h${level}>${inline(line.trim(), n)}</h${level}>\n`; i += 2; continue
      }
      if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) { emit('thematic-break', n); html += '<hr>\n'; i++; continue }
      if (/^ {0,3}>/.test(line)) {
        const body: string[] = []; const start = i
        while (i < input.length && /^ {0,3}>/.test(input[i]!)) body.push(input[i++]!.replace(/^ {0,3}> ?/, ''))
        emit('block-quote', n); html += `<blockquote>\n${blocks(body, first + start, depth + 1)}</blockquote>\n`; continue
      }
      if ((match = /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line))) {
        const ordered = /\d/.test(match[1]!), tag = ordered ? 'ol' : 'ul'; emit(ordered ? 'ordered-list' : 'bullet-list', n)
        html += `<${tag}${ordered && parseInt(match[1]!, 10) !== 1 ? ` start="${parseInt(match[1]!, 10)}"` : ''}>\n`
        while (i < input.length && (match = /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(input[i]!)) && /\d/.test(match[1]!) === ordered) {
          emit('list-item', first + i); const body = match[2]!
          const task = /^\[([ xX])\][ \t]+(.*)$/.exec(body)
          if (task && ordered) {
            emit('ordered-task', first + i, 'dropped', 'structure-unspellable')
            html += `<li>${escape(body.slice(0, 3))} ${inline(task[2]!, first + i)}</li>\n`
          } else if (task) {
            emit('bullet-task', first + i)
            html += `<li><input type="checkbox"${task[1] === ' ' ? '' : ' checked'} disabled aria-label="${escape(task[2]!)}"> ${inline(task[2]!, first + i)}</li>\n`
          } else html += `<li>${inline(body, first + i)}</li>\n`
          i++
        }
        html += `</${tag}>\n`; continue
      }
      if (/^ {0,3}</.test(line) && /^(?: {0,3}<(?:div|table|script|style|pre|!--)(?:[\s>]|$))/i.test(line)) {
        const body: string[] = []
        while (i < input.length && input[i]!.trim() !== '') body.push(input[i++]!)
        if (body.some(text => /<\/?(?:section|h[1-6])\b/i.test(text))) complete = false
        emit('raw-html', n, 'degraded', 'raw-preserved'); html += body.join('\n') + '\n'; continue
      }
      const body: string[] = [line]; i++
      while (i < input.length && input[i]!.trim() !== '' && !/^(?: {0,3}(?:[#>`~]|[-+*][ \t]|\d+[.)][ \t]|\[[^\]]+\]:)| {4})/.test(input[i]!)) body.push(input[i++]!)
      emit('paragraph', n)
      if (body.some(text => /^ {0,3}\[|\|/.test(text)) || body.some(text => /\t/.test(text))) complete = false
      html += `<p>${inline(body.join('\n').trim(), n)}</p>\n`
    }
    return html
  }
  const expected = blocks(lines, 1)
  if (source.includes('\0')) complete = false
  if (complete) {
    try { if (htmlShape(expected) !== htmlShape(carveToHtml(value, { smartTypography: 'source' }))) complete = false }
    catch { complete = false }
  }
  return { diagnostics: complete ? diagnostics : [], complete }
}
