import type { DefaultTreeAdapterTypes as Dom } from 'parse5'

export type P5Node = Dom.Node

export function domTag(node: P5Node | null | undefined): string | undefined {
  return node && 'tagName' in node ? node.tagName : undefined
}
export function domAttrs(node: P5Node | null | undefined): Dom.Element['attrs'] | undefined {
  return node && 'attrs' in node ? node.attrs : undefined
}
export function domChildren(node: P5Node | null | undefined): Dom.ChildNode[] | undefined {
  return node && 'childNodes' in node ? node.childNodes : undefined
}
export function domParent(node: P5Node | null | undefined): Dom.ParentNode | undefined {
  return node && 'parentNode' in node ? node.parentNode ?? undefined : undefined
}
export function domValue(node: P5Node | null | undefined): string | undefined {
  return node && 'value' in node ? node.value : undefined
}
export function domData(node: P5Node | null | undefined): string | undefined {
  return node && 'data' in node ? node.data : undefined
}
export function domContainer(node: P5Node): Dom.ParentNode {
  if (!('childNodes' in node)) throw new TypeError('Expected an HTML container')
  return node
}
export function domChild(node: P5Node): Dom.ChildNode {
  if (!('parentNode' in node)) throw new TypeError('Expected an HTML child node')
  return node
}
