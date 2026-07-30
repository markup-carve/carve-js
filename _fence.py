import io

p = 'src/render-carve.ts'
s = io.open(p, encoding='utf-8').read()

old = """    case 'code_block': {
      const fence = safeFence(node.content, 3)
      const info = codeFenceInfo(node.lang, node.header, node.label)
      return withAttrs(`${fence}${info}\\n${protectVerbatim(node.content)}\\n${fence}`)
    }"""

new = """    case 'code_block': {
      const fence = safeFence(node.content, 3)
      const info = codeFenceInfo(node.lang, node.header, node.label)
      // The opener's quoted title is resolved onto `attrs.title` at parse time
      // so it reaches every consumer, but the fence carries it too - emitting
      // both says it twice (`{title=x}` AND `\\`\\`\\` lang "x"`), which is longer
      // than the author wrote and re-parses with an attribute ORDER the source
      // never had (issue 369). The fence is the authored spelling, so it wins.
      const attrsWithoutTitle =
        node.header !== undefined && node.attrs?.keyValues?.['title'] === node.header
          ? renderBlockAttrs(withoutKey(node.attrs, 'title'))
          : attrs
      const body = `${fence}${info}\\n${protectVerbatim(node.content)}\\n${fence}`
      return attrsWithoutTitle ? `${attrsWithoutTitle}\\n${body}` : body
    }"""

assert old in s, 'code_block arm not matched'
s = s.replace(old, new, 1)

anchor = "function renderBlock(node: BlockNode, ctx: CarveContext): string {"
helper = """/** A copy of `attrs` without one key-value, dropping the slot from `order`. */
function withoutKey(attrs: Attrs | undefined, key: string): Attrs | undefined {
  if (!attrs?.keyValues || !(key in attrs.keyValues)) return attrs
  const keyValues = { ...attrs.keyValues }
  delete keyValues[key]
  const next: Attrs = { ...attrs, keyValues }
  if (next.order) next.order = next.order.filter((slot) => slot !== key)
  if (
    next.id === undefined &&
    (next.classes === undefined || next.classes.length === 0) &&
    Object.keys(keyValues).length === 0
  ) {
    return undefined
  }
  return next
}

"""
assert anchor in s
s = s.replace(anchor, helper + anchor, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
