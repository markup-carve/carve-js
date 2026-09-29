import { expect, it } from 'vitest'
import { carveToAnsi } from '../src/index.js'

it.each(['', '\n', '\n\n', 'a\n', 'a\n\n', 'a\n\n\n', '\na\n\n'])('preserves ANSI payload lines for %j', (payload) => {
  const source = '```\n' + payload + '```\n'
  const lines = payload === '' ? [] : payload.slice(0, -1).split('\n')
  const styled = lines.map(line => '\x1b[97m  ' + line + '\x1b[0m\n').join('')
  expect(carveToAnsi(source)).toBe(styled || '\n')
})


it.each(['```js', '~~~js'])('keeps a trailing blank line under %s', (opener) => {
  expect(carveToAnsi(opener + '\na\n\n' + opener.slice(0, 3) + '\n')).toBe(
    '\x1b[2m┌── js \x1b[0m\n\x1b[97m  a\x1b[0m\n\x1b[97m  \x1b[0m\n',
  )
})
