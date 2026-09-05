// Admin ▸ Email templates — the emails the system sends by itself.
//
// WHY THIS SCREEN EXISTS. Every automatic email was written in TypeScript, so nobody
// outside the codebase could read what a student receives when they pay, let alone change a
// word of it. The first anyone learned of a wording problem was a student quoting it back.
//
// WHAT IT DELIBERATELY DOES NOT DO. It edits PROSE — subject, heading, body, footnote. It
// cannot touch the details table, the button or the layout, because those carry the LMS
// username, the temporary password and the sign-in link, and an editor able to delete
// somebody's credentials out of the one email containing them is not a feature. Each
// template says in words what its fixed parts are, rather than leaving that to be
// discovered by sending a broken email to a real student.
import * as React from "react";
import { Mail, RotateCcw, Save } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  StatusChip,
  Textarea,
  useToast,
} from "@repo/ui";
import { findUnknownEmailTemplateVariables, type EmailTemplate, type EmailTemplateKey, type MeResponse } from "@repo/types";

import {
  useEmailTemplates,
  useEmailTemplatePreview,
  useUpdateEmailTemplate,
  useResetEmailTemplate,
} from "../../hooks/use-email-templates";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface DraftState {
  subject: string;
  heading: string;
  body: string;
  footnote: string;
}

function toDraft(template: EmailTemplate): DraftState {
  return {
    subject: template.subject,
    heading: template.heading,
    body: template.body,
    footnote: template.footnote ?? "",
  };
}

