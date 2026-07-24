"use client";

/**
 * BlockErrorBoundary — per-block render error boundary for the Phase-10 page-builder
 * renderer (docs/specs/phase-10-page-builder.md Edge case #4: "a single malformed/broken
 * block must never 500 the whole page" — e.g. a `hero(variant=split-with-cards)`'s
 * `centerImageKey` object deleted out-of-band after the page was saved validly).
 *
 * React error boundaries must be class components and can only catch errors thrown
 * during their CHILDREN's render — this must be a Client Component boundary even though
 * every block it wraps is itself a Server Component; RSC children can still be passed as
 * `children` into a client boundary (they're serialized once, not re-rendered client-side)
 * and a throw during that render is still caught here.
 *
 * On error: renders nothing on the public site (never a visible break) and always
 * `console.error`s (both dev and prod — this is a genuine data/content bug, not a
 * developer-only concern, so it must be visible in prod server logs too) naming the block
 * type for debugging.
 */
import * as React from "react";

interface BlockErrorBoundaryProps {
  blockType: string;
  blockIndex: number;
  children: React.ReactNode;
}

interface BlockErrorBoundaryState {
  hasError: boolean;
}

export class BlockErrorBoundary extends React.Component<BlockErrorBoundaryProps, BlockErrorBoundaryState> {
  constructor(props: BlockErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): BlockErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(
      `[page-builder] block #${this.props.blockIndex} (type="${this.props.blockType}") failed to render and was skipped:`,
      error,
    );
  }

  override render(): React.ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
