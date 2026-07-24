// Audit log detail drawer — read-only, shows actor/entity/action metadata
// plus a side-by-side before/after diff (docs/03 §7.16/§20(b)). The
// before/after payloads are already server-redacted (sensitive fields
// stripped before the row is written — see @repo/types crm/audit.schemas.ts
// file header), so this renders them as-is, key-by-key, highlighting which
// keys changed.
import * as React from "react";
import { Drawer, DrawerContent, DrawerBody } from "@repo/ui";
import type { AuditLogEntry } from "@repo/types";

import { AuditActionChip } from "./audit-action-chip";

interface AuditLogDetailDrawerProps {
  entry: AuditLogEntry | null;
  onOpenChange: (open: boolean) => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function diffKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(keys).sort();
}

export function AuditLogDetailDrawer({ entry, onOpenChange }: AuditLogDetailDrawerProps): React.JSX.Element {
  const open = Boolean(entry);
  const keys = entry ? diffKeys(entry.before, entry.after) : [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={entry ? `${entry.entity} · ${entry.action}` : "Audit entry"}
        description={entry ? `By ${entry.actorName ?? "System"} on ${new Date(entry.createdAt).toLocaleString()}` : undefined}
        size="lg"
        data-testid="audit-detail-drawer"
      >
        <DrawerBody>
          {entry ? (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-fg-muted">Action</dt>
                  <dd className="mt-1">
                    <AuditActionChip action={entry.action} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Actor</dt>
                  <dd className="mt-1 text-fg">{entry.actorName ?? "System"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Entity</dt>
                  <dd className="mt-1 text-fg">
                    {entry.entity} ({entry.entityId})
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">IP address</dt>
                  <dd className="mt-1 text-fg">{entry.ip ?? "—"}</dd>
                </div>
              </dl>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-fg">Changes</h2>
                {keys.length === 0 ? (
                  <p className="text-sm text-fg-muted" data-testid="audit-diff-empty">
                    No field-level change data recorded for this entry.
                  </p>
                ) : (
                  <table className="w-full text-sm" data-testid="audit-diff-table">
                    <caption className="sr-only">Before/after field diff</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-fg-muted">
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          Field
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          Before
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          After
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((key) => {
                        const beforeValue = entry.before?.[key];
                        const afterValue = entry.after?.[key];
                        const changed = formatValue(beforeValue) !== formatValue(afterValue);
                        return (
                          <tr key={key} className="border-b border-border last:border-0" data-testid="audit-diff-row">
                            <td className="px-2 py-1.5 align-top font-medium text-fg">{key}</td>
                            <td
                              className={
                                changed
                                  ? "px-2 py-1.5 align-top whitespace-pre-wrap text-danger"
                                  : "px-2 py-1.5 align-top whitespace-pre-wrap text-fg-muted"
                              }
                            >
                              {formatValue(beforeValue)}
                            </td>
                            <td
                              className={
                                changed
                                  ? "px-2 py-1.5 align-top whitespace-pre-wrap text-success"
                                  : "px-2 py-1.5 align-top whitespace-pre-wrap text-fg-muted"
                              }
                            >
                              {formatValue(afterValue)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
