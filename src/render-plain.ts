import type { BlockNode, DefinitionItem, Document, Figure, InlineNode, List, Table, Text } from './ast.js'

export interface PlainTextRenderOptions {}

export function renderPlainText(ast: Document, _opts: PlainTextRenderOptions = {}): string {
  const out = renderBlocks(ast.children)
  const footnotes = renderFootnoteDefs(ast)
  return normalize(`${out}${footnotes}`)
}

function renderBlocks(blocks: BlockNode[]): string {
  return blocks.map(renderBlock).join('')
}

function renderBlock(node: BlockNode): string {
  switch (node.type) {
    case 'heading':
      return `${renderInlines(node.children)}\n\n`
    case 'paragraph':
      if (isLegacyDefinitionParagraph(node)) {
        const [term, def] = legacyDefinitionParts(node)
        return `${term}\n  ${def}\n\n`
      }
      return `${renderInlines(node.children)}\n\n`
    case 'code-block':
      return `${stripControls(node.content)}\n\n`
    case 'blockquote':
      return `"${renderBlocks(node.children).trim()}"\n\n`
    case 'list':
      return renderList(node)
    case 'thematic-break':
      return '---\n\n'
    case 'table':
      return renderTable(node)
    case 'admonition': {
      const body = renderBlocks(node.children)
      const title = node.title !== undefined ? renderInlines(node.title) : ''
      if (title !== '') {
        return `${title}\n\n${body}`
      }
      return body
    }
    case 'div':
      return renderBlocks(node.children)
    case 'definition-list':
      return renderDefinitionList(node.items, true)
    case 'figure':
      return renderFigure(node)
    case 'image':
      return node.alt
    case 'raw-block':
    case 'abbreviation-def':
    case 'comment':
      return ''
    default: {
      const t: never = node
      throw new Error(`renderPlainText: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderList(node: List): string {
  let out = ''
  let counter = node.start ?? 1
  for (const item of node.items) {
    out += node.ordered ? `${counter}. ` : '- '
    counter++
    out += `${renderBlocks(item.children).trim()}\n`
  }
  return `${out}\n`
}

function renderDefinitionList(items: DefinitionItem[], trailingBlank: boolean): string {
  let out = ''
  for (const item of items) {
    for (const term of item.terms) out += `${renderInlines(term)}\n`
    for (const def of item.definitions) out += `  ${renderBlocks(def).trim()}\n`
  }
  return trailingBlank ? `${out}\n` : out
}

function renderTable(node: Table): string {
  let out = ''
  for (const row of node.rows) {
    out += `${row.cells.map((cell) => renderInlines(cell.children).trim()).join(' | ')}\n`
  }
  if (node.caption) out = `${out.trimEnd()}\n${renderInlines(node.caption)}\n`
  return `${out}\n`
}

function renderFigure(node: Figure): string {
  const target =
    node.target.type === 'image'
      ? node.target.alt
      : node.target.type === 'table'
        ? renderTable(node.target).trim()
        : renderBlock(node.target).trim()
  // A block-level target (a code-block listing or a display-math equation)
  // keeps the caption on its own line; an inline image target stays adjacent.
  const sep = node.target.type === 'code-block' || node.target.type === 'paragraph' ? '\n' : ''
  return `${target}${sep}${renderInlines(node.caption)}`
}

function renderFootnoteDefs(ast: Document): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    out += `[${label}]: ${renderBlocks(blocks).trim()}\n`
  }
  return out
}

function renderInlines(nodes: InlineNode[]): string {
  return nodes.map(renderInline).join('')
}

function renderInline(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return cleanEscapedText(node)
    case 'italic':
    case 'strong':
    case 'underline':
    case 'super':
    case 'sub':
    case 'highlight':
    case 'bold-italic':
    case 'span':
    case 'critic-insert':
    case 'strike':
      return renderInlines(node.children)
    case 'critic-delete':
      return `~${renderInlines(node.children)}~`
    case 'code':
      return stripControls(node.value)
    case 'link':
      return node.href.startsWith('#') ? renderInlines(node.children) : stripControls(node.href)
    case 'image':
      return node.alt
    case 'math':
      return stripControls(node.content)
    case 'raw-inline':
      return ''
    case 'emoji':
      return `:${node.name}:`
    case 'autolink':
      return stripControls(node.href.startsWith('mailto:') ? node.href.slice(7) : node.href)
    case 'mention':
      return `@${node.user}`
    case 'tag':
      return `#${node.name}`
    case 'extension':
      return renderInlines(node.content)
    case 'abbreviation':
      return node.abbr
    case 'footnote':
      return node.inline ? `(${renderInlines(node.inline)})` : `[${node.id ?? ''}]`
    case 'soft-break':
      return ' '
    case 'hard-break':
      return '\n'
    case 'critic-substitute':
      // Keep both sides (old struck like critic-delete, then new).
      return `~${node.oldText}~${node.newText}`
    case 'critic-comment':
      return ''
    case 'crossref':
      return `</#${node.target}>`
    case 'caption-number':
      return node.n === undefined ? '#' : String(node.n)
    case 'citation-group':
      // Tier-2 ext node; the core renderer has no numbering, so emit the source.
      return node.raw
    case 'comment':
      return ''
    default: {
      const t: never = node
      throw new Error(`renderPlainText: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

function normalize(text: string): string {
  // The internal non-breaking-space placeholder (U+E000) collapses to an
  // ordinary space in plain text. Done after trimming so placeholder-derived
  // leading indentation (e.g. in a line block) survives; a literal U+00A0 in
  // the author's text is left intact.
  return `${text.replace(/\n{3,}/g, '\n\n').trim()}\n`.replace(/\ue000/g, ' ')
}

function cleanEscapedText(node: Text): string {
  // The value is the literal text (the parser already resolved backslash
  // escapes), so a `\*` reaches here as `*`. Strip control bytes so attacker
  // text cannot inject terminal escape sequences (see stripControls).
  return stripControls(node.value)
}

/** Drop C0/C1 control characters (keeping tab and newline) from author content
 *  so attacker ESC / OSC sequences cannot inject into terminal output. */
function stripControls(s: string): string {
  return s.replace(/\p{Cc}/gu, (c) => (c === '\t' || c === '\n' ? c : ''))
}

function isLegacyDefinitionParagraph(node: { children: InlineNode[] }): boolean {
  return (
    node.children.length === 3 &&
    node.children[0]?.type === 'text' &&
    node.children[0].value.startsWith(': ') &&
    node.children[1]?.type === 'soft-break' &&
    node.children[2]?.type === 'text'
  )
}

function legacyDefinitionParts(node: { children: InlineNode[] }): [string, string] {
  return [
    ((node.children[0] as Text).value).slice(2),
    (node.children[2] as Text).value,
  ]
}
