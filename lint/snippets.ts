// C2-N-096 and C2-B-236: the snippet rules, which read the authored tree and its registry.
import { type DocumentNode, forEachSlot, type Node } from '../src/ast.ts'
import { snippetRegistry } from '../src/snippet-expand.ts'
import { isAttributeLine } from '../src/lines.ts'
import { attributeLinesHoldId, readSnippetMarker } from '../src/snippets.ts'
import { type RuleId } from './catalog.ts'
import { type LintContext, type Rule } from './types.ts'

/** The names every authored use names, those inside definitions included (C2-N-096). */
export function usedNames(document: DocumentNode): Set<string> {
  const names = new Set<string>()
  const pending: Node[] = [document]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'snippet_use') names.add(node.name)
    forEachSlot(node, (nodes) => { for (const child of nodes) pending.push(child) }, undefined, document.extensions)
  }
  return names
}

/** C2-N-096: a winning definition no use names, at the `$` and the name of its marker. */
function unusedSnippets(document: DocumentNode, context: LintContext): void {
  const registry = snippetRegistry(document)
  if (registry.size === 0) return
  const used = usedNames(document)
  document.children.forEach((child, index) => {
    if (child.type !== 'snippet_definition' || child.pos === undefined || used.has(child.name)) return
    if (registry.get(child.name)?.definition !== child) return
    const start = context.chars[child.pos.startOffset]! + 1
    context.report('unused-snippet', start, start + 1 + child.name.length, `/children/${index}`, { name: child.name })
  })
}

/** The line `[start, end)` that starts at `start`, behind the attribute lines a block starting there took (C2-A-148). */
function firstContentLine(source: string, start: number): [number, number] {
  for (;;) {
    let end = source.indexOf('\n', start)
    if (end < 0) end = source.length
    const content = end > start && source.charCodeAt(end - 1) === 13 ? end - 1 : end
    if (end === source.length || !isAttributeLine(source, start, content)) return [start, content]
    start = end + 1
  }
}

/**
 * C2-B-236: the first line of a top-level paragraph that a marker with an id, or an id in the attribute lines above
 * it, made text, at the marker.
 */
function definitionIds(document: DocumentNode, context: LintContext): void {
  const source = context.source
  document.children.forEach((child, index) => {
    if (child.type !== 'paragraph' || child.pos === undefined || child.pos.startColumn !== 1) return
    const block = context.chars[child.pos.startOffset]!
    const [start, end] = firstContentLine(source, block)
    if (source.charCodeAt(start) !== 123 || source.charCodeAt(start + 1) !== 36) return
    const marker = readSnippetMarker(source, start, end)
    if (marker === null || !(marker.hasId || (start > block && attributeLinesHoldId(source, block, start)))) return
    const value = marker.markerEnd
    if (source.charCodeAt(value) !== 32 || source.slice(value + 1, end).trim() === '') return
    context.report('snippet-definition-id', start, value, `/children/${index}`)
  })
}

/** The snippet rules, which lintSnippets runs over the whole tree. */
export const SNIPPET_RULES: readonly Rule[] = [{ id: 'unused-snippet' }, { id: 'snippet-definition-id' }]

export function lintSnippets(document: DocumentNode, context: LintContext, active: (id: RuleId) => boolean): void {
  if (active('unused-snippet')) unusedSnippets(document, context)
  if (active('snippet-definition-id')) definitionIds(document, context)
}
