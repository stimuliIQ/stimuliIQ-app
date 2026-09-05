// @repo/ui — shared design system (shadcn/Radix + Tailwind tokens), CLAUDE.md §1 & §2.
//
// Theming: import "@repo/ui/styles.css" once at the app root (alongside Tailwind, which
// consumes the same CSS variables via @repo/config/tailwind/preset). Dark mode toggles via
// the `.dark` class on <html>; density via `data-density="compact"` (CRM) per docs/07 §12.

export const PACKAGE_NAME = "@repo/ui" as const;

export { cn } from "./lib/cn";

// The interaction behind a rail/column nav whose sections open a flyout panel. Headless, so
// the CRM sidebar and the LMS side nav share the fiddly part (hover intent, touch fallback,
// escape, outside-click) while keeping their own very different layouts.
export { useFlyoutNav } from "./lib/use-flyout-nav";
export type { UseFlyoutNavOptions, UseFlyoutNavResult } from "./lib/use-flyout-nav";

// Where a flyout card sits. Split from useFlyoutNav because it is the LAYOUT half and needs
// a measured panel height; see its header for why capping height instead of sliding the card
// up is the wrong fix (it grows a scrollbar on any section near the bottom of the column).
export { useFlyoutPosition } from "./lib/use-flyout-position";
export type { UseFlyoutPositionOptions, FlyoutPosition } from "./lib/use-flyout-position";

export {
  PHONE_LOCAL_LENGTH,
  PHONE_COUNTRY_CODE,
  PHONE_PLACEHOLDER,
  PHONE_INPUT_PROPS,
  PHONE_LENGTH_MESSAGE,
  toLocalPhoneDigits,
  isCompleteLocalPhone,
  toE164Phone,
} from "./lib/phone";

export { isValidEmail, EMAIL_FORMAT_MESSAGE } from "./lib/email";

export { Button, buttonVariants, type ButtonProps } from "./components/button";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/card";

export { Label } from "./components/label";
export { Input, type InputProps, type InputSize } from "./components/input";
export { Textarea, type TextareaProps, type TextareaSize } from "./components/textarea";
export { PasswordInput, type PasswordInputProps } from "./components/password-input";
export {
  PasswordRequirements,
  type PasswordRequirementsProps,
  type PasswordRequirementsRule,
} from "./components/password-requirements";

export { Tooltip, type TooltipProps, type TooltipSide } from "./components/tooltip";

// Help text behind an info icon. Distinct from Tooltip: that is a hover-only visual
// label for an icon-only control, this is a click-to-open, screen-reader-readable
// explanation that wraps (see the component header for why they are not one thing).
export { InfoHint, type InfoHintProps, type InfoHintAlign } from "./components/info-hint";
export { ActionMenu, type ActionMenuProps, type ActionMenuItem } from "./components/action-menu";

export { Alert, Callout, type AlertProps } from "./components/alert";

export {
  DetailGrid,
  DetailRow,
  type DetailGridProps,
  type DetailGridColumns,
  type DetailRowProps,
} from "./components/detail-grid";

export {
  ToastProvider,
  useToast,
  type ToastItem,
} from "./components/toast";

export { Checkbox, type CheckboxProps } from "./components/checkbox";
export { CheckboxField, type CheckboxFieldProps } from "./components/checkbox-field";

export {
  DataTable,
  Pagination,
  type DataTableColumn,
  type DataTablePaginationState,
  type DataTableProps,
  type DataTableSelectionState,
  type DataTableSortState,
  type PaginationProps,
  type SortDirection,
} from "./components/data-table";

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  type DrawerContentProps,
} from "./components/drawer";

export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";

export { Select, SelectItem, type SelectProps } from "./components/select";

export {
  StatusChip,
  makeStatusChip,
  type StatusChipProps,
  type StatusChipTone,
} from "./components/status-chip";

export {
  STATUS_SEMANTICS,
  statusTone,
  type StatusSemantic,
} from "./lib/status-semantics";

export {
  BADGE_COLOR_PATTERN,
  BADGE_COLOR_PRESETS,
  badgeContrastRatio,
  isValidBadgeColor,
  readableTextOn,
} from "./lib/badge-color";

export { EmptyState, type EmptyStateProps } from "./components/empty-state";
export { EmptyIllustration, type EmptyIllustrationProps } from "./components/empty-illustration";

export { PageHeader, type PageHeaderProps } from "./components/page-header";

export { Skeleton, type SkeletonProps, type SkeletonShape } from "./components/skeleton";

export {
  FormField,
  type FormFieldProps,
  type FormFieldRenderProps,
} from "./components/form-field";

export { ConfirmDialog, type ConfirmDialogProps } from "./components/confirm-dialog";
// General-purpose centred dialog. The other three dialogs here are purpose-built
// (Drawer = edge record editor, ConfirmDialog = one yes/no, ExitIntentModal = lead capture);
// this is the plain "arbitrary content in a box" one. See its file header.
export { Modal, type ModalProps } from "./components/modal";

