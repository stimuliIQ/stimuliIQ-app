// Headless CMS data hooks (CRM/staff surface) — blog, testimonials, partners,
// faculty bios, content pages, plus newsletter/contact/career admin lists.
// Phase 9 Completion T22/T40. Mirrors use-batches.ts conventions (CLAUDE.md
// §3: no business logic in components).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  CreateContentPageRequest,
  CreateFacultyBioRequest,
  CreatePartnerRequest,
  CreateTestimonialRequest,
  ListBlogPostsQuery,
  ListCareerApplicationsQuery,
  ListContactSubmissionsQuery,
  ListContentPagesQuery,
  ListFacultyBiosQuery,
  ListNewsletterSubscriptionsQuery,
  ListPartnersQuery,
  ListTestimonialsQuery,
  UpdateBlogCategoryRequest,
  UpdateBlogPostRequest,
  UpdateCareerApplicationStatusRequest,
  UpdateContactSubmissionStatusRequest,
  UpdateContentPageRequest,
  UpdateFacultyBioRequest,
  UpdatePartnerRequest,
  UpdateTestimonialRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Blog ─────────────────────────────────────────────────────────────────

export const BLOG_QUERY_KEY = ["content", "blog"] as const;

export function useBlogCategories() {
  return useQuery({
    queryKey: [...BLOG_QUERY_KEY, "categories"] as const,
    queryFn: () => apiClient.crm.content.blog.listCategories(),
    staleTime: 60_000,
  });
}

function useInvalidateBlog() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: BLOG_QUERY_KEY });
}

export function useCreateBlogCategory() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: (body: CreateBlogCategoryRequest) => apiClient.crm.content.blog.createCategory(body),
    onSuccess: invalidate,
  });
}

export function useUpdateBlogCategory() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBlogCategoryRequest }) =>
      apiClient.crm.content.blog.updateCategory(id, body),
    onSuccess: invalidate,
  });
}

export function blogPostsListKey(query: ListBlogPostsQuery) {
  return [...BLOG_QUERY_KEY, "posts", "list", query] as const;
}

export function useBlogPostsList(query: ListBlogPostsQuery) {
  return useQuery({
    queryKey: blogPostsListKey(query),
    queryFn: () => apiClient.crm.content.blog.listPosts(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useBlogPost(id: string | undefined) {
  return useQuery({
    queryKey: [...BLOG_QUERY_KEY, "posts", "detail", id ?? ""] as const,
    queryFn: () => apiClient.crm.content.blog.getPost(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: (body: CreateBlogPostRequest) => apiClient.crm.content.blog.createPost(body),
    onSuccess: invalidate,
  });
}

export function useUpdateBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBlogPostRequest }) =>
      apiClient.crm.content.blog.updatePost(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.blog.removePost(id),
    onSuccess: invalidate,
  });
}

// ── Testimonials ─────────────────────────────────────────────────────────

export const TESTIMONIALS_QUERY_KEY = ["content", "testimonials"] as const;

export function useTestimonialsList(query: ListTestimonialsQuery) {
  return useQuery({
    queryKey: [...TESTIMONIALS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.content.testimonials.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateTestimonials() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: TESTIMONIALS_QUERY_KEY });
}

export function useCreateTestimonial() {
  const invalidate = useInvalidateTestimonials();
  return useMutation({
    mutationFn: (body: CreateTestimonialRequest) => apiClient.crm.content.testimonials.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTestimonial() {
  const invalidate = useInvalidateTestimonials();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTestimonialRequest }) =>
      apiClient.crm.content.testimonials.update(id, body),
    onSuccess: invalidate,
  });
}

/**
 * Publish a testimonial — makes it visible in the homepage "What Our Students Say"
 * section. Separate from `useUpdateTestimonial` because publishing is a dedicated
 * endpoint, not a status field on the PATCH (the API rejects `status: "published"` on
 * PATCH outright). Unpublishing IS a plain update to `draft`.
 */
export function usePublishTestimonial() {
  const invalidate = useInvalidateTestimonials();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.testimonials.publish(id),
    onSuccess: invalidate,
  });
}

