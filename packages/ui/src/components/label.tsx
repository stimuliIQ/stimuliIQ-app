import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "../lib/cn";

interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  "data-testid"?: string;
}

/** Label — accessible form label, associates with a control via htmlFor. */
export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, "data-testid": testId, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      data-testid={testId ?? "label"}
      className={cn(
        "text-sm font-medium leading-none text-fg peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";
