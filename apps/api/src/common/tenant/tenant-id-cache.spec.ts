// Unit tests for the tenant-id memo (see tenant-id-cache.ts for why it exists).
// The behaviours pinned here are the ones that make it safe to put in front of a
// lookup that every public request depends on.

import { clearTenantIdCache, resolveTenantIdCached } from "./tenant-id-cache";

describe("resolveTenantIdCached", () => {
  beforeEach(() => {
    clearTenantIdCache();
  });

  it("loads once and serves subsequent calls from the cache", async () => {
    const load = jest.fn().mockResolvedValue("tenant-1");

    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBe("tenant-1");
    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBe("tenant-1");
    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBe("tenant-1");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches per slug, never across slugs", async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce("tenant-a")
      .mockResolvedValueOnce("tenant-b");

    await expect(resolveTenantIdCached("a", load)).resolves.toBe("tenant-a");
    await expect(resolveTenantIdCached("b", load)).resolves.toBe("tenant-b");
    await expect(resolveTenantIdCached("a", load)).resolves.toBe("tenant-a");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache a miss — a tenant seeded later resolves without a restart", async () => {
    const load = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("tenant-1");

    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBeNull();
    // Second call must hit the database again rather than repeat the cached miss.
    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBe("tenant-1");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent cold-start callers into a single load", async () => {
    let release: (id: string) => void = () => {};
    const load = jest.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );

    const all = Promise.all([
      resolveTenantIdCached("stimuliiq", load),
      resolveTenantIdCached("stimuliiq", load),
      resolveTenantIdCached("stimuliiq", load),
    ]);
    release("tenant-1");

    await expect(all).resolves.toEqual(["tenant-1", "tenant-1", "tenant-1"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed load instead of caching the failure", async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce("tenant-1");

    await expect(resolveTenantIdCached("stimuliiq", load)).rejects.toThrow("connection reset");
    await expect(resolveTenantIdCached("stimuliiq", load)).resolves.toBe("tenant-1");

    expect(load).toHaveBeenCalledTimes(2);
  });
});
