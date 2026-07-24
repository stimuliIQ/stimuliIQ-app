// LifecycleChip — the single visual vocabulary for "where is this person in the
// Lead → … → Certified journey?" (lifecycle-redesign P1). Renders the DERIVED
// `LifecycleStage` (computed server-side by resolveLifecycleStage) as a StatusChip,
// mapping each stage's coarse phase to a tone. This is the ONLY place the stage→tone
// mapping lives (docs/07 §5: domain enums map to a tone at the call site, never inside
// StatusChip). Used interchangeably on the lead pipeline and the student directory so
// both surfaces speak one language.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import {
  type LifecycleStage,
  type LifecyclePhase,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_PHASE,
} from "@repo/types";

const PHASE_TONE: Record<LifecyclePhase, StatusChipTone> = {
  lead: "info", //      pre-sales: a prospect moving through the pipeline
  sales: "warning", //  converting: registered → awaiting payment (needs action)
  enrolled: "success", // paying/active student
  success: "success", // course completed / certified
  off_ramp: "danger", // lost or dropped
};

export function LifecycleChip({ stage }: { stage: LifecycleStage }) {
  return <StatusChip tone={PHASE_TONE[LIFECYCLE_STAGE_PHASE[stage]]} label={LIFECYCLE_STAGE_LABELS[stage]} />;
}
