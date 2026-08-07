"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * Select — labelled dropdown built on Radix Select, matching Input's label/helper/error
 * a11y wiring (per docs/07-design-system.md §5). Used for filters (DataFilters) and forms
 * (program mode, batch status, role, scope, ...).
 *
 * Usage:
 *   <Select label="Status" value={status} onValueChange={setStatus} placeholder="All statuses">
 *     <SelectItem value="active">Active</SelectItem>
 *     <SelectItem value="lead">Lead</SelectItem>
 *   </Select>
 */
export interface SelectProps {
  /** Visible label text. Required unless `aria-label` is supplied instead. */
  label?: string;
  "aria-label"?: string;
  error?: string;
  helperText?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  wrapperClassName?: string;
  /** Test hook; defaults to "select-trigger" when omitted. */
  "data-testid"?: string;
  id?: string;
}

export function Select({
  label,
  "aria-label": ariaLabel,
  error,
  helperText,
  placeholder,
  required,
  disabled,
  name,
  value,
  defaultValue,
  onValueChange,
  children,
  className,
  wrapperClassName,
  "data-testid": testId,
  id,
}: SelectProps): React.JSX.Element {
  const generatedId = React.useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;
  const describedBy =
    [error ? errorId : null, !error && helperText ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      {label ? (
        <Label htmlFor={selectId}>
          {label}
          {required ? (
            <span aria-hidden="true" className="text-danger">
              {" "}
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      <SelectPrimitive.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          id={selectId}
          data-testid={testId ?? "select-trigger"}
          aria-label={!label ? ariaLabel : undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={cn(
            // Height is density-aware so filter dropdowns line up with Button/Input on
            // every surface: 40px comfortable, 32px under `data-density="compact"`.
            "flex h-[var(--density-control-height)] w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg",
            "transition-colors duration-fast ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[placeholder]:text-fg-subtle",
            error && "border-danger focus-visible:ring-danger",
            className,
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="size-4 text-fg-subtle" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className={cn(
              "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card text-fg shadow-md",
            )}
          >
            <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1">
              <ChevronUp className="size-4" aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1">
              <ChevronDown className="size-4" aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-fg-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { "data-testid"?: string }
>(({ className, children, "data-testid": testId, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-testid={testId ?? "select-item"}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm text-fg outline-none",
      "transition-colors duration-fast ease-out",
      "data-[highlighted]:bg-surface data-[highlighted]:text-fg",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
