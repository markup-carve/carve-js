import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { wireFieldsSource } from "../scripts/generate-wire-fields.mjs";
import {
  WIRE_FIELDS,
  WIRE_NESTED_RECORDS,
  WIRE_RECORD_FIELDS,
} from "../src/wire-fields.js";

/**
 * `src/wire-fields.ts` is GENERATED from the pinned AST schema, and PART 12
 * section 11 is only as good as that map: a field the schema gained but the map
 * does not name would be refused on ingest even though it is valid.
 *
 * A committed copy of a file that lives somewhere else rots silently, so the
 * generator runs here and the result is compared. The schema moving without the
 * map moving is exactly what this fails on.
 */
describe("the generated wire-field map", () => {
  const root = resolve(import.meta.dirname, "..");

  it("matches what the pinned schema produces", () => {
    const schema = JSON.parse(
      readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
    );
    const committed = readFileSync(resolve(root, "src/wire-fields.ts"), "utf8");

    expect(committed, "run: node scripts/generate-wire-fields.mjs").toBe(
      wireFieldsSource(schema),
    );
  });

  it("names every type the schema closes", () => {
    // The control on the comparison above, which passes for two empty files.
    const schema = JSON.parse(
      readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
    );
    const closed = Object.values(
      schema.$defs as Record<string, Record<string, unknown>>,
    )
      .map(
        (def) =>
          (def.properties as Record<string, { const?: unknown }> | undefined)
            ?.type?.const,
      )
      .filter((type): type is string => typeof type === "string");

    expect(closed.length).toBeGreaterThan(50);
    expect(Object.keys(WIRE_FIELDS).sort()).toEqual([...closed].sort());
  });

  it("names every closed record the schema nests, not a hand-picked two", () => {
    // The control that was missing when `attrs` and `pos` were listed in the
    // generator by name: asserting the map held exactly those two PASSED while
    // `table.rowGroups` was validated as `"object"` and nothing more, because
    // the assertion restated the hard-coded list rather than the schema.
    //
    // So this walks the schema for the shape instead: an object with named
    // properties and `additionalProperties: false`, written INLINE under a
    // property rather than as a typed node. `citation` is absent by design -
    // `citation_group.items` is a NODE position, ruled on by
    // `NODE_POSITION_KIND`, and claiming it here too would be two producers of
    // one rule.
    const schema = JSON.parse(
      readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
    );
    const inlineRecords: string[] = [];
    const walk = (owner: string, properties: Record<string, any>) => {
      for (const [field, property] of Object.entries(properties ?? {})) {
        const one = property?.type === "array" ? property.items : property;
        if (
          one?.type !== "object" ||
          one.properties === undefined ||
          one.additionalProperties !== false
        ) {
          continue;
        }
        inlineRecords.push(`${owner}.${field}`);
        walk(`${owner}.${field}`, one.properties);
      }
    };
    for (const def of Object.values(
      schema.$defs as Record<string, any>,
    ) as any[]) {
      if (typeof def?.properties?.type?.const !== "string") continue;
      walk(def.properties.type.const, def.properties);
    }

    expect(inlineRecords.sort()).toEqual([
      "table.rowGroups",
      "table.rowGroups.bodies",
    ]);
    expect(Object.keys(WIRE_RECORD_FIELDS).sort()).toEqual([
      "attrs",
      "pos",
      ...inlineRecords,
    ]);

    // And every record is REACHABLE, which is what actually validates it: a
    // record named but never nested anywhere would be checked at no position.
    const reached = new Set(
      Object.values(WIRE_NESTED_RECORDS).flatMap((fields) =>
        Object.values(fields).map((nested) => nested.record),
      ),
    );
    expect([...reached].sort()).toEqual(Object.keys(WIRE_RECORD_FIELDS).sort());
  });
});
