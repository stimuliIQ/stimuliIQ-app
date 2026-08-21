// Certificate template designer — positions text fields over a background
// using `CertTemplateCanvas` (@repo/ui). Phase 9 Completion T39.
//
// GAP: `CertificateTemplateSummary` (@repo/types learning/certificates.
// schemas.ts) only carries `{id, name, status, createdAt}` — there is NO
// field-layout data on a template, and NO create/update endpoint for
// templates at all (`client.learning.certificates` only exposes
// `listTemplates()`, a read). Persisting a redesigned layout needs a new
// backend model + endpoint that doesn't exist yet (flagged as a follow-up).
// This drawer is therefore a PREVIEW/mockup tool over sensible default merge
// fields — real, interactive, keyboard-operable positioning — but changes
// are session-local only, never silently claimed as saved.
import * as React from "react";
import { Alert, Button, CertTemplateCanvas, type CertTemplateField, Drawer, DrawerContent, DrawerBody, Select, SelectItem } from "@repo/ui";
import type { CertificateTemplateSummary } from "@repo/types";

import { useCertificateTemplates } from "../../hooks/use-certificates";

const DEFAULT_FIELDS: CertTemplateField[] = [
  { id: "student_name", type: "text", label: "Student name", x: 50, y: 40, fontSize: 28, align: "center", fontWeight: "bold", placeholder: "{{student_name}}" },
  { id: "program_title", type: "text", label: "Program title", x: 50, y: 52, fontSize: 18, align: "center", placeholder: "{{program_title}}" },
  { id: "issued_at", type: "text", label: "Issue date", x: 25, y: 75, fontSize: 12, align: "left", placeholder: "{{issued_at}}" },
  { id: "cert_uid", type: "text", label: "Certificate UID", x: 75, y: 75, fontSize: 12, align: "right", placeholder: "{{cert_uid}}" },
];

interface CertTemplateDesignerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CertTemplateDesignerDrawer({ open, onOpenChange }: CertTemplateDesignerDrawerProps): React.JSX.Element {
  const { data: templates } = useCertificateTemplates();
  const [templateId, setTemplateId] = React.useState<string | undefined>(undefined);
  const [fields, setFields] = React.useState<CertTemplateField[]>(DEFAULT_FIELDS);
  const [selectedFieldId, setSelectedFieldId] = React.useState<string | null>(null);

  const selectedTemplate: CertificateTemplateSummary | undefined = templates?.items.find((t) => t.id === templateId);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Certificate template designer" description="Position merge-field placeholders on the certificate layout." size="lg" data-testid="cert-template-designer-drawer">
        <DrawerBody className="flex flex-col gap-4">
          <Alert tone="warning">
            Layouts aren't saved to the server yet, there's no backend endpoint to persist template field positions. Use
            this as a visual preview tool; positions reset when you close this drawer.
          </Alert>

          <Select
            label="Template"
            placeholder="Select a template"
            value={templateId}
            onValueChange={setTemplateId}
            data-testid="cert-template-select"
          >
            {(templates?.items ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </Select>

          {selectedTemplate ? (
            <CertTemplateCanvas
              backgroundAlt={selectedTemplate.name}
              fields={fields}
              selectedFieldId={selectedFieldId}
              onSelectField={setSelectedFieldId}
              onFieldsChange={setFields}
              data-testid="cert-template-canvas"
            />
          ) : null}

          <Button type="button" variant="secondary" onClick={() => setFields(DEFAULT_FIELDS)} className="self-start" data-testid="cert-template-reset">
            Reset positions
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
