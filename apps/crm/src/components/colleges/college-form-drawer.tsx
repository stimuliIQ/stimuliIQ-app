// Create/Edit college drawer (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4). Plain-useState form bound to CreateCollegeRequest/
// UpdateCollegeRequest (@repo/types) — mirrors partners-manager.tsx's `PartnerFormDrawer`
// (same simple-fields convention: this screen doesn't need react-hook-form's array/nested
// features, just a flat set of scalar inputs).
import * as React from "react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, useToast } from "@repo/ui";
import type { College, ContentStatus } from "@repo/types";

import { useCreateCollege, useUpdateCollege } from "../../hooks/use-colleges";
import { surfaceError } from "../../lib/surface-error";
import { CollegeLogoField } from "./college-logo-field";

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];

export interface CollegeFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  college: College | null;
}

export function CollegeFormDrawer({ open, onOpenChange, college }: CollegeFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createCollege = useCreateCollege();
  const updateCollege = useUpdateCollege();
  const isEdit = Boolean(college);

  const [name, setName] = React.useState("");
  const [logoKey, setLogoKey] = React.useState<string | undefined>(undefined);
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState("college_partner");
  const [focus, setFocus] = React.useState("");
  const [established, setEstablished] = React.useState<number | undefined>(undefined);
  const [city, setCity] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus>("draft");
  const [order, setOrder] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setName(college?.name ?? "");
    setLogoKey(undefined);
    setUrl(college?.url ?? "");
    setCategory(college?.category ?? "college_partner");
    setFocus(college?.focus ?? "");
    setEstablished(college?.established ?? undefined);
    setCity(college?.city ?? "");
    setStatus(college?.status ?? "draft");
    setOrder(college?.order ?? 0);
  }, [open, college]);

  const isPending = createCollege.isPending || updateCollege.isPending;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body = {
      name: name.trim(),
      logoKey,
      url: url.trim() ? url.trim() : undefined,
      category: category.trim() ? category.trim() : "college_partner",
      focus: focus.trim() ? focus.trim() : undefined,
      established,
      city: city.trim() ? city.trim() : undefined,
      status,
      order,
    };
    try {
      if (isEdit && college) {
        await updateCollege.mutateAsync({ id: college.id, body });
        toast({ title: "College updated", variant: "success" });
      } else {
        await createCollege.mutateAsync(body);
        toast({ title: "College created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this college");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit college" : "New college"} size="sm" data-testid="college-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IIT Hyderabad" data-testid="college-name-input" />
            <CollegeLogoField logoKey={logoKey} onChange={setLogoKey} existingLogoUrl={college?.logoUrl} />
            <Input label="Website URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="college-url-input" />
            <Input label="Focus (optional)" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. Engineering & Technology" data-testid="college-focus-input" />
            <div className="flex gap-3">
              <Input
                label="Established year (optional)"
                type="number"
                min={1800}
                max={2100}
                value={established ?? ""}
                onChange={(e) => setEstablished(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g. 1965"
                wrapperClassName="flex-1"
                data-testid="college-established-input"
              />
              <Input label="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Hyderabad" wrapperClassName="flex-1" data-testid="college-city-input" />
            </div>
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} helperText="Keeps this row on the Colleges list and the public colleges section." data-testid="college-category-input" />
            <div className="flex gap-3">
              <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} wrapperClassName="flex-1" data-testid="college-status-select">
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </Select>
              <Input label="Order" type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value))} wrapperClassName="w-28" data-testid="college-order-input" />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!name.trim()} data-testid="college-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
