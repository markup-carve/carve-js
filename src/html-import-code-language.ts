import { domAttrs, domChildren, domParent, domTag, domValue, type P5Node } from './html-import-dom.js'

const HTML_SPACE = /[\t\n\f\r ]+/

export function codeLanguage(pre: P5Node, code: P5Node | undefined, wrappers: WeakMap<P5Node, P5Node | null>): string | undefined {
  const attr = (node: P5Node, name: string): string => domAttrs(node)?.find((a) => a.name === name)?.value ?? ''
  const classes = (node: P5Node): string[] => attr(node, 'class').split(HTML_SPACE)
  const valid = (value: string): boolean => value.length > 0 && !/[^a-zA-Z0-9_+#./-]/.test(value)
  const prefixed = (tokens: string[], prefix: string): string | undefined =>
    tokens.find((token) =>
      token.startsWith(prefix)
      && !(prefix === 'highlight-' && token.startsWith('highlight-source-'))
      && valid(token.slice(prefix.length)),
    )?.slice(prefix.length)
  for (const node of code ? [code, pre] : [pre]) {
    const tokens = classes(node)
    const language = prefixed(tokens, 'language-') ?? prefixed(tokens, 'lang-')
    if (language !== undefined) return language
    const data = attr(node, 'data-lang').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
    if (valid(data)) return data
    if (node === pre) {
      for (const match of attr(node, 'class').matchAll(/(?=(?:^|[\t\n\f\r ;])brush:[\t\n\f\r ]*([^\t\n\f\r ;]+))/g)) {
        if (valid(match[1]!)) return match[1]
      }
    }
  }
  // Lookup does not consume wrapper attributes or change their import policy.
  const wraps = (parent: P5Node | undefined, child: P5Node): parent is P5Node => {
    if (!parent || domTag(parent) !== 'div') return false
    if (!wrappers.has(parent)) {
      let element: P5Node | null = null
      const eligible = (domChildren(parent) ?? []).every((node) => {
        if (domTag(node) !== undefined) {
          if (element !== null) return false
          element = node
          return true
        }
        return node.nodeName === '#comment'
          || (node.nodeName === '#text' && !/[^\t\n\f\r ]/.test(domValue(node) ?? ''))
      })
      wrappers.set(parent, eligible ? element : null)
    }
    return wrappers.get(parent) === child
  }
  const parent = domParent(pre)
  if (!wraps(parent, pre)) return undefined
  const tokens = classes(parent)
  const direct = (tokens.includes('highlight') ? prefixed(tokens, 'highlight-source-') : undefined)
    ?? (tokens.includes('mw-highlight') ? prefixed(tokens, 'mw-highlight-lang-') : undefined)
  if (direct !== undefined) return direct
  const outer = domParent(parent)
  return tokens.includes('highlight') && wraps(outer, parent) ? prefixed(classes(outer), 'highlight-') : undefined
}