// P2 Commerce + Leads primitives -----------------------------------------------

export {
  MoneyInput,
  formatPaise,
  type MoneyInputProps,
} from "./components/money-input";

export {
  DateChip,
  formatAbsoluteDate,
  formatRelativeDate,
  type DateChipProps,
  type DateChipFormat,
} from "./components/date-chip";

export {
  SlaChip,
  computeSlaState,
  SLA_SOON_THRESHOLD_MS,
  type SlaChipProps,
  type SlaStatus,
  type SlaState,
} from "./components/sla-chip";

export {
  ActivityTimeline,
  ActivityTimelineItem,
  type ActivityTimelineProps,
  type ActivityTimelineItemProps,
  type ActivityItem,
  type ActivityType,
} from "./components/activity-timeline";

export {
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  type KanbanBoardProps,
  type KanbanColumnProps,
  type KanbanCardProps,
  type KanbanColumnDef,
  type KanbanCardRenderContext,
} from "./components/kanban";

// P3 LMS primitives -----------------------------------------------------------

export {
  ProgressRing,
  ProgressBar,
  type ProgressRingProps,
  type ProgressBarProps,
  type ProgressTone,
} from "./components/progress";

export {
  VideoPlayer,
  type VideoPlayerProps,
  type VideoPlayerStatus,
  type VideoCaption,
  type HlsEngineHandle,
  type CreateHlsEngine,
} from "./components/video-player";

export { CourseCard, type CourseCardProps } from "./components/course-card";

export {
  CurriculumAccordion,
  LessonList,
  type CurriculumAccordionProps,
  type LessonListProps,
  type CurriculumModule,
  type LessonItem,
  type LessonType,
  type LessonStatus,
} from "./components/curriculum-accordion";

export {
  ContinueLearning,
  type ContinueLearningProps,
} from "./components/continue-learning";

// P4 Learning Depth primitives -----------------------------------------------

export {
  CountdownTimer,
  type CountdownTimerProps,
} from "./components/countdown-timer";

export {
  CertificateCard,
  type CertificateCardProps,
  type CertificateStatus,
} from "./components/certificate-card";

export {
  RubricGrader,
  type RubricGraderProps,
  type RubricCriterion,
  type RubricValue,
} from "./components/rubric-grader";

export {
  QuizRunner,
  QuestionCard,
  type QuizRunnerProps,
  type QuizRunnerSubmitPayload,
  type QuestionCardProps,
  type AssessmentQuestionPublic,
  type QuizAnswers,
  type QuizOption,
  type QuizQuestionType,
} from "./components/quiz-runner";

export {
  FileUpload,
  type FileUploadProps,
  type FileUploadEntry,
  type FileUploadStatus,
  type SignedUploadResult,
} from "./components/file-upload";

// P5 Marketing primitives -----------------------------------------------

export {
  MarketingHeader,
  type MarketingHeaderProps,
  type NavItem,
  type MegaMenuConfig,
  type MegaMenuSection,
  type MegaMenuItemBadge,
} from "./components/marketing-header";

export {
  MarketingFooter,
  type MarketingFooterProps,
  type FooterColumn,
  type FooterLink,
  type SocialLink,
} from "./components/marketing-footer";

export { HeroSplit, type HeroSplitProps } from "./components/hero-split";

export {
  StatBand,
  type StatBandProps,
  type StatItem,
} from "./components/stat-band";

export {
  ProgramCard,
  type ProgramCardProps,
} from "./components/program-card";

export {
  StickyBuyCard,
  MobileBuyBar,
  type StickyBuyCardProps,
  type MobileBuyBarProps,
} from "./components/sticky-buy-card";

export {
  TestimonialCard,
  type TestimonialCardProps,
} from "./components/testimonial-card";

export {
  LogoWall,
  type LogoWallProps,
  type LogoItem,
} from "./components/logo-wall";

export {
  FaqAccordion,
  buildFaqJsonLd,
  type FaqAccordionProps,
  type FaqItem,
  type FaqJsonLdItem,
} from "./components/faq-accordion";

export {
  PricingTable,
  type PricingTableProps,
  type PricingTier,
  type PricingFeatureRow,
} from "./components/pricing-table";

export {
  Breadcrumbs,
  buildBreadcrumbJsonLd,
  type BreadcrumbsProps,
  type BreadcrumbItem,
} from "./components/breadcrumbs";

export {
  MultiStepForm,
  type MultiStepFormProps,
  type MultiStep,
} from "./components/multi-step-form";

export {
  ConsentBanner,
  readStoredConsent,
  CONSENT_STORAGE_KEY,
  type ConsentBannerProps,
  type ConsentChoice,
} from "./components/consent-banner";

