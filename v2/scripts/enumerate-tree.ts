// Every document of up to N lines over the alphabet of line shapes, or every content of up to N
// inline tokens, through the checks of the public tree and of the HTML (test/support/tree-checks.ts).
// Fails on the first size that violates a property.
//   node v2/scripts/enumerate-tree.ts lines 3
//   node v2/scripts/enumerate-tree.ts tokens 4
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { INLINE_TOKENS } from '../test/support/inline-enumerate.ts'
import { enumerateTrees } from '../test/support/tree-checks.ts'

const kind = process.argv[2] ?? 'lines'
const max = Number(process.argv[3] ?? '3')
for (let size = 1; size <= max; size++) {
  const started = Date.now()
  const result = kind === 'tokens' ? enumerateTrees(INLINE_TOKENS, size, '', 'x') : enumerateTrees(LINE_SHAPES, size, '\n', '')
  console.log(`${size} ${kind}: ${result.documents} documents, ${result.failures.length} failures, ${Date.now() - started} ms`)
  for (const failure of result.failures) console.log(`  ${failure}`)
  if (result.failures.length > 0) process.exitCode = 1
}
