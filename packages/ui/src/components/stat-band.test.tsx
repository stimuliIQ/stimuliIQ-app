import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatBand, type StatItem } from "./stat-band";

const stats: StatItem[] = [
  { value: 15000, label: "Students trained", suffix: "+" },
  { value: 30, label: "Programs", suffix: "+" },
  { value: 94, label: "Placement rate", suffix: "%" },
  { value: 50, label: "Cities", suffix: "+" },
];

// ---------------------------------------------------------------------------
// Mock IntersectionObserver for jsdom
// ---------------------------------------------------------------------------

class IntersectionObserverStub {
  private callback: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
  }
  observe(el: Element): void {
    // Immediately fire as intersecting so count-up starts in tests
    this.callback(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom global shim
  (globalThis as any).IntersectionObserver = IntersectionObserverStub;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("StatBand, rendering", () => {
  it("renders with default data-testid='stat-band'", () => {
    render(<StatBand stats={stats} />);
    expect(screen.getByTestId("stat-band")).toBeInTheDocument();
  });

  it("renders each stat label", () => {
    render(<StatBand stats={stats} />);
    expect(screen.getByText("Students trained")).toBeInTheDocument();
    expect(screen.getByText("Programs")).toBeInTheDocument();
    expect(screen.getByText("Placement rate")).toBeInTheDocument();
    expect(screen.getByText("Cities")).toBeInTheDocument();
  });

  it("renders a <section> with aria-label", () => {
    render(<StatBand stats={stats} />);
    expect(screen.getByRole("region", { name: "Key statistics" })).toBeInTheDocument();
  });

  it("renders stat values within a <dl>", () => {
    const { container } = render(<StatBand stats={stats} />);
    expect(container.querySelector("dl")).toBeInTheDocument();
    const dts = container.querySelectorAll("dt");
    expect(dts).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// reduced-motion: when prefers-reduced-motion is active, values should appear
// immediately without needing animation frames
// ---------------------------------------------------------------------------

describe("StatBand, reduced-motion", () => {
  it("renders stat label text in reduced-motion environment", () => {
    // Mock matchMedia to return prefers-reduced-motion: reduce
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", mockMatchMedia);

    render(<StatBand stats={[{ value: 100, label: "Test stat" }]} />);
    expect(screen.getByText("Test stat")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
