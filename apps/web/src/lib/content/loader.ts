/**
 * Content loader — reads MDX files from the `content/` directory at build time.
 *
 * Uses `gray-matter` to extract frontmatter without importing MDX at runtime.
 * All functions are async and Node.js `fs`-based — only safe in RSC / build context.
 *
 * Content directories:
 *   content/blog/         — blog posts (*.mdx)
 *   content/pages/        — trust & content pages (about, faculty, etc.)
 *   content/faq/          — FAQ entries (*.mdx with FaqEntryFrontmatter)
 *
 * Usage (in a page component or generateStaticParams):
 *   const posts = await getAllBlogPosts();
 *   const post = await getBlogPost("my-post-slug");
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

import type {
  BlogPostMeta,
  BlogPostFrontmatter,
  ContentPageMeta,
  ContentPageFrontmatter,
  FaqEntryFrontmatter,
} from "./types";

// ---------------------------------------------------------------------------
// Paths (relative to the repo root, but resolved from process.cwd())
// ---------------------------------------------------------------------------

// In Next.js, process.cwd() is the app root (apps/web)
function contentDir(...parts: string[]): string {
  return join(process.cwd(), "content", ...parts);
}

// ---------------------------------------------------------------------------
// Generic MDX file reader
// ---------------------------------------------------------------------------

async function readMdxFile<T>(
  filePath: string,
): Promise<{ frontmatter: T; content: string }> {
  const raw = await readFile(filePath, "utf-8");
  const { data, content } = matter(raw);
  return { frontmatter: data as T, content };
}

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

/**
 * List all blog posts sorted by date descending.
 * Only returns metadata (no body content) — efficient for listing pages.
 */
export async function getAllBlogPosts(): Promise<BlogPostMeta[]> {
  const dir = contentDir("blog");
  let files: string[] = [];

  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".mdx"));
  } catch {
    // Content dir doesn't exist yet (no posts) — return empty
    return [];
  }

  const posts: BlogPostMeta[] = [];

  for (const file of files) {
    const slug = file.replace(/\.mdx$/, "");
    try {
      const { frontmatter } = await readMdxFile<BlogPostFrontmatter>(join(dir, file));
      posts.push({
        ...frontmatter,
        slug: frontmatter.slug ?? slug,
        href: `/blog/${frontmatter.slug ?? slug}`,
      });
    } catch {
      // Skip malformed files
    }
  }

  // Sort by date descending (newest first)
  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * Get a single blog post by slug — returns frontmatter.
 * The caller renders the MDX body via `next/dynamic` or `import()`.
 */
export async function getBlogPostMeta(slug: string): Promise<BlogPostMeta | null> {
  const filePath = contentDir("blog", `${slug}.mdx`);
  try {
    const { frontmatter } = await readMdxFile<BlogPostFrontmatter>(filePath);
    return {
      ...frontmatter,
      slug: frontmatter.slug ?? slug,
      href: `/blog/${frontmatter.slug ?? slug}`,
    };
  } catch {
    return null;
  }
}

/**
 * Get slugs for all blog posts (used in generateStaticParams).
 */
export async function getBlogPostSlugs(): Promise<string[]> {
  const dir = contentDir("blog");
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => f.replace(/\.mdx$/, ""));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Content pages (About, Faculty, Testimonials, Partners, Gallery, Career, FAQ)
// ---------------------------------------------------------------------------

/**
 * Get a content page by slug (e.g. "about", "faculty").
 */
export async function getContentPageMeta(slug: string): Promise<ContentPageMeta | null> {
  const filePath = contentDir("pages", `${slug}.mdx`);
  try {
    const { frontmatter } = await readMdxFile<ContentPageFrontmatter>(filePath);
    return {
      ...frontmatter,
      slug,
      href: `/${slug}`,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// FAQ entries (global FAQ page)
// ---------------------------------------------------------------------------

/**
 * Load all FAQ entries from content/faq/*.mdx.
 * Returns sorted by `order` field (ascending), then by filename.
 */
export async function getAllFaqEntries(): Promise<FaqEntryFrontmatter[]> {
  const dir = contentDir("faq");
  let files: string[] = [];

  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".mdx"));
  } catch {
    return [];
  }

  const entries: FaqEntryFrontmatter[] = [];

  for (const file of files) {
    try {
      const { frontmatter } = await readMdxFile<FaqEntryFrontmatter>(join(dir, file));
      entries.push(frontmatter);
    } catch {
      // Skip malformed files
    }
  }

  return entries.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
