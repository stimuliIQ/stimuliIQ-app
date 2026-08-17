import * as React from "react";
import { Check, Circle } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * PasswordRequirements — the live checklist of password rules, shown under a
 * "new password" field so the user can see WHICH requirement is still unmet while
 * typing instead of discovering it from a single error on submit.
 *
 * LAYERING: this takes the evaluated rules as a PROP and never imports @repo/types,
 * keeping the design system free of domain schemas (the same reason
 * audience-segment-filter takes its shape as props). Call sites pass
 * `checkPasswordRules(value)` from @repo/types — which is built from the very
 * constants that build `PasswordSchema`, so what this list claims and what the
 * server enforces cannot drift. Never hard-code rule copy at a call site.
 *
 * a11y:
 *  - Each row's state is conveyed in TEXT ("met"/"not met", visually hidden), not by
 *    icon or colour alone (WCAG 1.4.1 — colour is not the only channel).
 *  - Icons are `aria-hidden`; they decorate a row that already reads correctly.
 *  - Deliberately NOT an aria-live region. It updates on every keystroke, so
 *    announcing it would talk over the user continuously while they type. Instead the
 *    field points here via `aria-describedby={id}`, so a screen reader reads the full
 *    requirement set when the field takes focus, and the submit-time zod error
 *    (already `role="alert"` at every call site) announces actual failures.
 *
 * Pass the same `id` to the field's `aria-describedby`.
 */
export interface PasswordRequirementsRule {
  id: string;
  label: string;
  met: boolean;
}

export interface PasswordRequirementsProps {
  /** Evaluated rules, in display order — from `checkPasswordRules(value)` in @repo/types. */
  rules: readonly PasswordRequirementsRule[];
  /** Element id, so the input can reference this list via aria-describedby. */
  id?: string;
  className?: string;
  "data-testid"?: string;
}

export function PasswordRequirements({
  rules,
  id,
  className,
  "data-testid": testId = "password-requirements",
}: PasswordRequirementsProps): React.JSX.Element {
  return (
    <ul id={id} data-testid={testId} className={cn("space-y-1", className)}>
      {rules.map((rule) => (
        <li
          key={rule.id}
          data-testid={`${testId}-${rule.id}`}
          data-met={rule.met}
          className={cn("flex items-center gap-2 text-sm", rule.met ? "text-success" : "text-fg-muted")}
        >
          {rule.met ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{rule.label}</span>
          <span className="sr-only">{rule.met ? " — met" : " — not met"}</span>
        </li>
      ))}
    </ul>
  );
}
