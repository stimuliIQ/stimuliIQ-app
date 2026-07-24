// Shared headless-CMS primitives — Phase 9 Completion, T8/T14. `ContentStatus` mirrors
// the Prisma `ContentStatus` enum shared by BlogPost, Testimonial, Partner, FacultyBio,
// ContentPage, LandingPage (see prisma/schema.prisma comment on the enum). Defined once
// here so every content-type schema file imports the same enum instead of re-declaring
// it (which would collide at the `@repo/types` barrel export).

import { z } from "zod";

export const ContentStatusSchema = z.enum(["draft", "published", "archived"]);
export type ContentStatus = z.infer<typeof ContentStatusSchema>;
