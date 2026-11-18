/** The construct spans promised by the new report rows on their shortest source examples. */
const MARKS: Record<string, [string, string]> = {
  'U-378': ['[^f]:', 'tail'], 'U-379': ['%% note', 'more'], 'U-380': ['[%% hidden]', '[%% hidden]'],
  'U-381': ['[/i/]', '[/i/]'], 'U-382': ['%% c', 'text'], 'U-383': ['%%%', '```'],
  'U-384': ['%% c', 'text'], 'U-385': ['%% c', '```'], 'U-386': ['>     :::', '```'],
  'U-387': [': para', '- li'], 'U-388': ['^[', ']'], 'U-389': ['={', '}'],
  'U-391': ['%%%', 'tail'], 'U-393': ['{~', '~}'], 'U-394': ['> %%%', '> %%%'],
  'U-395': ['{%', '%}'],
}

export function newMapRange(input: string, id: string): { startOffset: number; endOffset: number } | undefined {
  const marks = MARKS[id]
  if (marks === undefined) return undefined
  const start = input.indexOf(marks[0])
  const afterStart = id === 'U-394' ? marks[0].length : 0
  const end = start < 0 ? -1 : id === 'U-388' ? input.lastIndexOf(']') : input.indexOf(marks[1], start + afterStart)
  if (end < 0) return undefined
  return { startOffset: start, endOffset: end + marks[1].length }
}

interface ReplayChoice { id: string; when: (input: string, old: string, next: string) => boolean; pattern: RegExp }
interface ReplayRange { id: string; range: { startOffset: number; endOffset: number } }

const CHOICES: readonly ReplayChoice[] = [
    { id: 'U-378', when: (input, old, next) => old.includes('<dd></dd>') && next.includes('<dd') && input.includes('[^'),
      pattern: /\[\^[^\n]+\n(?:[ \t]+[^\n]*\n)?[^\n]*/u },
    { id: 'U-379', when: (input, old, next) => old.includes('<dt>') && next.includes('<dt') && input.includes('%%'),
      pattern: /%%[^\n]*\n[^\n]+/u },
    { id: 'U-381', when: (_input, old, next) => old.includes('class="div-label"><') && next.includes('class="div-label"'),
      pattern: /\[(?:\/[^\]\n]+\/|`[^\]\n]+`)\]/u },
    { id: 'U-382', when: (_input, old, next) => old.includes('<div class="inner">') && next.includes('class="inner"'),
      pattern: /%%[^\n]*\n[ \t]*[^\n]+/u },
    { id: 'U-382',
      when: (input, old, next) => input.includes('- :::') && old.includes('</ul>') && next.includes('<p'),
      pattern: /%{3,}[^\n]*\n(?:[^\n]*\n)?[ \t]*[^\n]+/u },
    { id: 'U-383', when: (input, old, next) => old.includes('<pre>') && next.includes('<pre') && input.includes('%%%'),
      pattern: /%%%[\s\S]*?```/u },
    { id: 'U-386', when: (input, old, next) => old.includes('<pre>') && next.includes('<pre') && input.includes('::: |'),
      pattern: /:::[^\n]*\n[^\n]*```/u },
    { id: 'U-389', when: (_input, old, next) => old.includes('<u>') && next.includes('={_'),
      pattern: /=\{_[^\n]*_\}/u },
    { id: 'U-393', when: (_input, old, next) => old.includes('{~') && next.includes('<s'),
      pattern: /\{~[^\n]*~\}/u },
]

/** Finds a source construct when a longer document reaches one of the replay causes. */
export function replayMapRange(input: string, old: string, next: string): ReplayRange | null {
  for (const choice of CHOICES) {
    if (!choice.when(input, old, next)) continue
    const match = choice.pattern.exec(input)
    if (match?.index === undefined) continue
    return { id: choice.id, range: { startOffset: match.index, endOffset: match.index + match[0].length } }
  }
  return null
}
