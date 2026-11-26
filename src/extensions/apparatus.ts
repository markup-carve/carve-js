// Shared parts of the reference apparatus extensions (glossary, index, citations): a matcher node, a document
// transform that resolves it against the whole view, and a renderer that writes the core content the transform built.
import { pushAll } from '../arrays.ts'
import { type Block, type BlockExtensionNode, type DirectiveNode, type DocumentNode, forEachSlot, type Inline,
  type InlineExtensionNode, type Node } from '../ast.ts'
import { type ExtensionDefinition, type ExtensionRenderer, type ExtensionRenderHost } from './types.ts'

export { type ExtensionBundle } from './standard/bundle.ts'

/** C2-X-022: core content of the same role; an extension node gives its fallback, or its children as a span. */
export function coreInlines(nodes: readonly Inline[]): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
    if (node.type === 'inline_extension') {
      if (node.name.includes('.')) pushAll(out, structuredClone(node.fallback ?? []))
      else out.push({ type: 'span', attrs: { classes: [`ext-${node.name}`] }, children: coreInlines(node.children) })
      continue
    }
    const copy = structuredClone(node)
    if ('children' in copy && Array.isArray(copy.children)) Reflect.set(copy, 'children', coreInlines(copy.children as Inline[]))
    out.push(copy)
  }
  return out
}

/** A copy of `nodes` in which every extension node is its fallback, so it can stand in a qualified fallback. */
export function coreBlocks<T extends Node>(nodes: readonly T[]): T[] {
  const out: T[] = []
  for (const node of nodes) {
    if (node.type === 'block_extension') {
      pushAll(out, structuredClone(node.fallback) as unknown as T[])
      continue
    }
    if (node.type === 'inline_extension') {
      pushAll(out, coreInlines([node]) as unknown as T[])
      continue
    }
    const copy = structuredClone(node)
    forEachSlot(copy, (children) => {
      const replaced = coreBlocks(children)
      for (const [at, child] of replaced.entries()) Reflect.set(children, at, child)
      Reflect.set(children, 'length', replaced.length)
    })
    out.push(copy)
  }
  return out
}

/**
 * Visits every node of the view below `node` in document order, skipping the fallback of an extension node. A visit that
 * returns a node replaces the visited one in its list; `false` skips its subtree.
 */
export function walkView(view: DocumentNode, visit: (node: Node, parent: Node) => Node | false | undefined): void {
  const walk = (node: Node): void => {
    forEachSlot(node, (nodes, step) => {
      if (step === 'fallback') return
      for (let at = 0; at < nodes.length; at++) {
        const child = nodes[at]
        if (child === undefined) continue
        const result = visit(child, node)
        if (result === false) continue
        if (result !== undefined) {
          Reflect.set(nodes, at, result)
          continue
        }
        walk(child)
      }
    }, undefined, view.extensions)
  }
  walk(view)
}

/** Every authored id of the view, for generated ids that must not take one (C2-X-055). */
export function viewIds(view: DocumentNode): Set<string> {
  const ids = new Set<string>()
  walkView(view, (node) => {
    if (node.attrs?.id !== undefined) ids.add(node.attrs.id)
    if (node.type === 'heading' && node.generatedId !== undefined) ids.add(node.generatedId)
    return undefined
  })
  return ids
}

/** `base`, or `base-2`, `base-3` and so on: the first that `taken` does not hold. Takes it. */
export function freshId(base: string, taken: Set<string>): string {
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

/** C2-X-054: an inserted node needs its declaration on the root. */
export function declare(view: DocumentNode, definitions: readonly ExtensionDefinition[]): void {
  const declared = view.extensions ?? []
  for (const definition of definitions) {
    if (declared.some((entry) => entry.name === definition.name)) continue
    declared.push({ name: definition.name, version: definition.version, required: false, slots: Object.keys(definition.slots) })
  }
  declared.sort((a, b) => a.name.localeCompare(b.name))
  view.extensions = declared
}

/** A block node that claims a directive: its body is the rewritten directive, its fallback the authored one. */
export function claimDirective(name: string, authored: DirectiveNode, body: Block[]): BlockExtensionNode {
  const node: BlockExtensionNode = { type: 'block_extension', name, version: '1', children: [],
    slots: { body }, fallback: coreBlocks([authored]) }
  if (authored.pos !== undefined) node.pos = authored.pos
  return node
}

/** The schema of a directive claim. */
export function directiveDefinition(name: string): ExtensionDefinition {
  return { name, version: '1', props: {}, slots: { body: { kind: 'block' } }, children: 'none' }
}

/** The attributes of an inline node with `base` as its first class and without the keys `drop` names. */
export function inlineAttributes(node: InlineExtensionNode, host: ExtensionRenderHost, base: string,
  drop: (key: string) => boolean): string {
  const attrs = node.attrs ?? {}
  const keyValues = attrs.keyValues?.filter(([key]) => !drop(key))
  const copy: InlineExtensionNode = { ...node, attrs: { ...attrs, classes: [base, ...attrs.classes ?? []] } }
  if (keyValues === undefined || keyValues.length === 0) delete copy.attrs?.keyValues
  else if (copy.attrs !== undefined) copy.attrs.keyValues = keyValues
  return host.attributes(copy)
}

/** One renderer for both channels: the transform built core content, so static output is the same (C2-X-052). */
export function slotRenderer(slot: string, wrap?: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost,
  html: string) => string): ExtensionRenderer {
  const write = (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string => {
    const content = node.slots?.[slot] ?? []
    const html = node.type === 'block_extension' ? host.blocks(content) : host.inlines(content)
    return wrap === undefined ? html : wrap(node, host, html)
  }
  return { version: '1', render: write, buildTime: write }
}

/** The key-value of an attribute, the last one written. */
export function attribute(node: Node, key: string): string | undefined {
  const pairs = node.attrs?.keyValues
  if (pairs === undefined) return undefined
  for (let at = pairs.length - 1; at >= 0; at--) if (pairs[at]?.[0] === key) return pairs[at]?.[1]
  return undefined
}
