export const djotStructuralPrefixSteps = { count: 0 }

export function djotStructuralPrefixEnd(line: string): number {
  let at = 0
  const spaces = () => {
    while (line[at] === ' ' || line[at] === '\t') { at++; djotStructuralPrefixSteps.count++ }
  }
  do { spaces(); if (line[at] !== '>') break; at++; djotStructuralPrefixSteps.count++ } while (at < line.length)
  spaces()
  for (;;) {
    djotStructuralPrefixSteps.count++
    const start = at
    let end = at
    if ('-*+'.includes(line[end] ?? '\0')) end++
    else {
      while (line[end] !== undefined && line[end]! >= '0' && line[end]! <= '9') { end++; djotStructuralPrefixSteps.count++ }
      if (end === start || line[end] !== '.' && line[end] !== ')') break
      end++
    }
    if (line[end] !== ' ' && line[end] !== '\t') break
    at = end; spaces()
    if (line[at] === '[' && ' xX-'.includes(line[at + 1] ?? '\0') && line[at + 2] === ']' && (line[at + 3] === ' ' || line[at + 3] === '\t')) {
      at += 3; djotStructuralPrefixSteps.count += 3; spaces()
    }
  }
  return at
}

