// Forum moderation view — CRM staff surface (task #11, Phase 6).
//
// Shows the moderation queue from GET /api/v1/crm/forum/moderation.
// Faculty sees only posts from their assigned batches (assigned-scope enforced by API).
// Admin sees all posts (all-scope). The API returns 404 for non-assigned batches —
// the UI reflects an empty queue in that case.
//
// Post bodies are sanitized with DOMPurify before rendering (AC-70, LOCK-6).
// Hide post requires a reason (ModerateDto.action='hide' + reason field).
// Confirm-on-destructive: hiding a post triggers ConfirmDialog.
// RBAC: UI hides hide/pin/delete controls when forum.moderate is absent —
// but the API enforces the permission server-side.
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  PageHeader,
  PostThread,
  type PostItem,
  Select,
  SelectItem,
  StatusChip,
  Textarea,
  useToast,
} from "@repo/ui";
import type {
  MeResponse,
  PostDto,
  PostStatus,
  ModerateDto,
  ModerateAction,
} from "@repo/types";

import {
  useModerationQueue,
  useModeratePost,
} from "../../hooks/use-forum-moderation";
import { hasPermission } from "../../lib/permissions";
import { sanitizeHtml } from "../../lib/sanitize";
import { queryErrorMessage } from "../../lib/surface-error";

// ── Status filter options ─────────────────────────────────────────────────────

const POST_STATUS_OPTIONS: Array<{ value: PostStatus | ""; label: string }> = [
  { value: "",        label: "All" },
  { value: "hidden",  label: "Hidden" },
  { value: "visible", label: "Visible (reported)" },
];

// ── Hide post form values ─────────────────────────────────────────────────────

interface HidePostFormValues {
  reason: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ForumModerationDirectoryProps {
  me: MeResponse | undefined;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForumModerationDirectory({
  me,
}: ForumModerationDirectoryProps): React.JSX.Element {
  const canModerate = hasPermission(me?.permissions, "forum.moderate");
  const { toast } = useToast();

  // Check if the user has admin-level role — `me.roles` is an array
  const isAdminScope = me?.roles?.some((r) => r === "admin" || r === "owner") ?? false;

  const [statusFilter, setStatusFilter] = React.useState<PostStatus | "">("");
  const [page, setPage] = React.useState(1);
  const [selectedPost, setSelectedPost] = React.useState<PostDto | null>(null);
  const [hideConfirmOpen, setHideConfirmOpen] = React.useState(false);
  const [pendingHidePost, setPendingHidePost] = React.useState<PostDto | null>(null);

  const PAGE_SIZE = 20;

  React.useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const { data, isLoading, isError, error, refetch, isFetching } = useModerationQueue({
    status: statusFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const moderatePostMutation = useModeratePost();

  function handleModerateAction(post: PostDto, action: ModerateAction, reason?: string) {
    const body: ModerateDto = {
      action,
      ...(reason ? { reason } : {}),
    };

    moderatePostMutation.mutate(
      { postId: post.id, body },
      {
        onSuccess: () => {
          toast({
            title:
              action === "hide"
                ? "Post hidden"
                : action === "unhide"
                  ? "Post unhidden"
                  : "Post deleted",
            variant: "success",
          });
          setSelectedPost(null);
          setPendingHidePost(null);
          setHideConfirmOpen(false);
        },
        onError: (err) => {
          toast({
            title: "Moderation action failed",
            description: (err as Error).message,
            variant: "destructive",
          });
          setHideConfirmOpen(false);
        },
      },
    );
  }

  // Columns for the moderation queue table
  const columns: Array<DataTableColumn<PostDto>> = [
    {
      id: "author",
      header: "Author",
      cell: (row) => (
        <span className="text-sm">
          <span className="font-medium text-fg">{row.author.displayName}</span>
          <span className="ml-1 text-xs text-fg-muted">{row.author.roleLabel}</span>
        </span>
      ),
    },
    {
      id: "body",
      header: "Post",
      cell: (row) => (
        <span className="line-clamp-2 text-sm text-fg-muted">
          {/* Strip HTML for table cell — no dangerouslySetInnerHTML in table */}
          {sanitizeHtml(row.body).replace(/<[^>]+>/g, "").slice(0, 120)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusChip
          tone={row.status === "hidden" ? "danger" : "info"}
          label={row.status === "hidden" ? "Hidden" : "Visible"}
        />
      ),
    },
    {
      id: "upvotes",
      header: "Upvotes",
      cell: (row) => row.upvotes,
      align: "right",
    },
    {
      id: "createdAt",
      header: "Posted",
      cell: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
  ];

  if (!canModerate) {
    return (
      <EmptyState
        title="Access restricted"
        description="You don't have permission to moderate forum content."
        data-testid="forum-moderation-no-permission"
      />
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load moderation queue"
        description={queryErrorMessage(error, "Something went wrong fetching the moderation queue.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="moderation-retry">
            Try again
          </Button>
        }
        data-testid="moderation-error"
      />
    );
  }

  // Build PostItem list for the detail drawer using PostThread
  const detailPostItems: PostItem[] = selectedPost
    ? [
        {
          id: selectedPost.id,
          authorId: selectedPost.author.id,
          authorDisplayName: selectedPost.author.displayName,
          // DOMPurify sanitize before rendering body (AC-70)
          body: sanitizeHtml(selectedPost.body),
          upvotes: selectedPost.upvotes,
          upvotedByCurrentUser: selectedPost.hasVoted ?? false,
          status: selectedPost.status,
          parentId: selectedPost.parentId,
          createdAt: selectedPost.createdAt,
          isResolution: selectedPost.isResolved,
        },
      ]
    : [];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="forum-moderation-directory">
      <PageHeader
        title="Forum moderation"
        description={
          isAdminScope
            ? "Moderating all batches."
            : "Moderating your assigned batches only. The API enforces assigned-scope."
        }
      />

      {/* Status filter */}
      <DataFilterBar data-testid="moderation-filter-bar">
        <Select
          label="Status"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PostStatus | "")}
          placeholder="Select status"
          wrapperClassName="w-48"
          data-testid="moderation-status-filter"
        >
          {POST_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      {/* Moderation queue table */}
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedPost(row)}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "Moderation queue is clear",
          description: statusFilter
            ? `No posts with status "${statusFilter}" in your assigned batches.`
            : "No posts pending moderation in your assigned batches.",
        }}
        caption="Forum moderation queue"
        data-testid="moderation-queue-table"
      />

      {/* Post detail drawer with moderation actions */}
      <Drawer open={Boolean(selectedPost)} onOpenChange={(open) => !open && setSelectedPost(null)}>
        <DrawerContent
          title="Post detail"
          description="Review this post and take moderation action."
          data-testid="post-detail-drawer"
        >
          <DrawerBody className="flex flex-col gap-4 overflow-y-auto">
            {selectedPost ? (
              <>
                {/* Thread context */}
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
                  Thread: <code className="font-mono">{selectedPost.threadId}</code>
                </div>

                {/* Post rendered via PostThread with moderation slot */}
                <PostThread
                  posts={detailPostItems}
                  isModerator={canModerate}
                  moderationSlot={(post) => (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {post.status === "visible" ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setPendingHidePost(selectedPost);
                            setHideConfirmOpen(true);
                          }}
                          data-testid={`hide-post-btn-${post.id}`}
                          aria-label="Hide this post"
                        >
                          Hide post
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleModerateAction(selectedPost, "unhide")}
                          loading={moderatePostMutation.isPending}
                          data-testid={`unhide-post-btn-${post.id}`}
                          aria-label="Unhide this post"
                        >
                          Unhide post
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleModerateAction(selectedPost, "delete")}
                        loading={moderatePostMutation.isPending}
                        data-testid={`delete-post-btn-${post.id}`}
                        aria-label="Soft-delete this post"
                      >
                        <span className="text-danger">Delete post</span>
                      </Button>
                    </div>
                  )}
                  data-testid="post-detail-thread"
                />
              </>
            ) : null}
          </DrawerBody>

