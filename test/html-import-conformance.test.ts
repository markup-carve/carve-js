import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'

const root = resolve(import.meta.dirname, '../spec/tests/html-import')

describe('shared HTML import contract', () => {
  for (const fixture of readdirSync(root)) {
    it(fixture, () => {
      const dir = resolve(root, fixture)
      const html = readFileSync(resolve(dir, 'input.html'), 'utf8')
      const expectedCarve = readFileSync(resolve(dir, 'expected.crv'), 'utf8')
      const expectedAst = JSON.parse(readFileSync(resolve(dir, 'expected.ast.json'), 'utf8'))
      const expectedReport = JSON.parse(readFileSync(resolve(dir, 'expected.report.json'), 'utf8'))
      const ast = htmlToAst(html)
      const carve = htmlToCarve(html)

      expect(carve.value).toBe(expectedCarve)
      expect(ast.value).toEqual(expectedAst)
      expect(ast.report).toMatchObject(expectedReport)
    })
  }
})
