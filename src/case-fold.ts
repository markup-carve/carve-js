import { FULL_FOLDS, SIMPLE_FOLDS } from './case-fold-tables.ts'

let folds: Map<number, string> | undefined

function foldTable(): Map<number, string> {
  if (folds !== undefined) return folds
  const table = new Map<number, string>()
  for (let at = 0; at < SIMPLE_FOLDS.length; at += 2) table.set(SIMPLE_FOLDS[at]!, String.fromCodePoint(SIMPLE_FOLDS[at + 1]!))
  for (const [from, to] of FULL_FOLDS) table.set(from, to)
  return (folds = table)
}

/** Unicode full default case folding (CaseFolding.txt status C and F), independent of locale. */
export function caseFold(text: string): string {
  let ascii = true
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) > 0x7f) { ascii = false; break }
  if (ascii) return text.toLowerCase()
  const table = foldTable()
  let out = ''
  for (const char of text) out += table.get(char.codePointAt(0)!) ?? char
  return out
}

/** C2-W-150: NFC, then full case folding, then NFC again. */
export const foldKey = (text: string): string => caseFold(text.normalize('NFC')).normalize('NFC')
