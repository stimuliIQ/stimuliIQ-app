// apps/api/src/prisma/audit.extension.spec.ts
//
// Unit coverage for the Wave 6 security-audit remediation (H-1/H-2): proves that
// `before`/`after` snapshots written to `audit_logs` never carry secret/verifier fields
// for the two models known to hold them (`User.passwordHash`, `Session.refreshHash`),
// without needing a real Postgres instance, the extension is exercised against a fake
// minimal "client" shaped like what `$allOperations` expects.

import { auditExtension } from "./audit.extension";
import { auditContextStorage } from "./audit-context";

type Snapshot = Record<string, unknown> | undefined;

function buildFakeClient(options: {
  before?: Snapshot;
  mutationResult: Snapshot;
}) {
  const created: { data: Record<string, unknown> }[] = [];

  const fakeClient: Record<string, unknown> = {
    user: {
      findFirst: jest.fn().mockResolvedValue(options.before),
    },
    session: {
      findFirst: jest.fn().mockResolvedValue(options.before),
    },
    auditLog: {
      create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return args.data;
      }),
    },
    $extends: jest.fn(),
  };

  return { fakeClient, created };
}

// Re-implements the extension's `$allOperations` registration call shape so we can
// invoke it directly without booting a real PrismaClient (Prisma.defineExtension's
// factory just needs an object with `$extends`/model delegates shaped correctly).
async function runOperation(
  fakeClient: Record<string, unknown>,
  args: {
    model: string;
    operation: "create" | "update" | "delete";
    args: unknown;
    mutationResult: unknown;
  },
) {
  let capturedAllOperations:
    | ((ctx: { model: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }) => Promise<unknown>)
    | undefined;

  (fakeClient.$extends as jest.Mock).mockImplementation((ext: unknown) => {
    const allOps = (
      ext as {
        query: {
          $allModels: {
            $allOperations: typeof capturedAllOperations;
          };
        };
      }
    ).query.$allModels.$allOperations;
    capturedAllOperations = allOps;
    return fakeClient;
  });

  // `auditExtension` is `Prisma.defineExtension((client) => client.$extends({...}))`.
  // Calling it with our fake client triggers `$extends`, which captures the hook above.
  (auditExtension as unknown as (client: unknown) => unknown)(fakeClient);

  if (!capturedAllOperations) {
    throw new Error("test setup failure: $allOperations was never captured");
  }

  return capturedAllOperations({
    model: args.model,
    operation: args.operation,
    args: args.args,
    query: async () => args.mutationResult,
  });
}

