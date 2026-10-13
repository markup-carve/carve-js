import { expect, it } from 'vitest'
import { markdownToCarve } from '../src/index.js'

it('keeps CommonMark example 354 symbol delimiters literal', () => {
  expect(markdownToCarve('*£*bravo.\n\n*€*charlie.')).toBe('*£*bravo.\n\n*€*charlie.')
  expect(markdownToCarve('*$*alpha.')).toBe('*$*alpha.')
})
