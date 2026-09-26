import { expect, it } from 'vitest'
import { completeDestinationOpeners, RE_LINK_REST, scanDestination } from '../src/link-destination.js'

it('the batch scan agrees with the parser for escapes, nesting, whitespace, and titles', () => {
  const check = (text: string) => {
    const actual = completeDestinationOpeners(text)
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '(') continue
      const scanned = scanDestination(text, i)
      const expected = scanned !== null && scanned.dest !== '' && RE_LINK_REST.test(text.slice(scanned.end))
      expect(actual.has(i), `${JSON.stringify(text)} at ${i}`).toBe(expected)
    }
  }
  const alphabet = ['(', ')', '\\', ' ', 'x', '"']
  for (let n = 0; n < alphabet.length ** 5; n++) {
    let text = ''
    let digits = n
    for (let i = 0; i < 5; i++) {
      text += alphabet[digits % alphabet.length]
      digits = Math.floor(digits / alphabet.length)
    }
    check(text)
  }
  for (const text of ['(url "title")', "(url 'title')", '(url "a\\"b")', '(url\t"title")', '(x(y z))', '(x\u00a0"title")', '(x\\\\)']) check(text)
})
