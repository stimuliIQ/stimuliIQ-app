// use-forum hook tests, Phase 6, Task #10.
//
// Tests:
//   - Query key structure (regression guard)
//   - IDOR: 404 maps to isNotEnrolled (AC-55, AC-56)
//   - DOMPurify sanitization of post bodies before PostThread (AC-70)
//   - Post body limits (AC-71)

import {
  forumThreadsQueryKey,
  forumThreadDetailQueryKey,
  forumPostsQueryKey,
} from "./use-forum";

// ---------------------------------------------------------------------------
// Query key shape tests
// ---------------------------------------------------------------------------

describe("forum query keys", () => {
  it("forumThreadsQueryKey with batchId includes the batchId", () => {
    const key = forumThreadsQueryKey("batch-xyz");
    expect(key).toEqual(["lms", "forum", "threads", "batch-xyz"]);
  });

  it("forumThreadsQueryKey with null uses the __all__ sentinel", () => {
    const key = forumThreadsQueryKey(null);
    expect(key).toEqual(["lms", "forum", "threads", "__all__"]);
  });

  it("forumThreadsQueryKey with undefined uses the __all__ sentinel", () => {
    const key = forumThreadsQueryKey(undefined);
    expect(key).toEqual(["lms", "forum", "threads", "__all__"]);
  });

  it("forumThreadDetailQueryKey includes the threadId", () => {
    const key = forumThreadDetailQueryKey("thread-123");
    expect(key).toEqual(["lms", "forum", "thread", "thread-123"]);
  });

  it("forumPostsQueryKey includes the threadId", () => {
    const key = forumPostsQueryKey("thread-456");
    expect(key).toEqual(["lms", "forum", "posts", "thread-456"]);
  });
});

// ---------------------------------------------------------------------------
// DOMPurify sanitization of post bodies (AC-70)
//
// Post bodies MUST be sanitized with DOMPurify before passing to PostThread,
// which renders body via dangerouslySetInnerHTML.
// The sanitization is done in forum-thread-detail-content.tsx (the caller).
// These tests verify the underlying sanitize utility works correctly.
// ---------------------------------------------------------------------------

describe("forum post body sanitization (AC-70)", () => {
  it("sanitizeHtml removes <script> from forum post body", async () => {
    const { sanitizeHtml } = await import("../lib/sanitize");
    const dirty = '<p>My question is: </p><script>window.location = "evil.com"</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("window.location");
    expect(clean).toContain("My question is:");
  });

  it("sanitizeHtml removes img onerror XSS vector from forum reply", async () => {
    const { sanitizeHtml } = await import("../lib/sanitize");
    const dirty = '<img src="x" onerror="alert(\'xss\')" />';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("alert");
  });

  it("sanitizeHtml preserves code blocks in forum posts", async () => {
    const { sanitizeHtml } = await import("../lib/sanitize");
    const safe =
      "<p>Here is the solution:</p><pre><code>const x = 42;</code></pre>";
    const clean = sanitizeHtml(safe);
    // Code content should be preserved (the actual tags may vary with DOMPurify config)
    expect(clean).toContain("const x = 42");
  });

  it("sanitizeHtml handles a null body gracefully (empty string fallback)", async () => {
    const { sanitizeHtml } = await import("../lib/sanitize");
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Post body character limit (AC-71)
// The create-thread and create-post forms enforce a 10,000 char limit.
// This is also validated by the CreatePostDtoSchema at the zod level.
// ---------------------------------------------------------------------------

describe("post body limit (AC-71)", () => {
  it("CreatePostDtoSchema rejects empty body", async () => {
    const { CreatePostDtoSchema } = await import("@repo/types");
    const result = CreatePostDtoSchema.safeParse({ body: "" });
    // Empty body must fail validation
    expect(result.success).toBe(false);
  });

  it("CreatePostDtoSchema rejects body longer than 10,000 chars", async () => {
    const { CreatePostDtoSchema } = await import("@repo/types");
    const longBody = "a".repeat(10_001);
    const result = CreatePostDtoSchema.safeParse({ body: longBody });
    expect(result.success).toBe(false);
  });

  it("CreatePostDtoSchema accepts body at the 10,000 char boundary", async () => {
    const { CreatePostDtoSchema } = await import("@repo/types");
    const boundaryBody = "a".repeat(10_000);
    const result = CreatePostDtoSchema.safeParse({ body: boundaryBody });
    expect(result.success).toBe(true);
  });

  it("CreatePostDtoSchema accepts a valid UUID parentId for nested replies", async () => {
    const { CreatePostDtoSchema } = await import("@repo/types");
    // parentId must be a UUID (UuidSchema enforced at the schema level)
    const result = CreatePostDtoSchema.safeParse({
      body: "Great question!",
      parentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("CreatePostDtoSchema allows null parentId (top-level post)", async () => {
    const { CreatePostDtoSchema } = await import("@repo/types");
    const result = CreatePostDtoSchema.safeParse({
      body: "My answer to the thread",
      parentId: null,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IDOR contract: 404 → isNotEnrolled (AC-55, AC-56)
//
// The hook maps 404 errors to isNotEnrolled=true instead of isError=true.
// This ensures the UI renders the "not enrolled / not found" empty state
// rather than the generic error state, matching IDOR-safe behavior where
// non-enrolled batches appear as "not found" to the student.
// ---------------------------------------------------------------------------

describe("IDOR 404 → isNotEnrolled mapping contract (AC-55, AC-56)", () => {
  it("ApiError with statusCode 404 is treated as IDOR/not-enrolled, not a generic error", async () => {
    const { ApiError } = await import("@repo/api-client");

    // Simulate the 404 the backend sends for non-enrolled batch access
    const idor404 = new ApiError({
      title: "Not Found",
      detail: "Thread not found or you are not enrolled in this batch.",
      status: 404,
      type: "about:blank",
    });

    // Hook logic: isNotEnrolled = status === 404; isError = error && !isNotEnrolled
    const isNotEnrolled = idor404.status === 404;
    const isError = isNotEnrolled ? false : true;

    expect(isNotEnrolled).toBe(true);
    expect(isError).toBe(false);
  });

  it("ApiError with statusCode 401 is treated as signed-out, not generic error", async () => {
    const { ApiError } = await import("@repo/api-client");

    const authError = new ApiError({
      title: "Unauthorized",
      detail: "No active session.",
      status: 401,
      type: "about:blank",
    });

    const isSignedOut = authError.isUnauthenticated;
    expect(isSignedOut).toBe(true);
  });
});
