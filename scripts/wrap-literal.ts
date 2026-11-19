// The generators keep their output within the column limit of the lint config.
export const MAX_COLUMNS = 140

/**
 * `head`, the list of the literals `items`, and `tail`: on one line, spelled as JSON.stringify spells it, when that fits,
 * else the items packed onto lines indented two spaces deeper than `indent`.
 */
export function wrapList(head: string, items: readonly string[], tail = '', indent = ''): string[] {
  const flat = `${indent}${head}[${items.join(',')}]${tail}`
  if (flat.length <= MAX_COLUMNS) return [flat]
  const inner = `${indent}  `
  const lines = [`${indent}${head}[`]
  let line = ''
  for (const item of items) {
    const next = line === '' ? `${inner}${item},` : `${line} ${item},`
    if (line !== '' && next.length > MAX_COLUMNS) {
      lines.push(line)
      line = `${inner}${item},`
    } else {
      line = next
    }
  }
  if (line !== '') lines.push(line)
  lines.push(`${indent}]${tail}`)
  return lines
}

/** `wrapList` for the JSON spelling of each of `values`. */
export function wrapJson(head: string, values: readonly unknown[], tail = '', indent = ''): string[] {
  return wrapList(head, values.map((value) => JSON.stringify(value)), tail, indent)
}
