// /search — Global search + bookmarks. Phase 9 Completion, T36. docs/02 §7.17.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { LmsShell } from "../../components/shell/lms-shell";
import { SearchContent } from "../../components/search/search-content";

export const metadata: Metadata = {
  title: "Search | stimuliiq",
  description: "Search lessons, resources, and forum discussions across your courses.",
};

export default function SearchPage() {
  return (
    <LmsShell>
      <SearchContent />
    </LmsShell>
  );
}
