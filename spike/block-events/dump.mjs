// Prints the block tree of a file, for reading the scanner's output by eye.
import { readFileSync } from 'node:fs'
import { KIND_NAMES, parseDirect } from './src/index.ts'

const src = readFileSync(process.argv[2], 'utf8')

function print(node, indent) {
  const text = node.spans === null ? '' : ' ' + JSON.stringify(spanText(node.spans))
  console.log(`${indent}${KIND_NAMES[node.kind]}(${node.aux}) ${node.start}-${node.end}${text}`)
  for (const child of node.children ?? []) print(child, indent + '  ')
}

function spanText(spans) {
  const lines = []
  for (let i = 0; i < spans.length; i += 2) lines.push(src.slice(spans[i], spans[i + 1]))
  return lines.join('\n')
}

print(parseDirect(src), '')
