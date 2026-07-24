-- Program marketing: scholarship badge flag.
-- When true the public website renders a "Scholarship available" badge on the
-- course card and detail page. Display-only flag (waivers are a leads/commerce
-- concern); default false so existing rows are unaffected.
ALTER TABLE "programs" ADD COLUMN "scholarship_available" BOOLEAN NOT NULL DEFAULT false;
