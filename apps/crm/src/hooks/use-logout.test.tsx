// Regression anchor for "log out, log back in, land on the dashboard".
//
// The bug this pins: AppShell renders `<LoginForm />` IN PLACE OF the current route while
// signed out and never touches the URL. So signing out of /marketing/targets left the URL
// there, and signing back in put you straight back on /marketing/targets. Nothing about the
// login path is wrong — the URL simply has to be cleared on the way out, and this is the
// only place that does it.
//
// It must survive a FAILED logout too: the cache invalidation next to it is deliberately in
// `onSettled`, so the navigation has to be as well. Otherwise a network blip on logout
// leaves the user staring at a login form with the last page they worked on in the URL bar.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const logoutMock = vi.fn();
vi.mock("../lib/api-client", () => ({
  apiClient: { auth: { logout: (...args: unknown[]) => logoutMock(...args) } },
}));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

import { useLogout } from "./use-logout";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLogout", () => {
  it("sends the browser to the dashboard so the next sign-in lands there", async () => {
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("replaces rather than pushes, so Back does not return to the signed-in page", async () => {
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock.mock.calls[0]![0]).toMatchObject({ replace: true });
  });

  it("still clears the URL when the logout request FAILS", async () => {
    // `onSettled`, not `onSuccess` — matching the cache invalidation beside it. A failed
    // logout must not leave the last worked-on page in the URL bar behind a login form.
    logoutMock.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true }));
  });

  it("calls the logout endpoint exactly once per click", async () => {
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
