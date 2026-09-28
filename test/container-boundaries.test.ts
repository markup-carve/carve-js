import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/container-boundaries.json', import.meta.url), 'utf8')) as Array<{
  name: string
  source: string
  html: string
}>

describe('container ownership and continuation boundaries', () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    expect(carveToHtml(fixture.source).trim()).toBe(fixture.html)
  })
})
