import { type Context, type Rule } from '../context.ts'
import { attributeLines, openers } from './attributes.ts'
import { blankLines } from './blank-lines.ts'
import {
  commentLineBreaks, descriptionColumns, explicitInline, itemColumns, itemParagraphBreaks, lineComments, typedQuotes,
} from './late.ts'
import { definitions, definitionsAtTop, definitionsKept, definitionsKeptAfter, definitionsNested } from './definitions.ts'
import { escapes } from './escapes.ts'
import { fences } from './fences.ts'
import { inline, inlineBraced, lineBlockSpaces, unclosedRuns } from './inline.ts'
import { lists } from './lists.ts'
import { orderedTasks, taskBoxSpacing } from './ordered-tasks.ts'
import { shortcuts } from './shortcuts.ts'
import { includes, tables, tablesHeadStyles } from './tables.ts'
import {
  abbreviationSpaces, crossLineStrong, duplicateItemDefinitions, emptyAttributeQuote, flippedStrong, literalLinkBeforeCode,
  literalTableHeader, nestedOrderedStart, siblingListBoundary, wrappedCodeTableRow,
} from './replay-fallbacks.ts'

/** Starts the repairs of the replay rows (carve#6183) for the rules after it. */
function repairs(ctx: Context): void {
  ctx.repairs = true
}

/** Every rule, in the order of the contract's groups. The order does not decide which edit wins. */
export const RULES: readonly Rule[] = [blankLines, includes, lists, orderedTasks, taskBoxSpacing, attributeLines, openers, definitions,
  fences, tables, inline, lineBlockSpaces, escapes, shortcuts, unclosedRuns]

/** Rules that run only when the first pass leaves a difference, so a source that already upgrades keeps its result. */
export const LATE_RULES: readonly Rule[] = [lineComments, typedQuotes]

/** Each late variant replaces first-pass rules with the late rules in their place, tried in order. */
export const LATE_VARIANTS: readonly (readonly Rule[])[] = [
  [...RULES, ...LATE_RULES],
  [...RULES.map((rule) => rule === definitions ? definitionsAtTop : rule), ...LATE_RULES],
  [...RULES.map((rule) => rule === definitions ? definitionsKept : rule), ...LATE_RULES],
  [...RULES, ...LATE_RULES, commentLineBreaks],
  [...RULES.map((rule) => rule === inline ? inlineBraced : rule), ...LATE_RULES],
  [...RULES, ...LATE_RULES, explicitInline],
  [...RULES.map((rule) => rule === definitions ? definitionsNested : rule), ...LATE_RULES],
  [...RULES, ...LATE_RULES, descriptionColumns],
  [...RULES, ...LATE_RULES, itemColumns],
  [...RULES, ...LATE_RULES, itemParagraphBreaks],
  [...RULES.map((rule) => rule === tables ? tablesHeadStyles : rule), ...LATE_RULES],
  [...RULES.map((rule) => rule === definitions ? definitionsKeptAfter : rule), ...LATE_RULES],
  [repairs, ...RULES.map((rule) => rule === inline ? inlineBraced : rule === tables ? tablesHeadStyles : rule),
    ...LATE_RULES, descriptionColumns, flippedStrong, crossLineStrong, literalTableHeader, duplicateItemDefinitions, literalLinkBeforeCode,
    wrappedCodeTableRow, abbreviationSpaces, emptyAttributeQuote, siblingListBoundary, nestedOrderedStart],
]
