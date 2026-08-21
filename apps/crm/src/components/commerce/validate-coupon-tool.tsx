// Validate-coupon mini-tool — nice-to-have per the task brief: code+program
// → discount preview via client.commerce.coupons.validate. Non-mutating
// (does not change the `used` counter); purely informational for staff
// checking a coupon before sharing it with a student.
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, formatPaise, Input, Select, SelectItem, StatusChip } from "@repo/ui";

import { useProgramsList } from "../../hooks/use-courses";
import { useValidateCoupon } from "../../hooks/use-coupons";

export function ValidateCouponTool(): React.JSX.Element {
  const [code, setCode] = React.useState("");
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const validateCoupon = useValidateCoupon();

  const programs = programsData?.items ?? [];

  const handleValidate = () => {
    if (!code.trim() || !programId) return;
    validateCoupon.mutate({ code: code.trim(), programId });
  };

  return (
    <Card data-testid="validate-coupon-tool">
      <CardHeader>
        <CardTitle>Validate a coupon</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">Preview the discount a code would apply for a program, does not redeem it.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Code"
            placeholder="SUMMER20"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            wrapperClassName="w-48"
            data-testid="validate-coupon-code"
          />
          <Select
            label="Program"
            placeholder="Select a program"
            value={programId}
            onValueChange={setProgramId}
            wrapperClassName="w-56"
            data-testid="validate-coupon-program"
          >
            {programs.map((program) => (
              <SelectItem key={program.id} value={program.id}>
                {program.title}
              </SelectItem>
            ))}
          </Select>
          <Button
            onClick={handleValidate}
            loading={validateCoupon.isPending}
            disabled={!code.trim() || !programId}
            data-testid="validate-coupon-submit"
          >
            Validate
          </Button>
        </div>
        {validateCoupon.data ? (
          <div data-testid="validate-coupon-result" className="rounded-md border border-border bg-surface p-3 text-sm">
            {validateCoupon.data.valid ? (
              <p className="flex items-center gap-2 text-success">
                <StatusChip tone="success" label="Valid" size="sm" />
                Discount: {formatPaise(validateCoupon.data.discountPaise ?? 0)}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-danger">
                <StatusChip tone="danger" label="Invalid" size="sm" />
                {validateCoupon.data.invalidReason ?? "This coupon cannot be applied."}
              </p>
            )}
          </div>
        ) : validateCoupon.isError ? (
          <p role="alert" className="text-sm text-danger" data-testid="validate-coupon-error">
            Something went wrong validating this coupon. Try again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
