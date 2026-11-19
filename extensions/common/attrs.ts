import { isUrlAllowed } from '../../src/html-attributes.ts'
import type { Attrs, ExtensionRenderHost } from '../../src/index.ts'
import { styleIsDangerous } from '../blocks/svg-sanitize.ts'

const SAFE_NAME = /^[a-z_:][\w:.-]*$/i
const URL_NAMES = new Set(['href', 'src', 'poster', 'action', 'formaction', 'xlink:href'])
const BLOCKED_NAMES = new Set(['srcdoc', 'srcset', 'nonce', 'integrity', 'formaction', 'action'])

export function attrValue(attrs: Attrs | undefined, name: string): string | undefined {
  return attrs?.keyValues?.find(([key]) => key.toLowerCase() === name)?.[1]
}

export function authorAttrs(attrs: Attrs | undefined, host: ExtensionRenderHost, consumed: readonly string[] = []): string {
  if (attrs === undefined) return ''
  let result = ''
  if (attrs.id !== undefined) result += ` id="${host.escapeAttribute(attrs.id)}"`
  if (attrs.classes?.length) result += ` class="${host.escapeAttribute(attrs.classes.join(' '))}"`
  for (const [name, value] of attrs.keyValues ?? []) {
    result += safePair(name, value, host, consumed)
  }
  return result
}

function safePair(name: string, value: string, host: ExtensionRenderHost, consumed: readonly string[]): string {
  const lower = name.toLowerCase()
  if (!SAFE_NAME.test(name) || lower.startsWith('on') || BLOCKED_NAMES.has(lower) || consumed.includes(lower)) return ''
  if (URL_NAMES.has(lower) && !isUrlAllowed(value, host.urlPolicy)) return ` ${name}=""`
  if (lower === 'style' && styleIsDangerous(value)) return ` ${name}=""`
  return ` ${name}="${host.escapeAttribute(value)}"`
}

export function withClass(attrs: Attrs | undefined, base: string): Attrs {
  return { ...(attrs ?? {}), classes: [base, ...(attrs?.classes ?? [])] }
}