describe("auditExtension, secret redaction (Wave 6 H-1/H-2)", () => {
  it("strips passwordHash from both before and after snapshots on User update", async () => {
    const before = { id: "u1", tenantId: "t1", email: "a@b.com", passwordHash: "argon2-before-secret" };
    const after = { id: "u1", tenantId: "t1", email: "a@b.com", passwordHash: "argon2-after-secret" };
    const { fakeClient, created } = buildFakeClient({ before, mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1", actorId: "actor-1", ip: "1.2.3.4" }, () =>
      runOperation(fakeClient, {
        model: "User",
        operation: "update",
        args: { where: { id: "u1" } },
        mutationResult: after,
      }),
    );

    expect(created).toHaveLength(1);
    const row = created[0]?.data as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(row.before).not.toHaveProperty("passwordHash");
    expect(row.after).not.toHaveProperty("passwordHash");
    // email is PII-masked (not stripped) as of Phase-7 Wave 2 batch B, see the
    // dedicated "PII masking at write time" describe block below for full coverage.
    expect(row.before.email).toBe("*@*.com");
    expect(row.after.email).toBe("*@*.com");
  });

  it("strips refreshHash from both before and after snapshots on Session update", async () => {
    const before = { id: "s1", tenantId: "t1", userId: "u1", refreshHash: "hash-before" };
    const after = { id: "s1", tenantId: "t1", userId: "u1", refreshHash: "hash-after" };
    const { fakeClient, created } = buildFakeClient({ before, mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1", actorId: "actor-1" }, () =>
      runOperation(fakeClient, {
        model: "Session",
        operation: "update",
        args: { where: { id: "s1" } },
        mutationResult: after,
      }),
    );

    expect(created).toHaveLength(1);
    const row = created[0]?.data as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(row.before).not.toHaveProperty("refreshHash");
    expect(row.after).not.toHaveProperty("refreshHash");
    expect(row.before.userId).toBe("u1");
  });

  it("strips denylisted secret-shaped fields on models with no explicit allowlist", async () => {
    const after = { id: "r1", tenantId: "t1", key: "admin", token: "should-not-survive" };
    const { fakeClient, created } = buildFakeClient({ mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, {
        model: "Role",
        operation: "create",
        args: { data: after },
        mutationResult: after,
      }),
    );

    expect(created).toHaveLength(1);
    const row = created[0]?.data as { after: Record<string, unknown> };
    expect(row.after).not.toHaveProperty("token");
    expect(row.after.key).toBe("admin");
  });
});

// ─── Phase-7 Wave 2 security hardening batch B, item 2a: PII masking at WRITE time ───
// (DPDP right-to-erasure vs audit immutability policy, P5 L-1 / P6 L-2, AC-64 write path)

describe("auditExtension, PII masking at write time (DPDP, P5 L-1 / P6 L-2)", () => {
  it("masks User.email/phone/name in the after snapshot on create, while leaving id/status untouched", async () => {
    const after = {
      id: "u1",
      tenantId: "t1",
      email: "jane.doe@example.com",
      phone: "+919876543210",
      name: "Jane Doe",
      status: "active",
    };
    const { fakeClient, created } = buildFakeClient({ mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, {
        model: "User",
        operation: "create",
        args: { data: after },
        mutationResult: after,
      }),
    );

    expect(created).toHaveLength(1);
    const row = created[0]?.data as { after: Record<string, unknown> };
    expect(row.after.email).toBe("j***@e***.com");
    expect(row.after.phone).toBe("+91XXXXXX3210");
    expect(row.after.name).toBe("J***");
    // Non-PII fields survive unmodified.
    expect(row.after.id).toBe("u1");
    expect(row.after.status).toBe("active");
    // Never the raw values.
    expect(JSON.stringify(row.after)).not.toContain("jane.doe@example.com");
    expect(JSON.stringify(row.after)).not.toContain("9876543210");
    expect(JSON.stringify(row.after)).not.toContain("Jane Doe");
  });

  it("masks both User.passwordHash (stripped) AND email/name (masked) together on update", async () => {
    const before = { id: "u1", tenantId: "t1", email: "old@example.com", name: "Old Name", passwordHash: "secret-before" };
    const after = { id: "u1", tenantId: "t1", email: "new@example.com", name: "New Name", passwordHash: "secret-after" };
    const { fakeClient, created } = buildFakeClient({ before, mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, {
        model: "User",
        operation: "update",
        args: { where: { id: "u1" } },
        mutationResult: after,
      }),
    );

    const row = created[0]?.data as { before: Record<string, unknown>; after: Record<string, unknown> };
    // Secret stripped entirely (Wave 6 H-1 behavior, unchanged).
    expect(row.before).not.toHaveProperty("passwordHash");
    expect(row.after).not.toHaveProperty("passwordHash");
    // PII masked, not stripped (still present, just not raw).
    expect(row.before.email).toBe("o***@e***.com");
    expect(row.after.email).toBe("n***@e***.com");
    expect(row.before.name).toBe("O***");
    expect(row.after.name).toBe("N***");
  });

  it("masks Lead.email/phone/name on create", async () => {
    const after = { id: "l1", tenantId: "t1", name: "Prospective Student", phone: "9123456780", email: "lead@example.com", stage: "new" };
    const { fakeClient, created } = buildFakeClient({ mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, {
        model: "Lead",
        operation: "create",
        args: { data: after },
        mutationResult: after,
      }),
    );

    const row = created[0]?.data as { after: Record<string, unknown> };
    expect(row.after.name).toBe("P***");
    expect(row.after.email).toBe("l***@e***.com");
    expect(row.after.phone).not.toBe("9123456780");
    expect(row.after.stage).toBe("new"); // non-PII field untouched
  });

  it("masks CampaignRecipient.to (contact kind, handles either an email or a phone shape)", async () => {
    const afterEmail = { id: "cr1", tenantId: "t1", to: "recipient@example.com", status: "sent" };
    const { fakeClient: clientA, created: createdA } = buildFakeClient({ mutationResult: afterEmail });
    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(clientA, { model: "CampaignRecipient", operation: "create", args: { data: afterEmail }, mutationResult: afterEmail }),
    );
    const rowA = createdA[0]?.data as { after: Record<string, unknown> };
    expect(rowA.after.to).toBe("r***@e***.com");

    const afterPhone = { id: "cr2", tenantId: "t1", to: "+919876543210", status: "sent" };
    const { fakeClient: clientB, created: createdB } = buildFakeClient({ mutationResult: afterPhone });
    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(clientB, { model: "CampaignRecipient", operation: "create", args: { data: afterPhone }, mutationResult: afterPhone }),
    );
    const rowB = createdB[0]?.data as { after: Record<string, unknown> };
    expect(rowB.after.to).not.toBe("+919876543210");
    expect(String(rowB.after.to)).toContain("3210"); // last 4 digits preserved, per maskPhone
  });

  it("masks ReportSchedule.recipientEmail on create", async () => {
    const after = { id: "rs1", tenantId: "t1", recipientEmail: "owner@example.com", cadence: "weekly" };
    const { fakeClient, created } = buildFakeClient({ mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, { model: "ReportSchedule", operation: "create", args: { data: after }, mutationResult: after }),
    );

    const row = created[0]?.data as { after: Record<string, unknown> };
    expect(row.after.recipientEmail).toBe("o***@e***.com");
    expect(row.after.cadence).toBe("weekly");
  });

  it("does NOT mask a same-named 'name' field on a model with no PII registry entry (Role.name)", async () => {
    const after = { id: "role1", tenantId: "t1", key: "admin", name: "Admin" };
    const { fakeClient, created } = buildFakeClient({ mutationResult: after });

    await auditContextStorage.run({ tenantId: "t1" }, () =>
      runOperation(fakeClient, { model: "Role", operation: "create", args: { data: after }, mutationResult: after }),
    );

    const row = created[0]?.data as { after: Record<string, unknown> };
    // Role.name is a catalog label, not a personal name, must survive verbatim.
    expect(row.after.name).toBe("Admin");
  });
});
