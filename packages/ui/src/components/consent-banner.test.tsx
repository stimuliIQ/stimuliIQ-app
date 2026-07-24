import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ConsentBanner,
  CONSENT_STORAGE_KEY,
  readStoredConsent,
} from "./consent-banner";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function mockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
    store,
  };
}

beforeEach(() => {
  const ls = mockLocalStorage();
  vi.stubGlobal("localStorage", ls);
});

// ---------------------------------------------------------------------------
// Rendering / visibility
// ---------------------------------------------------------------------------

describe("ConsentBanner — rendering", () => {
  it("renders the banner when no consent is stored", async () => {
    // localStorage returns null → banner should show
    render(<ConsentBanner />);
    // The banner appears after useEffect; use act + waitFor to let it settle
    await act(async () => {});
    expect(screen.getByTestId("consent-banner")).toBeInTheDocument();
  });

  it("does not render when consent is already 'accepted'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only cast to set store
    (window.localStorage as unknown as any).store[CONSENT_STORAGE_KEY] = "accepted";
    render(<ConsentBanner />);
    await act(async () => {});
    expect(screen.queryByTestId("consent-banner")).not.toBeInTheDocument();
  });

  it("does not render when consent is already 'rejected'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only cast to set store
    (window.localStorage as unknown as any).store[CONSENT_STORAGE_KEY] = "rejected";
    render(<ConsentBanner />);
    await act(async () => {});
    expect(screen.queryByTestId("consent-banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Accept / Reject
// ---------------------------------------------------------------------------

describe("ConsentBanner — accept / reject", () => {
  it("calls onAccept and hides banner when Accept is clicked", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentBanner onAccept={onAccept} />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /accept all/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("consent-banner")).not.toBeInTheDocument();
  });

  it("persists 'accepted' to localStorage on accept", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /accept all/i }));
    expect(window.localStorage.setItem).toHaveBeenCalledWith(CONSENT_STORAGE_KEY, "accepted");
  });

  it("calls onReject and hides banner when Reject is clicked", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<ConsentBanner onReject={onReject} />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("consent-banner")).not.toBeInTheDocument();
  });

  it("persists 'rejected' to localStorage on reject", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(window.localStorage.setItem).toHaveBeenCalledWith(CONSENT_STORAGE_KEY, "rejected");
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("ConsentBanner — a11y", () => {
  it("has role=dialog with aria-label", async () => {
    render(<ConsentBanner />);
    await act(async () => {});
    expect(
      screen.getByRole("dialog", { name: /cookie and privacy consent/i }),
    ).toBeInTheDocument();
  });

  it("renders Accept button with min-h-[44px]", async () => {
    render(<ConsentBanner />);
    await act(async () => {});
    const acceptBtn = screen.getByRole("button", { name: /accept all/i });
    expect(acceptBtn.className).toContain("min-h-[44px]");
  });

  it("renders Reject button with min-h-[44px]", async () => {
    render(<ConsentBanner />);
    await act(async () => {});
    const rejectBtn = screen.getByRole("button", { name: /reject/i });
    expect(rejectBtn.className).toContain("min-h-[44px]");
  });

  it("renders policyHref link when provided", async () => {
    render(<ConsentBanner policyHref="/privacy" />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/privacy");
  });
});

// ---------------------------------------------------------------------------
// readStoredConsent utility
// ---------------------------------------------------------------------------

describe("readStoredConsent", () => {
  it("returns null when nothing is stored", () => {
    expect(readStoredConsent()).toBeNull();
  });

  it("returns 'accepted' when stored", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only cast
    (window.localStorage as unknown as any).store[CONSENT_STORAGE_KEY] = "accepted";
    expect(readStoredConsent()).toBe("accepted");
  });

  it("returns 'rejected' when stored", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only cast
    (window.localStorage as unknown as any).store[CONSENT_STORAGE_KEY] = "rejected";
    expect(readStoredConsent()).toBe("rejected");
  });

  it("returns null for unrecognized stored value", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only cast
    (window.localStorage as unknown as any).store[CONSENT_STORAGE_KEY] = "unknown";
    expect(readStoredConsent()).toBeNull();
  });
});
