import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('24-ast-contract: an invalid header-rows count synthesizes no partition', () => {
  it.each(['7', '3', '0', '-1', 'abc'])('keeps a native header cell in one body group at %s', (count) => {
    expect(carveToHtml(`{header-rows=${count}}\n|= a |\n| b |\n`)).toBe(
      '<table>\n  <tbody>\n    <tr><th scope="row">a</th></tr>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>',
    )
  })
})
