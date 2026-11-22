import { type Node } from '../src/ast.ts'
import { renderForLint, type ResolvedTree } from '../src/api.ts'
import { escapeAttribute } from '../src/html-attributes.ts'

/** The ids of a rendered document and the names of its `a` elements, as written and with their references decoded. */
export interface RenderedIds {
  readonly written: ReadonlySet<string>
  readonly decoded: readonly string[]
}

const COMMENT = /<!--[\s\S]*?-->/g
const TAG = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const REFERENCE = /&(?:#[xX]([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|(quot|apos|amp|lt|gt));/g
const NAMED: Readonly<Record<string, string>> = { quot: '"', apos: '\'', amp: '&', lt: '<', gt: '>' }

function decode(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(REFERENCE, (whole, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name]!
    const code = Number.parseInt(hex ?? decimal!, hex === undefined ? 10 : 16)
    return code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? whole : String.fromCodePoint(code)
  })
}

/** Every `id`, and the `name` of each `a`, in a text of HTML, as written and decoded. */
export function htmlIds(html: string): { written: string[], decoded: string[] } {
  const written: string[] = []
  const decoded: string[] = []
  for (const tag of html.replace(COMMENT, '').matchAll(TAG)) {
    const anchor = tag[1]!.toLowerCase() === 'a'
    for (const attribute of tag[2]!.matchAll(ATTRIBUTE)) {
      const name = attribute[1]!.toLowerCase()
      if (name !== 'id' && !(anchor && name === 'name')) continue
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
      written.push(value)
      decoded.push(decode(value))
    }
  }
  return { written, decoded }
}

/** C2-H-088, C2-H-089, C2-W-150: the ids and anchor names in the HTML of the run. */
export function renderedIds(resolved: ResolvedTree): RenderedIds {
  const found = htmlIds(renderForLint(resolved))
  return { written: new Set(found.written), decoded: found.decoded }
}

/** Whether a tree id is in the rendered HTML: the renderer escapes it, raw HTML may write it either way. */
export const isRendered = (ids: RenderedIds, decodedSet: ReadonlySet<string>, id: string): boolean =>
  decodedSet.has(id) || ids.written.has(escapeAttribute(id))

/** The nodes behind the ids that resolution generates and the tree does not carry: note marks, notes and titles. */
export function generatedIdNodes(resolved: ResolvedTree): Map<string, Node> {
  const out = new Map<string, Node>()
  const { resolution } = resolved
  for (const [node, id] of resolution.refIds) if (!out.has(id)) out.set(id, node)
  for (const note of resolution.notes) {
    const node = note.definition ?? note.inline
    if (node !== null && !out.has(note.id)) out.set(note.id, node)
  }
  for (const [node, id] of resolution.labelIds) if (!out.has(id)) out.set(id, node)
  return out
}
