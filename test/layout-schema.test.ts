import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { parseWithLayout, validateLayout } from '../src/index.ts'
import { EXAMPLES } from './support/conformance.ts'

const schema = JSON.parse(readFileSync(join(import.meta.dirname, '../data/layout-schema.json'), 'utf8')) as AnySchema
const valid = new Ajv2020({ strict: true, allErrors: false }).compile(schema)

describe('layout schema agreement', () => {
  it('C2-L-007, C2-L-055: every example record passes the reader and the version 2 schema', () => {
    const inputs = [...EXAMPLES.map((example) => example.input), '{{ a.crv @cols:"a,b" @shift:+2 }}',
      '| a |\n+ b |\n', '\ufeffa\r\nb\r\n']
    for (const source of inputs) {
      const record = parseWithLayout(source).layout
      expect(() => validateLayout(record)).not.toThrow()
      expect(valid(record), `${source.slice(0, 80)}: ${JSON.stringify(valid.errors)}`).toBe(true)
    }
  })
})
