import type { InlineNode } from './ast.js'

/**
 * PART 11 §5's LONE BRACKETS: a `[` or `]` left unpaired in the content a span,
 * link or inline note writes between its own brackets. They are in the
 * unconditional set, so they are decided from the tree before anything is
 * written, keyed by the node that writes the character and its offset in that
 * node's text.
 */
export type LoneBrackets = WeakMap<object, Set<number>>

/**
 * Text nodes of a run holding an empty code span. Neither §5 half selects a
 * bracket or `(` in them; the escape search decides them instead.
 */
export type LeftToSearch = WeakSet<object>

const UNWRITABLE_CONTROLS = /[\u0000\u000d]/g

const TRANSPARENT = new Set(['emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete'])

interface Site {
  owner: object
  offset: number
  char: string
}

interface Scope {
  content: readonly InlineNode[]
  bracketed: boolean
}

/**
 * Record the lone brackets of one inline scope and of every bracketed scope
 * nested in it. Iterative, because it runs before the render depth guard.
 */
export function collectLoneBrackets(
  nodes: readonly InlineNode[],
  bracketed: boolean,
  into: LoneBrackets,
  leftToSearch: LeftToSearch,
): void {
  const scopes: Scope[] = [{ content: nodes, bracketed }]
  for (let scope = scopes.pop(); scope !== undefined; scope = scopes.pop()) collectScope(scope, scopes, into, leftToSearch)
}

function collectScope({ content, bracketed }: Scope, scopes: Scope[], into: LoneBrackets, leftToSearch: LeftToSearch): void {
  const sites: Site[] = []
  const owners: object[] = []
  // A run holding an empty code span is left to the escape search whole: the
  // span is written as a bare backtick run, so a pairing read from the tree no
  // longer matches the written bytes, before the span or after it.
  let hasEmptyCode = false

  const addText = (owner: object, value: string): void => {
    owners.push(owner)
    if (!bracketed || !/[[\]]/.test(value)) return
    const text = value.replace(UNWRITABLE_CONTROLS, '')
    for (let offset = 0; offset < text.length; offset++) {
      const char = text[offset]!
      if (char === '[' || char === ']') sites.push({ owner, offset, char })
    }
  }

  // Lists still to read, innermost last, so text is met in document order.
  const pending: Array<readonly InlineNode[]> = [content]
  const cursors: number[] = [0]
  while (pending.length > 0) {
    const list = pending[pending.length - 1]!
    const index = cursors[cursors.length - 1]!
    if (index >= list.length) {
      pending.pop()
      cursors.pop()
      continue
    }
    cursors[cursors.length - 1] = index + 1
    const node = list[index]!
    const descend = (children: readonly InlineNode[]): void => {
      pending.push(children)
      cursors.push(0)
    }
    switch (node.type) {
      case 'text':
        addText(node, node.value)
        break
      case 'abbreviation':
        addText(node, node.abbr)
        break
      case 'code':
        if (node.value === '') hasEmptyCode = true
        break
      case 'small_caps':
        if (node.attrs === undefined) descend(node.children)
        else scopes.push({ content: node.children, bracketed: true })
        break
      case 'ruby': {
        // Written flattened: base, then the annotation in parentheses.
        const flattened = node.pairs.flatMap((pair) => [...pair.base, ...pair.annotation])
        if (node.attrs === undefined) descend(flattened)
        else scopes.push({ content: flattened, bracketed: true })
        break
      }
      case 'substitution':
        descend(node.new)
        descend(node.old)
        break
      case 'span':
        scopes.push({ content: node.children, bracketed: true })
        break
      case 'link':
        if (node.rawRef === undefined) scopes.push({ content: node.children, bracketed: true })
        break
      case 'inline_extension':
        // Its content ends at the first `]`, so a `[` there pairs with nothing.
        scopes.push({ content: node.content, bracketed: false })
        break
      case 'inline_footnote':
      case 'footnote_ref':
        if (node.inline !== undefined) scopes.push({ content: node.inline, bracketed: true })
        break
      default:
        if (TRANSPARENT.has(node.type)) descend((node as { children: InlineNode[] }).children)
    }
  }

  for (const owner of owners) {
    into.delete(owner)
    if (hasEmptyCode) leftToSearch.add(owner)
    else leftToSearch.delete(owner)
  }
  if (hasEmptyCode) return

  const lone: Site[] = []
  const open: Site[] = []
  for (const site of sites) {
    if (site.char === '[') open.push(site)
    else if (open.pop() === undefined) lone.push(site)
  }
  for (const site of open) lone.push(site)

  for (const site of lone) {
    let offsets = into.get(site.owner)
    if (offsets === undefined) into.set(site.owner, (offsets = new Set()))
    offsets.add(site.offset)
  }
}