export { WhatsAppFab, type WhatsAppFabProps } from "./components/whatsapp-fab";

export {
  LeadFormInline,
  ExitIntentModal,
  StickyLeadBar,
  type LeadFormInlineProps,
  type ExitIntentModalProps,
  type StickyLeadBarProps,
  type LeadFormValues,
  type LeadFormField,
  type ProgramOption,
  type UtmParams,
} from "./components/lead-forms";

// P6 Engagement primitives -----------------------------------------------

export {
  NotificationItem,
  type NotificationItemProps,
  type NotificationType,
} from "./components/notification-item";

export {
  NotificationBell,
  type NotificationBellProps,
  type NotificationBellItem,
} from "./components/notification-bell";

export {
  NotificationPrefsMatrix,
  NOTIFICATION_CHANNEL_LABELS,
  type NotificationPrefsMatrixProps,
  type NotificationChannel,
  type NotificationTypeRow,
  type NotificationMatrix,
  type QuietHoursConfig,
} from "./components/notification-prefs-matrix";

export {
  BadgeChip,
  BadgeGrid,
  type BadgeChipProps,
  type BadgeGridProps,
  type BadgeGridItem,
} from "./components/badge-chip";

export {
  PointsBadge,
  StreakFlame,
  type PointsBadgeProps,
  type StreakFlameProps,
} from "./components/points-badge";

export {
  LeaderboardTable,
  type LeaderboardTableProps,
  type LeaderboardEntry,
} from "./components/leaderboard-table";

export {
  ThreadList,
  ThreadCard,
  type ThreadListProps,
  type ThreadCardProps,
  type ThreadSummary,
  type ThreadStatus,
} from "./components/thread-list";

export {
  PostThread,
  type PostThreadProps,
  type PostItem,
  type PostStatus,
} from "./components/post-thread";

export {
  CampaignBuilder,
  type CampaignBuilderProps,
} from "./components/campaign-builder";

export {
  AudienceSegmentFilter,
  FILTER_OPERATOR_LABELS,
  type AudienceSegmentFilterProps,
  type SegmentFieldDef,
  type SegmentFilter,
  type FilterOperator,
} from "./components/audience-segment-filter";

export {
  CampaignMetricsCard,
  type CampaignMetricsCardProps,
  type CampaignMetrics,
} from "./components/campaign-metrics-card";

// P7 Analytics chart primitives -----------------------------------------------

export {
  ChartFrame,
  ChartLegend,
  type ChartFrameProps,
  type ChartLegendProps,
  type ChartLegendItem,
} from "./components/chart-frame";

export {
  CHART_COLOR_VARS,
  chartColor,
  getChartColor,
  type ChartColorVar,
} from "./lib/chart-colors";

export {
  KpiCard,
  type KpiCardProps,
  type KpiSparklinePoint,
  type KpiTrendDirection,
  type KpiTrendTone,
} from "./components/kpi-card";

export {
  LineChart,
  AreaChart,
  type TrendChartProps,
  type TrendSeries,
} from "./components/trend-chart";

export { BarChart, type BarChartProps, type BarSeries } from "./components/bar-chart";

export {
  FunnelChart,
  type FunnelChartProps,
  type FunnelStage,
} from "./components/funnel-chart";

export {
  DonutChart,
  PieChart,
  type DonutChartProps,
  type DonutSegment,
} from "./components/donut-chart";

// P9 Completion primitives (T19) -----------------------------------------------

export {
  sanitizeRichContent,
  stripRichContent,
  RICH_CONTENT_ALLOWED_TAGS,
  RICH_CONTENT_ALLOWED_ATTR,
  type SanitizeRichContentOptions,
} from "./lib/sanitize";

export { RenderSink, type RenderSinkProps } from "./components/render-sink";

export {
  Calendar,
  type CalendarProps,
  type CalendarEvent,
  type CalendarView,
  type CalendarDayTone,
} from "./components/calendar";

export {
  DetailShell,
  type DetailShellProps,
  type DetailShellTab,
} from "./components/detail-shell";

export {
  TicketThread,
  type TicketThreadProps,
  type TicketMessage,
  type TicketMessageAuthorRole,
  type TicketCannedResponse,
} from "./components/ticket-thread";

export {
  DataFilterBar,
  type DataFilterBarProps,
  type FilterChip,
  type SavedFilterView,
} from "./components/data-filter-bar";

export {
  StarRatingInput,
  TestimonialInput,
  type StarRatingInputProps,
  type TestimonialInputProps,
  type TestimonialFormValues,
} from "./components/testimonial-input";

export { Switch, type SwitchProps } from "./components/switch";


// P10 Page Builder UI-polish primitives -----------------------------------------------

export {
  CollapsibleSection,
  type CollapsibleSectionProps,
  type CollapsibleSectionAccentTone,
} from "./components/collapsible-section";
