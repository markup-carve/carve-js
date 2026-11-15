import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'
import { check } from './check.ts'
import { type Target } from './targets.ts'
import { random } from './generate.ts'

interface Regression {
  kind: string
  clause: string
  id: string
  seed: number
  inputJson?: string
}

const directory = 'v2/proptest/regressions'
for (const name of readdirSync(directory).filter((file) => file.endsWith('.crv'))) {
  const file = join(directory, name)
  const metadata = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Regression
  const source = metadata.inputJson ?? readFileSync(file, 'utf8')
  const target = name.split('-')[0] as Target
  void test(`${metadata.clause} ${metadata.id} ${metadata.kind} ${name}`, (context) => {
    const found = check(target, source, random(metadata.seed))
    if (found?.kind === 'writer-accounting') {
      assert.ok((found.losses ?? 0) + (found.refusals ?? 0) > 0)
      return
    }
    if (found !== null) {
      assert.equal(found.kind, metadata.kind)
      context.todo(`expected failure ${metadata.id}: ${found.kind}`)
      return
    }
    assert.equal(found, null)
  })
}
