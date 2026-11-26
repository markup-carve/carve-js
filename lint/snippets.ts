// C2-N-096 and C2-B-236: the snippet rules, which read the authored tree and its registry.
import { type DocumentNode, forEachSlot, type Node } from '../src/ast.ts'
import { snippetRegistry } from '../src/snippet-expand.ts'
import { readSnippetMarker } from '../src/snippets.ts'
import { type RuleId } from './catalog.ts'
import { type LintContext, type Rule } from './types.ts'

/** The names every authored use names, those inside definitions included (C2-N-096). */
function usedNames(document: DocumentNode): Set<string> {
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

/** C2-B-236: the first line of a top-level paragraph that a marker with an id made text, at the marker. */
function definitionIds(document: DocumentNode, context: LintContext): void {
  const source = context.source
  document.children.forEach((child, index) => {
    if (child.type !== 'paragraph' || child.pos === undefined || child.pos.startColumn !== 1) return
    const start = context.chars[child.pos.startOffset]!
    if (source.charCodeAt(start) !== 123 || source.charCodeAt(start + 1) !== 36) return
    let end = source.indexOf('\n', start)
    if (end < 0) end = source.length
    const marker = readSnippetMarker(source, start, end)
    if (marker === null || !marker.hasId) return
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
