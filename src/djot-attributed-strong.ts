import { readAttributes } from './djot-word-attributes.js'

/** Protect attributed words inside a Djot strong span while its body is migrated. */
export function attributedDjotStrong(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string): string {
  if (!source.includes('{')) return source
  const attribute = String.raw`\{(?:\s*(?:[.#][^\s{}"=]+|[\w:-]+=(?:"(?:\\.|[^"\\])*"|[^\s{}"]+)))+\s*\}`
  const pattern = new RegExp(String.raw`(?<![\\*])\*(?![\s*])([^*\n{}]+)(${attribute})([^*\n{}]*)(?<!\s)\*(?!\*)`, 'gu')
  let token = '\x00DJOTATTR\x00'
  while (source.includes(token)) token += '\x00'
  return source.replace(pattern, (whole: string, before: string, attrs: string, after: string, offset: number) => {
    if (masked[offset] !== '*' || masked[offset + whole.length - 1] !== '*' || /\\$/.test(after)) return whole
    const normalized = readAttributes(attrs, 0, true)
    if (!normalized) return whole
    const word = /[^\s*{}\[\]`_~^]+$/u.exec(before)
    if (!word || /[)\]`]/.test(before[word.index - 1] ?? '')) return whole
    const body = convert(`${before.slice(0, word.index)}[${word[0]}]${token}${after}`).replace(token, () => normalized.source)
    return protect(`{*${body}*}`)
  })
}
