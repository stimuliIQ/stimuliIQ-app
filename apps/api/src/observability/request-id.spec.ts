import { resolveRequestId, REQUEST_ID_HEADER } from "./request-id";

describe("resolveRequestId — AC-44 correlation id resolution", () => {
  it("reuses req.id when already resolved by an earlier middleware", () => {
    const req = { id: "existing-id", headers: { [REQUEST_ID_HEADER]: "header-id" } };
    expect(resolveRequestId(req)).toBe("existing-id");
  });

  it("uses the client-supplied X-Request-Id header when req.id is unset", () => {
    const req = { headers: { [REQUEST_ID_HEADER]: "client-supplied-id" } };
    expect(resolveRequestId(req)).toBe("client-supplied-id");
  });

  it("trims whitespace from a client-supplied header", () => {
    const req = { headers: { [REQUEST_ID_HEADER]: "  padded-id  " } };
    expect(resolveRequestId(req)).toBe("padded-id");
  });

  it("takes the first value when the header is duplicated (array)", () => {
    const req = { headers: { [REQUEST_ID_HEADER]: ["first-id", "second-id"] } };
    expect(resolveRequestId(req)).toBe("first-id");
  });

  it("generates a fresh uuid when neither req.id nor the header is present", () => {
    const req = { headers: {} };
    const id = resolveRequestId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("generates a fresh uuid when the header is an empty string", () => {
    const req = { headers: { [REQUEST_ID_HEADER]: "   " } };
    const id = resolveRequestId(req);
    expect(id.trim().length).toBeGreaterThan(0);
    expect(id).not.toBe("   ");
  });

  it("never returns an empty string", () => {
    const req = { headers: {} };
    expect(resolveRequestId(req).length).toBeGreaterThan(0);
  });
});
