// apps/api/test/integration/global-teardown.ts
//
// Stops any testcontainers started by global-setup.ts (no-op if the fallback ambient-env
// path was used, or if Docker was unavailable entirely) and removes the temp state file.

import { rmSync } from "node:fs";
import { STATE_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  const containers = globalThis.__stimuliiqContainers;
  if (containers?.postgres) await containers.postgres.stop();
  if (containers?.redis) await containers.redis.stop();

  rmSync(STATE_FILE, { force: true });
}
