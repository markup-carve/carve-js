import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { DocumentTransform } from '../../src/api.ts'
import type { Attrs, DocumentNode, Node } from '../../src/ast.ts'
import { walkView } from './view.ts'

/** Node type to default attributes; `class` adds classes, `id` sets a missing id, any other key a missing pair. */
export type DefaultAttributesMap = Readonly<Record<string, Readonly<Record<string, string>>>>

function addClasses(attrs: Attrs, value: string): void {
  const classes = attrs.classes ?? []
  for (const entry of value.split(' ')) if (entry !== '' && !classes.includes(entry)) classes.push(entry)
  if (classes.length > 0) attrs.classes = classes
}

function applyDefaults(node: Node, defaults: Readonly<Record<string, string>>): void {
  const attrs: Attrs = node.attrs ?? {}
  for (const [name, value] of Object.entries(defaults)) {
    if (name === 'class') addClasses(attrs, value)
    else if (name === 'id') attrs.id ??= value
    else if (attrs.keyValues?.some(([key]) => key === name) !== true) attrs.keyValues = [...(attrs.keyValues ?? []), [name, value]]
  }
  if (attrs.id !== undefined || attrs.classes !== undefined || attrs.keyValues !== undefined) Reflect.set(node, 'attrs', attrs)
}

/** Default attributes per node type, merged under the authored ones in the render view (C2-X-053). */
export function defaultAttributes(defaults: DefaultAttributesMap): ExtensionBundle {
  const byType = new Map(Object.entries(defaults))
  const transform: DocumentTransform = { name: 'carve.defaultAttributes', transform(view: DocumentNode) {
    walkView(view, (nodes) => {
      for (const node of nodes) {
        const entry = byType.get(node.type)
        if (entry !== undefined) applyDefaults(node, entry)
      }
    }, view.extensions)
    return view
  } }
  return { extensions: [], renderers: {}, transforms: [transform] }
}
