/** C2-X-057, C2-X-058: optional inline matchers with core text fallbacks. */
import { plainText } from '../ast-text.ts'
import { type ExtensionClaim, type ExtensionDefinition } from './types.ts'

function inlineTextClaim(name: string, claim: ExtensionClaim) {
  if (claim.form !== 'inline') return null
  return { type: 'inline_extension' as const, name, version: '1', children: [],
    fallback: [{ type: 'text' as const, value: plainText(claim.children) }] }
}

export const wikiExtension: ExtensionDefinition = {
  name: 'carve.wiki', version: '1', matcher: { form: 'inline', name: 'wiki' },
  props: {}, slots: {}, children: 'none', transform: (claim) => inlineTextClaim('carve.wiki', claim),
}

export const citeExtension: ExtensionDefinition = {
  name: 'carve.cite', version: '1', matcher: { form: 'inline', name: 'cite' },
  props: {}, slots: {}, children: 'none', transform: (claim) => inlineTextClaim('carve.cite', claim),
}
