import { isUrlAllowed, keyValue } from '../../src/html-attributes.ts'
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
  // C2-H-161: an authored value passes the filter of the core renderer, whatever the key.
  return ` ${name}="${host.escapeAttribute(keyValue(lower, value))}"`
}

/** C2-H-009: generated declarations join the authored `style` at its place, or follow the authored keys as a new one. */
export function withStyle(attrs: Attrs | undefined, declarations: string): Attrs | undefined {
  if (declarations === '') return attrs
  const keyValues = attrs?.keyValues ?? []
  const at = keyValues.findIndex(([key]) => key.toLowerCase() === 'style')
  if (at < 0) return { ...(attrs ?? {}), keyValues: [...keyValues, ['style', declarations]] }
  const [key, value] = keyValues[at]!
  const authored = styleIsDangerous(value) ? '' : value.replace(/[ ;]+$/, '')
  const merged: [string, string] = [key, authored === '' ? declarations : `${authored}; ${declarations}`]
  return { ...attrs, keyValues: keyValues.map((pair, index) => index === at ? merged : pair) }
}

export function withClass(attrs: Attrs | undefined, base: string): Attrs {
  return { ...(attrs ?? {}), classes: [base, ...(attrs?.classes ?? [])] }
}