          <DrawerFooter>
            <Button
              variant="secondary"
              onClick={() => setSelectedPost(null)}
              data-testid="close-post-detail-btn"
            >
              Close
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Confirm hide post — requires a reason (AC-65) */}
      <ConfirmHideDialog
        open={hideConfirmOpen}
        onOpenChange={(open) => {
          setHideConfirmOpen(open);
          if (!open) {
            setPendingHidePost(null);
          }
        }}
        onConfirm={(reason) => {
          if (pendingHidePost) {
            handleModerateAction(pendingHidePost, "hide", reason);
          }
        }}
        loading={moderatePostMutation.isPending}
      />
    </div>
  );
}

// ── Confirm hide dialog with required reason field ────────────────────────────

interface ConfirmHideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}

function ConfirmHideDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: ConfirmHideDialogProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HidePostFormValues>({
    defaultValues: { reason: "" },
  });

  function onSubmit(values: HidePostFormValues) {
    onConfirm(values.reason);
  }

  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Hide post"
        description="This post will be hidden from students. Provide a reason for the moderation audit log."
        data-testid="confirm-hide-post-drawer"
      >
        <DrawerBody>
          <form
            id="hide-post-form"
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            className="flex flex-col gap-4"
            noValidate
            aria-label="Hide post reason"
          >
            <Textarea
              id="hide-reason"
              label="Reason for hiding"
              required
              helperText="This reason will be visible to other moderators and stored in the audit log."
              error={errors.reason?.message}
              {...register("reason", {
                required: "A reason is required to hide a post (AC-65)",
              })}
              rows={3}
              placeholder="e.g. Inappropriate content, spam, off-topic"
              data-testid="hide-reason-input"
            />
          </form>
        </DrawerBody>
        <DrawerFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid="cancel-hide-btn"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="hide-post-form"
            variant="destructive"
            loading={loading}
            data-testid="confirm-hide-btn"
          >
            Hide post
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
