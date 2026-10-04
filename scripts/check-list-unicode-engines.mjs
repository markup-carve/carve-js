import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { carveToHtml } from '../dist/index.js'

const [phpCli, rustCli] = process.argv.slice(2)
assert.ok(phpCli && rustCli, 'Usage: PHP_CLI RUST_CLI')
const fixtures = []
for (const separator of ['\u2028', '\u2029']) for (const ending of ['\n', '\r\n', '\r']) {
  for (const marker of ['- ', '* ', '1. ', 'a. ', '- [x] ', '-{#x} ', '2.{#x} ']) {
    fixtures.push(`${marker}before${separator}after${ending}`)
  }
  for (const marker of ['- ', '1. ', '- [x] ']) {
    const indent = marker === '1. ' ? '   ' : '  '
    fixtures.push(`${marker}::: note${separator}x${ending}${indent}# Heading${ending}${indent}:::${ending}`)
  }
  fixtures.push(`- one${ending}-{#x} two${separator}b${ending}- three${ending}`,
    `- a${separator}b${ending}  - c${separator}d${ending}`, `- a${separator}${ending}${ending}- b${ending}`)
}
for (const [engine, command, args] of [['PHP', 'php', [resolve(phpCli)]], ['Rust', resolve(rustCli), []]]) {
  for (const source of fixtures) {
    const result = spawnSync(command, args, { input: source, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, `${result.error ?? ''} ${result.stderr}`)
    assert.equal(result.stdout.replace(/\n$/, ''), carveToHtml(source), `${engine}: ${JSON.stringify(source)}`)
  }
  console.log(`${engine}: ${fixtures.length} Unicode list fixtures match JavaScript HTML`)
}