export function EmailTemplatesManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "settings.edit");
  const { data: templates, isLoading, isError, refetch } = useEmailTemplates();

  const [selectedKey, setSelectedKey] = React.useState<EmailTemplateKey | null>(null);
  const [draft, setDraft] = React.useState<DraftState | null>(null);
  const [resetTarget, setResetTarget] = React.useState<EmailTemplate | null>(null);

  const updateMutation = useUpdateEmailTemplate();
  const resetMutation = useResetEmailTemplate();
  const { toast } = useToast();

  const selected = templates?.find((t) => t.key === selectedKey) ?? null;
  const preview = useEmailTemplatePreview(selectedKey);

  // Open the first template by default: a screen that opens on "pick something" adds a
  // click for a list that will usually hold two or three items.
  React.useEffect(() => {
    if (!selectedKey && templates && templates.length > 0) {
      setSelectedKey(templates[0]!.key);
    }
  }, [templates, selectedKey]);

  // Re-seed the form when the selection changes, and when a save or reset returns new
  // server text — both arrive as a new object from the query cache, so depending on
  // `selected` covers each case without listing its fields.
  React.useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  const allowedKeys = selected?.variables.map((v) => v.key) ?? [];
  const unknownVariables = draft
    ? findUnknownEmailTemplateVariables(
        [draft.subject, draft.heading, draft.body, draft.footnote].join("\n"),
        allowedKeys,
      )
    : [];

  const isDirty = Boolean(selected && draft && (
    draft.subject !== selected.subject ||
    draft.heading !== selected.heading ||
    draft.body !== selected.body ||
    draft.footnote !== (selected.footnote ?? "")
  ));

  function handleSave() {
    if (!selected || !draft) return;
    updateMutation.mutate(
      { key: selected.key, body: { ...draft, footnote: draft.footnote.trim() || null } },
      {
        onSuccess: () => toast({ title: "Email updated", variant: "success" }),
        onError: (err) => surfaceError(toast, err, "Couldn't save this email"),
      },
    );
  }

  function handleReset() {
    if (!resetTarget) return;
    resetMutation.mutate(resetTarget.key, {
      onSuccess: () => {
        toast({ title: "Restored the default wording", variant: "success" });
        setResetTarget(null);
      },
      onError: (err) => {
        surfaceError(toast, err, "Couldn't reset this email");
        setResetTarget(null);
      },
    });
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the email templates"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="email-templates-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-6" data-testid="email-templates-manager">
      <PageHeader
        title="Email templates"
        description="The emails the system sends on its own. Change the wording here and it changes what students receive."
      />

      {!canEdit ? (
        <Alert tone="info" data-testid="email-templates-readonly">
          You can read these but not change them. Editing the automatic emails needs the
          &ldquo;Edit System / Company Settings&rdquo; permission.
        </Alert>
      ) : null}

      {isLoading ? (
        <Skeleton shape="block" className="h-64 w-full rounded-lg" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* Which email */}
          <nav aria-label="Automatic emails" className="flex flex-col gap-2" data-testid="email-templates-list">
            {(templates ?? []).map((template) => (
              <button
                key={template.key}
                type="button"
                onClick={() => setSelectedKey(template.key)}
                aria-current={template.key === selectedKey}
                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition ${
                  template.key === selectedKey
                    ? "border-brand-500 bg-surface"
                    : "border-border hover:bg-surface"
                }`}
                data-testid={`email-template-tab-${template.key}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Mail className="size-4 text-fg-muted" aria-hidden="true" />
                  {template.name}
                </span>
                {/* Whether these are the company's words or the ones the product shipped
                    with is the first thing somebody opening this screen wants to know. */}
                <StatusChip
                  tone={template.isCustomised ? "success" : "info"}
                  label={template.isCustomised ? "Customised" : "Default"}
                  size="sm"
                />
              </button>
            ))}
          </nav>

          {selected && draft ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription>{selected.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    label="Subject"
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    disabled={!canEdit}
                    data-testid="email-template-subject"
                  />
                  <Input
                    label="Heading"
                    helperText="The large line at the top of the email."
                    value={draft.heading}
                    onChange={(e) => setDraft({ ...draft, heading: e.target.value })}
                    disabled={!canEdit}
                    data-testid="email-template-heading"
                  />
                  <Textarea
                    label="Message"
                    helperText="Leave a blank line between paragraphs."
                    rows={8}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    disabled={!canEdit}
                    data-testid="email-template-body"
                  />
                  <Textarea
                    label="Footnote"
                    helperText="Small print under the message. Leave empty for none."
                    rows={3}
                    value={draft.footnote}
                    onChange={(e) => setDraft({ ...draft, footnote: e.target.value })}
                    disabled={!canEdit}
                    data-testid="email-template-footnote"
                  />

                  {/* The boundary, stated. */}
                  <Alert tone="info" data-testid="email-template-fixed-parts">
                    {selected.variables.length > 0 ? (
                      <p className="mb-2">
                        Placeholders you can use:{" "}
                        {selected.variables.map((v) => `{{${v.key}}} (${v.description})`).join(", ")}
                      </p>
                    ) : null}
                    <p>{selected.fixedPartsNote}</p>
                  </Alert>

                  {/* Caught before saving as well as on the server: a typo'd placeholder is
                      left as literal braces by the renderer, so it would reach a student. */}
                  {unknownVariables.length > 0 ? (
                    <Alert tone="danger" data-testid="email-template-unknown-variable">
                      {unknownVariables.map((v) => `{{${v}}}`).join(", ")}{" "}
                      {unknownVariables.length === 1 ? "is not a placeholder" : "are not placeholders"} this
                      email provides, and would be sent to students exactly as typed.
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>

              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={!isDirty || unknownVariables.length > 0 || updateMutation.isPending}
                    data-testid="email-template-save"
                  >
                    <Save className="size-4" aria-hidden="true" />
                    Save changes
                  </Button>
                  {selected.isCustomised ? (
                    <Button
                      variant="secondary"
                      onClick={() => setResetTarget(selected)}
                      data-testid="email-template-reset"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      Restore default
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                  <CardDescription>
                    The saved version, with example values. Save to see edits here.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {preview.isLoading ? (
                    <Skeleton shape="block" className="h-80 w-full rounded-lg" />
                  ) : preview.isError ? (
                    <EmptyState
                      title="Couldn't render the preview"
                      description={queryErrorMessage(preview.error, "The email could not be rendered.")}
                      data-testid="email-template-preview-error"
                    />
                  ) : preview.data ? (
                    <>
                      <p className="mb-3 text-sm text-fg-muted">
                        <span className="font-medium text-fg">Subject:</span> {preview.data.subject}
                      </p>
                      {/* srcDoc, not innerHTML: the email is a full HTML document with its own
                          styles, and injecting it into this page would leak them into the CRM
                          and hand staff-authored markup the app's own origin. */}
                      <iframe
                        srcDoc={preview.data.html}
                        title={`Preview of the ${selected.name} email`}
                        sandbox=""
                        className="h-[520px] w-full rounded-lg border border-border bg-white"
                        data-testid="email-template-preview-frame"
                      />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title="Restore the default wording?"
        description={
          resetTarget
            ? `"${resetTarget.name}" will go back to the text it shipped with, and your version will be discarded. Students will receive the default from the next send.`
            : ""
        }
        confirmLabel="Restore default"
        tone="danger"
        onConfirm={handleReset}
        loading={resetMutation.isPending}
        data-testid="confirm-reset-email-template"
      />
    </div>
  );
}

