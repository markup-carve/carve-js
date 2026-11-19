/** C2-X-064 to C2-X-065: standard details and spoiler claims with core fallbacks. */
import { type Block, type BlockExtensionNode, type InlineExtensionNode } from '../../ast.ts'
import { divSource, remainingAttrs } from '../claims.ts'
import { type ExtensionClaim, type ExtensionDefinition } from '../types.ts'

function blockClaim(name: string, claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'div') return null
  const fallback: Block[] = []
  if (claim.node.title?.length) {
    fallback.push({ type: 'paragraph', children: [{ type: 'strong', children: structuredClone(claim.node.title) }] })
  }
  fallback.push(...structuredClone(claim.node.children))
  const attrs = claim.attrs === undefined ? undefined : remainingAttrs(claim.attrs)
  return { type: 'block_extension', name, version: '1', children: [],
    slots: { title: claim.node.title ?? [], body: claim.node.children }, fallback,
    source: divSource(claim.node, claim.name), ...(claim.node.pos === undefined ? {} : { pos: claim.node.pos }),
    ...(attrs === undefined ? {} : { attrs }) }
}

export const detailsExtension: ExtensionDefinition = {
  name: 'carve.details', version: '1', matcher: { form: 'div', name: 'details' },
  props: {}, slots: { title: { kind: 'inline', optional: true }, body: { kind: 'block' } },
  children: 'none', transform: (claim) => blockClaim('carve.details', claim),
}

export const spoilerBlockExtension: ExtensionDefinition = {
  name: 'carve.spoilerBlock', version: '1', matcher: { form: 'div', name: 'spoiler' },
  props: {}, slots: { title: { kind: 'inline', optional: true }, body: { kind: 'block' } },
  children: 'none', transform: (claim) => blockClaim('carve.spoilerBlock', claim),
}

export const spoilerExtension: ExtensionDefinition = {
  name: 'carve.spoiler', version: '1', matcher: { form: 'inline', name: 'spoiler' },
  props: {}, slots: {}, children: 'none', transform: (claim): InlineExtensionNode | null => claim.form === 'inline'
    ? { type: 'inline_extension', name: 'carve.spoiler', version: '1', children: [], fallback: structuredClone(claim.children) }
    : null,
}

export const spoilerExtensions: readonly ExtensionDefinition[] = [spoilerExtension, spoilerBlockExtension]