export function useDeleteTestimonial() {
  const invalidate = useInvalidateTestimonials();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.testimonials.remove(id),
    onSuccess: invalidate,
  });
}

// ── Partners ─────────────────────────────────────────────────────────────

export const PARTNERS_QUERY_KEY = ["content", "partners"] as const;

export function usePartnersList(query: ListPartnersQuery) {
  return useQuery({
    queryKey: [...PARTNERS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.content.partners.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidatePartners() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY });
}

export function useCreatePartner() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (body: CreatePartnerRequest) => apiClient.crm.content.partners.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdatePartner() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePartnerRequest }) =>
      apiClient.crm.content.partners.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeletePartner() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.partners.remove(id),
    onSuccess: invalidate,
  });
}

// ── Faculty bios ─────────────────────────────────────────────────────────

export const FACULTY_BIOS_QUERY_KEY = ["content", "faculty-bios"] as const;

export function useFacultyBiosList(query: ListFacultyBiosQuery) {
  return useQuery({
    queryKey: [...FACULTY_BIOS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.content.facultyBios.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateFacultyBios() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: FACULTY_BIOS_QUERY_KEY });
}

export function useCreateFacultyBio() {
  const invalidate = useInvalidateFacultyBios();
  return useMutation({
    mutationFn: (body: CreateFacultyBioRequest) => apiClient.crm.content.facultyBios.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateFacultyBio() {
  const invalidate = useInvalidateFacultyBios();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFacultyBioRequest }) =>
      apiClient.crm.content.facultyBios.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteFacultyBio() {
  const invalidate = useInvalidateFacultyBios();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.facultyBios.remove(id),
    onSuccess: invalidate,
  });
}

// ── Content pages ────────────────────────────────────────────────────────

export const CONTENT_PAGES_QUERY_KEY = ["content", "pages"] as const;

export function useContentPagesList(query: ListContentPagesQuery) {
  return useQuery({
    queryKey: [...CONTENT_PAGES_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.content.pages.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateContentPages() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: CONTENT_PAGES_QUERY_KEY });
}

export function useCreateContentPage() {
  const invalidate = useInvalidateContentPages();
  return useMutation({
    mutationFn: (body: CreateContentPageRequest) => apiClient.crm.content.pages.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateContentPage() {
  const invalidate = useInvalidateContentPages();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateContentPageRequest }) =>
      apiClient.crm.content.pages.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteContentPage() {
  const invalidate = useInvalidateContentPages();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.content.pages.remove(id),
    onSuccess: invalidate,
  });
}

// ── Newsletter / contact / careers admin lists ──────────────────────────

export function useNewsletterSubscriptionsList(query: ListNewsletterSubscriptionsQuery) {
  return useQuery({
    queryKey: ["content", "newsletter", "list", query] as const,
    queryFn: () => apiClient.crm.content.newsletter.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useContactSubmissionsList(query: ListContactSubmissionsQuery) {
  return useQuery({
    queryKey: ["content", "contact", "list", query] as const,
    queryFn: () => apiClient.crm.content.contact.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useUpdateContactSubmissionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateContactSubmissionStatusRequest }) =>
      apiClient.crm.content.contact.updateStatus(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["content", "contact"] }),
  });
}

export function useCareerApplicationsList(query: ListCareerApplicationsQuery) {
  return useQuery({
    queryKey: ["content", "careers", "list", query] as const,
    queryFn: () => apiClient.crm.content.careers.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useCareerApplication(id: string | undefined) {
  return useQuery({
    queryKey: ["content", "careers", "detail", id ?? ""] as const,
    queryFn: () => apiClient.crm.content.careers.get(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateCareerApplicationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCareerApplicationStatusRequest }) =>
      apiClient.crm.content.careers.updateStatus(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["content", "careers"] }),
  });
}
