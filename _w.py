import io

p = 'src/render-carve.ts'
s = io.open(p, encoding='utf-8').read()

old = """function escapeDestination(text: string): string {
  const scheme = /^[\\u0000-\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)?.[1]?.toLowerCase()
  const sanitizeBlank = scheme !== undefined && ['javascript', 'vbscript', 'data', 'file'].includes(scheme)
  // A backslash is a literal destination character (no destination escapes),
  // so it is emitted verbatim -- escaping it would double on re-parse.
  // Whitespace is percent-encoded (it would otherwise end the destination).
  return text
    .replace(/\\s/g, (ch) => (ch === ' ' ? '%20' : `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`))
    .replace(/[()]/g, (ch) => (sanitizeBlank ? (ch === '(' ? '%28' : '%29') : ch))
}"""

new = """function escapeDestination(text: string): string {
  // A parenthesis cannot survive a bare destination: the run stops at the first
  // `)`, so the href truncates and the rest leaks into the text. The angle form
  // is the spelling that can hold one, so use it rather than rewriting the URL
  // (carve#377). It cannot carry `<`, `>` or a newline, so a destination with
  // those falls through to the bare form below.
  if (/[()]/.test(text) && !/[<>\\n]/.test(text)) return `<${text}>`
  const scheme = /^[\\u0000-\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)?.[1]?.toLowerCase()
  const sanitizeBlank = scheme !== undefined && ['javascript', 'vbscript', 'data', 'file'].includes(scheme)
  // A backslash is a literal destination character (no destination escapes),
  // so it is emitted verbatim -- escaping it would double on re-parse.
  // Whitespace is percent-encoded (it would otherwise end the destination).
  return text
    .replace(/\\s/g, (ch) => (ch === ' ' ? '%20' : `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`))
    .replace(/[()]/g, (ch) => (sanitizeBlank ? (ch === '(' ? '%28' : '%29') : ch))
}"""

assert old in s, 'escapeDestination not matched'
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('ok')
