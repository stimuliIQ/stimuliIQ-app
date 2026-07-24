// Must be imported before any `.openapi()` call anywhere in this package.
// Patches the shared `zod` module (the same instance every schema file
// imports) with `.openapi()` so schemas can carry OpenAPI metadata without
// duplicating shapes in a separate OpenAPI-only definition (CLAUDE.md §3.2 —
// one schema per shape, no dupes; this keeps zod as the single source of
// truth and OpenAPI as a derived artifact).

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
