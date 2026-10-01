/*
 * The `destination-denied` message is normative text (PART 11 §1d).
 *
 * Ruled in markup-carve/carve#2686: the row carries exactly one of two strings
 * and appends nothing. The target used to be appended, which both repeated the
 * `target` field and let the wording drift per engine.
 *
 * The two literals are READ from the spec schema rather than written out here.
 * Hand-copying them into four engines is how they drifted in the first place.
 * The schema can only gate membership in the pair, so the pairing - which sink
 * takes which string - is asserted against a real render.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtmlWithReport } from '../src/index.js'

const SCHEMA = JSON.parse(
  readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8'),
) as {
  properties: {
    losses: {
      items: {
        oneOf: Array<{ properties: { code?: { const?: string }; message?: { enum?: string[] } } }>
      }
    }
  }
}

const MESSAGES = SCHEMA.properties.losses.items.oneOf.find(
  (branch) => branch.properties.code?.const === 'destination-denied',
)?.properties.message?.enum

/** One denied link and one denied image in one document (corpus category 536). */
const BOTH = '[report me](javascript:one) and ![report me too](vbscript:two)'

describe('the canonical destination-denied message', () => {
  it('finds both normative strings in the spec schema', () => {
    expect(MESSAGES).toHaveLength(2)
  })

  it('reports each sink its own canonical string, with nothing appended', () => {
    const image = MESSAGES?.find((text) => text.includes('image'))
    const destination = MESSAGES?.find((text) => !text.includes('image'))
    const losses = carveToHtmlWithReport(BOTH).losses

    expect(losses.map((loss) => loss.code)).toEqual(['destination-denied', 'destination-denied'])
    expect(losses.map((loss) => loss.message)).toEqual([destination, image])
  })
})
