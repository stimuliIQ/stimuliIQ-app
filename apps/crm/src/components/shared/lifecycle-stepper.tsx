// LifecycleStepper — the visible "where is this person in the journey?" path
// (lifecycle-redesign P2). Renders the canonical Lead → … → Certified spine as a
// horizontal step path (Salesforce-opportunity-path style) with the current stage's
// phase highlighted, everything already passed filled in, and everything ahead muted.
//
// The 13 detailed forward stages (LifecycleStageSchema) are grouped into the 8
// macro-phases of the product brief so the path stays readable in a drawer; the
// detailed stage is already shown verbatim by the LifecycleChip next to this. The
// two terminal off-ramps (lost/dropped) render as a danger note under the path,
// positioned after the furthest phase the person actually reached.
import * as React from "react";

import { type LifecycleStage, LifecycleStageSchema } from "@repo/types";

/** The 8 journey phases from the product brief, each spanning 1+ detailed stages. */
const JOURNEY_PHASES: ReadonlyArray<{ label: string; stages: readonly LifecycleStage[] }> = [
  { label: "Lead", stages: ["new_lead", "assigned", "contacted", "interested"] },
  { label: "Registration", stages: ["registration_started", "registered"] },
  { label: "Program", stages: ["program_assigned"] },
  { label: "Payment", stages: ["payment_pending", "payment_completed"] },
  { label: "Active", stages: ["active_student"] },
  { label: "Learning", stages: ["learning_in_progress"] },
  { label: "Completed", stages: ["course_completed"] },
  { label: "Certified", stages: ["certified"] },
];

// Forward-ladder ordinal = declaration order in the canonical enum (terminals last).
const FORWARD_STAGES = LifecycleStageSchema.options.filter((s) => s !== "lost" && s !== "dropped");

/**
 * The phase index a terminal off-ramp had reached when the journey ended: a lost
 * lead never left phase 0 (Lead); a dropped student had an enrollment, so they
 * reached at least Active. Used only to position the "journey ended" marker.
 */
const OFF_RAMP_REACHED: Record<"lost" | "dropped", number> = { lost: 0, dropped: 4 };

function phaseIndexOf(stage: LifecycleStage): number {
  const idx = JOURNEY_PHASES.findIndex((p) => p.stages.includes(stage));
  // Every forward stage is in exactly one phase; guard is for type safety only.
  return idx >= 0 ? idx : 0;
}

export function LifecycleStepper({ stage }: { stage: LifecycleStage }) {
  const isOffRamp = stage === "lost" || stage === "dropped";
  const currentPhase = isOffRamp ? OFF_RAMP_REACHED[stage] : phaseIndexOf(stage);

  // Within-phase progress (e.g. "payment_completed" is the 2nd of Payment's 2 stages)
  // is intentionally not visualized — the chip alongside carries the detailed label.
  const forwardOrdinal = isOffRamp ? -1 : FORWARD_STAGES.indexOf(stage);

  return (
    <div data-testid="lifecycle-stepper" className="w-full">
      <ol
        aria-label="Lifecycle journey"
        className="flex w-full items-start gap-0 overflow-x-auto pb-1"
      >
        {JOURNEY_PHASES.map((phase, i) => {
          const done = !isOffRamp && i < currentPhase;
          const current = !isOffRamp && i === currentPhase;
          const reachedBeforeOffRamp = isOffRamp && i <= currentPhase;
          return (
            <li
              key={phase.label}
              aria-current={current ? "step" : undefined}
              data-testid={`lifecycle-step-${phase.label.toLowerCase()}`}
              data-state={current ? "current" : done ? "done" : "upcoming"}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div className="flex w-full items-center">
                {/* left connector (hidden on the first step to keep the path open-ended) */}
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 ${
                    i === 0 ? "bg-transparent" : done || current || reachedBeforeOffRamp ? "bg-success" : "bg-border"
                  }`}
                />
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                    current
                      ? "border-success bg-bg ring-2 ring-success/30"
                      : done || reachedBeforeOffRamp
                        ? "border-success bg-success"
                        : "border-border bg-bg"
                  }`}
                />
                {/* right connector */}
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 ${
                    i === JOURNEY_PHASES.length - 1 ? "bg-transparent" : done ? "bg-success" : "bg-border"
                  }`}
                />
              </div>
              <span
                className={`max-w-full truncate px-0.5 text-center text-[11px] leading-tight ${
                  current ? "font-semibold text-fg" : done || reachedBeforeOffRamp ? "text-fg-muted" : "text-fg-subtle"
                }`}
              >
                {phase.label}
              </span>
            </li>
          );
        })}
      </ol>
      {isOffRamp ? (
        <p
          data-testid="lifecycle-stepper-offramp"
          className="mt-1 rounded-md bg-danger/10 px-2 py-1 text-xs text-danger"
        >
          Journey ended: {stage === "lost" ? "lead marked lost" : "student dropped"} after the{" "}
          {JOURNEY_PHASES[currentPhase]!.label} phase.
        </p>
      ) : (
        // Visually-hidden progress summary for screen readers (the dots are aria-hidden).
        <span className="sr-only">
          Step {currentPhase + 1} of {JOURNEY_PHASES.length}: {JOURNEY_PHASES[currentPhase]!.label}
          {forwardOrdinal >= 0 ? `, detailed stage ${forwardOrdinal + 1} of ${FORWARD_STAGES.length}` : ""}
        </span>
      )}
    </div>
  );
}
