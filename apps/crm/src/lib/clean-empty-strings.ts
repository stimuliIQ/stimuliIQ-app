// Deep-transform: recursively replaces `""` (empty string) and `NaN` (empty numeric input)
// leaf values with `undefined`.
//
// WHY THIS EXISTS (strings): every block/site-setting form binds OPTIONAL string fields
// (e.g. `hero.headlineHighlight`, `hero.backgroundImageKey`) via react-hook-form's
// `register()` to plain UNCONTROLLED `<input>`s. An untouched `<input>` naturally has DOM
// value `""`, not `undefined` — but the zod schemas model "optional and unfilled" as the key
// being `undefined` (or omitted), NOT `""`. Several of those optional fields are ALSO
// `.min(1)` underneath (`ObjectKeySchema`/`HrefSchema` = `z.string().min(1)...`), so a
// genuinely-untouched optional field would otherwise fail validation as "too short" even
// though the author never intended to set it.
//
// WHY THIS EXISTS (NaN, QA D1): the SAME problem, one level worse, for numeric fields.
// Every numeric field (`hero.trustBadge.ratingStars`, `live_collection_ref.selection.
// minRating`/`.limit`, and any future one) is registered with `{ valueAsNumber: true }`
// (block-card.tsx / the per-block field components) — for a `type="number"` input, the DOM
// spec defines `input.valueAsNumber` as `NaN` when the input is empty (NOT `0`), so an
// UNTOUCHED optional numeric field yields `NaN`, not `undefined`. Zod's `.optional()`
// (and `.default()`) only special-case `undefined` — `z.number()` REJECTS `NaN` outright
// (it's a rejected `number` value, not treated as "absent") — so an untouched optional
// number field permanently failed validation, e.g. the seeded `live_collection_ref` blocks
// on the about/home pages (`selection.minRating` never set) showed a permanent "Needs
// attention" badge and blocked Save entirely. Centralizing the NaN->undefined fix here
// (rather than a one-off `setValueAs` per numeric `register()` call) means it covers every
// current AND future optional numeric field across all 11 block forms automatically,
// since block-card.tsx already runs every block's resolver + `getValues()` through this
// function.
//
// This transform normalizes both leaf shapes -> `undefined` immediately before BOTH (a) the
// zodResolver validates a block card's live form state, and (b) the final payload sent to
// save/preview — so an unfilled optional field is correctly treated as "not provided," while
// a genuinely required-and-empty field still fails validation (just with zod's "required"
// message instead of "too short"/"expected number, received nan" — same invalid outcome,
// clearer wording).
//
// Array length/shape is always preserved (never deletes/filters array items) — silently
// dropping a `media_gallery` item because one of its OTHER fields was blank would be a much
// worse bug than a slightly different error message.
export function cleanEmptyStrings<T>(value: T): T {
  if (typeof value === "string") {
    return (value === "" ? undefined : value) as T;
  }
  if (typeof value === "number") {
    return (Number.isNaN(value) ? undefined : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanEmptyStrings(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cleanEmptyStrings(item);
    }
    return out as T;
  }
  return value;
}
