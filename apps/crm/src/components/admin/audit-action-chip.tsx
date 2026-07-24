// Maps `AuditAction` (create|update|delete|restore) to a StatusChip tone —
// the only place this mapping lives (docs/07 §5).
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { AuditAction } from "@repo/types";

const ACTION_TONE: Record<AuditAction, StatusChipTone> = {
  create: "success",
  update: "info",
  delete: "danger",
  restore: "warning",
};

const ACTION_LABEL: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  restore: "Restored",
};

export function AuditActionChip({ action }: { action: AuditAction }) {
  return <StatusChip tone={ACTION_TONE[action]} label={ACTION_LABEL[action]} />;
}
