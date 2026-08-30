// Regression test for the session-killing refresh race (see @repo/api-client
// ApiClient.refreshInFlight).
//
// THE BUG THIS PINS DOWN: the refresh token rotates and is single-use, and the API
// revokes the ENTIRE session family when an already-rotated one is replayed
// (auth.service.ts refresh() -> `auth.refresh_reuse_detected`). The role permission
// matrix loads the permission catalog and the selected role's grants in parallel, so
// once the 15-minute access token expired both 401'd in the same instant, both called
// `onUnauthorized`, and the second /auth/refresh presented a stale token — logging the
// staff member out and leaving the modal stuck on "Couldn't load the permission matrix".
//
// The client is exercised through its PUBLIC surface (two concurrent `request()` calls
// against a stubbed fetch) rather than by poking at the private field, so the test still
// means something if the internals change.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient } from "@repo/api-client";

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: null, error: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      data: null,
      meta: null,
      error: { type: "about:blank", title: "Unauthorized", status: 401, code: "auth.unauthenticated" },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient 401 -> refresh seam", () => {
  it("refreshes ONCE when two requests 401 at the same time, then retries both", async () => {
    // Both first attempts 401 (expired access token); both retries succeed.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(envelope({ modules: [] }))
      .mockResolvedValueOnce(envelope({ grants: [] }));
    vi.stubGlobal("fetch", fetchMock);

    let refreshStarted = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    const client = new ApiClient({
      baseUrl: "http://localhost:4000",
      appAudience: "crm",
      onUnauthorized: async () => {
        refreshStarted += 1;
        // Hold the refresh open so the second 401 is guaranteed to arrive while it is
        // still in flight — the exact overlap that used to fire a second /auth/refresh.
        await refreshGate;
        return "retried";
      },
    });

    const catalog = client.request("GET", "/api/v1/crm/admin/permissions");
    const grants = client.request("GET", "/api/v1/crm/admin/roles/role-1/permissions");

    // Let both initial requests reach their 401 before the refresh is allowed to finish.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releaseRefresh();

    await expect(catalog).resolves.toEqual({ modules: [] });
    await expect(grants).resolves.toEqual({ grants: [] });

    expect(refreshStarted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 x (401 + replay), no extra refresh race
  });

  it("does not reuse a settled refresh — a later 401 gets its own", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(envelope({ ok: true }))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(envelope({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    let refreshStarted = 0;
    const client = new ApiClient({
      baseUrl: "http://localhost:4000",
      appAudience: "crm",
      onUnauthorized: async () => {
        refreshStarted += 1;
        return "retried";
      },
    });

    await expect(client.request("GET", "/api/v1/crm/admin/permissions")).resolves.toEqual({ ok: true });
    await expect(client.request("GET", "/api/v1/crm/admin/permissions")).resolves.toEqual({ ok: true });

    expect(refreshStarted).toBe(2);
  });

  it("surfaces the 401 to every waiter when the shared refresh fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(unauthorized());
    vi.stubGlobal("fetch", fetchMock);

    let refreshStarted = 0;
    const client = new ApiClient({
      baseUrl: "http://localhost:4000",
      appAudience: "crm",
      onUnauthorized: async () => {
        refreshStarted += 1;
        return "failed";
      },
    });

    const results = await Promise.allSettled([
      client.request("GET", "/api/v1/crm/admin/permissions"),
      client.request("GET", "/api/v1/crm/admin/roles/role-1/permissions"),
    ]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(refreshStarted).toBe(1);
  });
});
