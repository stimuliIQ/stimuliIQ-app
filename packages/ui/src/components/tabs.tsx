"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../lib/cn";

/**
 * Tabs — wraps Radix Tabs for record/detail views (student profile tabs, curriculum
 * tabs), per docs/07-design-system.md §5/§6. Radix provides roving-tabindex keyboard
 * navigation (arrow keys move focus + selection, Home/End jump to first/last) and the
 * `tablist`/`tab`/`tabpanel` ARIA roles out of the box.
 *
 * Usage:
 *   <Tabs defaultValue="overview">
 *     <TabsList aria-label="Student record sections">
 *       <TabsTrigger value="overview">Overview</TabsTrigger>
 *       <TabsTrigger value="payments">Payments</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="overview">...</TabsContent>
 *     <TabsContent value="payments">...</TabsContent>
 *   </Tabs>
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { "data-testid"?: string }
>(({ className, "data-testid": testId, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-testid={testId ?? "tabs-list"}
    className={cn(
      // min-h (not a fixed h-10): callers with many tabs pass `flex-wrap`, and a fixed
      // height cannot grow for a second row — the wrapped triggers spilled OUT of the
      // list and overlapped the panel below it. Single-row lists look unchanged.
      "inline-flex min-h-10 items-center gap-1 rounded-md border border-border bg-surface p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { "data-testid"?: string }
>(({ className, "data-testid": testId, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-testid={testId ?? "tabs-trigger"}
    className={cn(
      "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium",
      "text-fg-muted transition-colors duration-fast ease-out",
      "hover:text-fg",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-card data-[state=active]:text-fg data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & { "data-testid"?: string }
>(({ className, "data-testid": testId, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-testid={testId ?? "tabs-content"}
    className={cn(
      "mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
