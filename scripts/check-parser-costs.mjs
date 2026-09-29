import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as candidate from '../dist/index.js'

const baseline = await import(pathToFileURL(resolve(process.argv[2])).href)
let count = 0
function check(source, label) {
  for (const options of [{}, { positions: false }]) {
    assert.deepEqual(candidate.parse(source, options), baseline.parse(source, options), label)
  }
  assert.equal(candidate.carveToHtml(source), baseline.carveToHtml(source), label)
  count++
}
const corpus = new URL('../spec/tests/corpus/', import.meta.url)
for (const name of readdirSync(corpus).filter(name => name.endsWith('.crv')).sort()) {
  check(readFileSync(new URL(name, corpus), 'utf8'), name)
}
let seed = 0x12345678
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
const fragments = ['a', '😀', '\ud800', '\udc00', '\u00a0', ' ', '\t', '\n', '\r\n', '\r', '> ', '- ', '1. ', '[r]: /u', '[r][r]', '*[A]: B', '[^n]: note', '[^n]', '%% note', '%%%\n', '```\n', '`a`', '*b*', '/c/', ':: term', ': body', '::: note', '{.x}', '+\n', '| a | b |']
for (let i = 0; i < 3000; i++) {
  const length = 1 + random() % 30
  let source = ''
  for (let j = 0; j < length; j++) source += fragments[random() % fragments.length]
  check(source, `generated-${i}`)
}
console.log(`${count} corpus and generated sources preserve ASTs, position-free ASTs and HTML`)
