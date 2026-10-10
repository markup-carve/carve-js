export function djotDestinationLines(source: string, depth: number): string {
  if (!source.includes('\n')) return source
  return source
    .replace(/\\(?:\r?\n|[^\r\n])/g, value => value.endsWith('\n') ? '\n' : value)
    .replace(/\n([ \t]*[^\n]*)/g, (_all, tail: string) => {
      let rest = tail.replace(/^[ \t]*/, '')
      for (let n = 0; n < depth && /^>(?:[ \t]|$)/.test(rest); n++)
        rest = rest.slice(1).replace(/^[ \t]*/, '')
      return rest
    })
}
