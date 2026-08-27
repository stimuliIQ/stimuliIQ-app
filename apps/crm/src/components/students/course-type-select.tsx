// One course-type picker, used by every screen that asks for one (add student, edit
// student, registration step, lead conversion) and — with `includeAllOption` — by the
// directory and report filters.
//
// It exists because the option list used to be a `{ value, label }` array hand-copied into
// four files: renaming "B.Tech" meant finding all four, and a fifth screen added later would
// have quietly disagreed with the other four. The options now come from the CRM-managed
// `course_types` rows (docs/specs/course-types.md, ADR-0068) through `useCourseTypeOptions`.
//
// Two states matter beyond the happy path:
//   - EMPTY: a tenant that has not authored any options yet. The control says where to add
//     them instead of rendering an empty dropdown that reads as broken.
//   - RETIRED VALUE: an existing record holding a key that has since been hidden. The key is
//     re-added as a one-off option marked "(retired)" so opening that student does not
//     silently switch them to something else the moment somebody saves the form.
import { Select, SelectItem } from "@repo/ui";

import { useCourseTypeOptions } from "../../hooks/use-course-types";

/** Sentinel for the filter variant's "any course type" row — Radix disallows a "" value. */
export const COURSE_TYPE_ALL = "__all__";

interface CourseTypeSelectProps {
  /** `null` is a real state: an existing student can have no course type recorded. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  /** Renders a leading "All course types" row for filter bars. */
  includeAllOption?: boolean;
  placeholder?: string;
  "data-testid"?: string;
}

export function CourseTypeSelect({
  value,
  onChange,
  label = "Course type",
  required,
  error,
  includeAllOption,
  placeholder = "Select course type",
  "data-testid": testId,
}: CourseTypeSelectProps) {
  const { options, isLoading } = useCourseTypeOptions();

  // A value that is set but not offered any more: keep it selectable so the form round-trips
  // unchanged, and say why it looks unfamiliar.
  const selected = value && value !== COURSE_TYPE_ALL ? value : null;
  const retired = selected && !options.some((option) => option.value === selected) ? selected : null;

  const isEmpty = !isLoading && options.length === 0 && !retired;

  return (
    <Select
      label={label}
      required={required}
      placeholder={isLoading ? "Loading…" : placeholder}
      value={value ?? undefined}
      onValueChange={onChange}
      error={error}
      helperText={isEmpty ? "No course types yet. Add them under Admin → Course types." : undefined}
      disabled={isEmpty}
      data-testid={testId ?? "course-type-select"}
    >
      {includeAllOption ? <SelectItem value={COURSE_TYPE_ALL}>All course types</SelectItem> : null}
      {retired ? <SelectItem value={retired}>{retired} (retired)</SelectItem> : null}
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </Select>
  );
}
