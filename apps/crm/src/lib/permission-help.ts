// Plain-English help for the Roles & Permissions matrix (docs/03 §7.16).
//
// WHY THIS FILE EXISTS. The matrix renders the raw permission catalog: a module key as
// a heading ("activities", "attempts", "dpdp", "bulk") and a `Verb Noun` label per row
// ("Convert activities"). Both come from prisma/seed.ts and are written for engineers.
// Somebody deciding what a Counsellor should be able to do cannot tell from
// "activities.convert" that it turns a logged call into a lead, or that the whole
// `tenant.*` / `user.*` group is dead scaffold that grants nothing. So every row and
// every module heading gets an info icon backed by the text below.
//
// IT LIVES IN THE CLIENT, NOT THE DATABASE, ON PURPOSE. `Permission` has `key` + `label`
// and no description column, and adding one would mean a migration plus a re-seed of a
// LIVE catalog every time a sentence is reworded. This is help text, not data: nobody
// edits it without a deploy anyway, and keeping it here means an unknown key still
// renders something sensible instead of a blank popover.
//
// COVERAGE IS BY FALLBACK, NOT BY DISCIPLINE. `describePermission` returns a hand-written
// sentence when there is one and otherwise builds one from the key's action verb and its
// module noun. A permission seeded in some future phase therefore gets usable help the
// day it appears, without this file being touched.

export interface ModuleHelp {
  /** Human heading for the module group, e.g. "Activities" for `activities`. */
  title: string;
  /** One or two sentences: what part of the product this group of permissions covers. */
  summary: string;
}

/** Turn `notification_prefs` into "Notification prefs". */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy scaffold keys.
//
// Phase 0 seeded a Cartesian `module × [create|read|update|delete|list]` catalog for ten
// SINGULAR module names (tenant, branch, user, role, ...) before any real feature existed.
// Not one of those 50 keys guards a CRM route today, and every one of them has a real,
// plural successor: `user.update` is dead, `users.edit` is the live key. Saying so is the
// single most useful thing this screen can tell an administrator, because these rows are
// otherwise indistinguishable from working ones.
// ─────────────────────────────────────────────────────────────────────────────
const LEGACY_MODULES: Record<string, string> = {
  tenant: "Company settings are controlled by the Settings permissions.",
  branch: "Branches are controlled by the Branches permissions.",
  user: "Staff accounts are controlled by the Users permissions.",
  role: "Roles are controlled by the Roles permissions.",
  permission: "Permission grants are controlled by the Roles permissions.",
  program: "Programs are controlled by the Courses permissions.",
  module: "Course modules are controlled by the Courses permissions.",
  lesson: "Lessons are controlled by the Lessons permissions.",
  session: "Login sessions have no permission gate, they belong to the account itself.",
  audit_log: "The audit trail is controlled by the Audit logs permissions.",
};

const MODULE_HELP: Record<string, ModuleHelp> = {
  // ── People and academics ──────────────────────────────────────────────────
  students: {
    title: "Students",
    summary: "Student records: profile, contact details, enrolments, batch and progress.",
  },
  faculty: {
    title: "Faculty",
    summary: "Internal teaching staff records. Mentors hired from outside are a separate group.",
  },
  mentors: {
    title: "Mentors",
    summary:
      "Subject experts hired from outside the company who lead a batch to completion. Separate from Faculty, who are internal hires.",
  },
  mentor: {
    title: "Mentor dashboard",
    summary: "The mentor's own view of the batches assigned to them. Held by mentors, not by office staff.",
  },
  courses: {
    title: "Courses",
    summary: "The course catalogue: programs, their modules, pricing and what is published to the website.",
  },
  batches: {
    title: "Batches",
    summary: "A batch is one cohort running a course on a schedule. Students are enrolled into batches.",
  },
  enrollments: {
    title: "Enrolments",
    summary: "The link between a student and a batch, including start date, status and transfers.",
  },
  branches: {
    title: "Branches",
    summary: "Physical offices or centres. Used to scope who sees whose records.",
  },
  roles: {
    title: "Roles and permissions",
    summary: "This screen. Who can create roles and change what each role is allowed to do.",
  },
  users: {
    title: "Staff users",
    summary: "Staff accounts that can sign in to the CRM: invite, edit, deactivate, delete.",
  },
  twofa: {
    title: "Two-factor authentication",
    summary: "Second-factor sign-in setup, both a person's own and clearing someone else's.",
  },
  audit_logs: {
    title: "Audit logs",
    summary: "The record of who changed what and when. Read-only history, nobody can edit it.",
  },

  // ── Commerce ──────────────────────────────────────────────────────────────
  orders: { title: "Orders", summary: "A student's purchase of a program, before and after it is paid for." },
  payments: { title: "Payments", summary: "Money actually received, online through Razorpay or recorded manually." },
  invoices: { title: "Invoices", summary: "The GST invoice issued for a paid order." },
  refunds: { title: "Refunds", summary: "Money sent back to a student. Note the company's stated policy is no refunds." },
  coupons: { title: "Coupons", summary: "Discount codes: their value, limits and expiry." },
  emi: { title: "EMI plans", summary: "Instalment plans and their collection schedule." },
  referrals: { title: "Referrals", summary: "Referral links, who was referred, and approving the reward." },

  // ── Sales pipeline ────────────────────────────────────────────────────────
  leads: {
    title: "Leads",
    summary: "Prospective students from the website, campaigns and walk-ins, up to the point they enrol.",
  },
  activities: {
    title: "Activities",
    summary: "Calls, meetings, follow-ups and notes logged against a lead or a student. The day-to-day record of contact.",
  },
  bookings: { title: "Bookings", summary: "Counselling slots booked from the website." },
  bulk: { title: "Bulk actions", summary: "Changing many records at once, for example reassigning a whole list of leads." },
  marketing_targets: {
    title: "Marketing targets",
    summary: "The monthly deals and revenue goal set for each marketing person, and progress against it.",
  },
  campaigns: { title: "Campaigns", summary: "Email, SMS and WhatsApp campaigns sent to leads and students." },
  landing_pages: { title: "Landing pages", summary: "Standalone campaign pages, separate from the main marketing site." },
  lead_forms: { title: "Lead forms", summary: "The enquiry forms on the website and what fields they ask for." },
  onboarding: {
    title: "Onboarding",
    summary: "The form a student fills in after paying, and the queue where staff accept or reject each submission.",
  },

  // ── Teaching and learning ─────────────────────────────────────────────────
  lessons: { title: "Lessons", summary: "Individual lessons inside a course module and their content." },
  videos: { title: "Videos", summary: "Recorded lesson video, including permission to play it through a signed link." },
  videolib: { title: "Video library", summary: "Lesson videos: the uploaded file, its transcode status and its captions." },
  resources: { title: "Resources", summary: "Downloadable files attached to lessons: slides, notes, datasets." },
  progress: { title: "Progress", summary: "How far a student has got through a course." },
  liveclass: { title: "Live classes", summary: "Scheduled Zoom or Meet sessions, and joining them." },
  assignments: { title: "Assignments", summary: "Work set for students, including its brief and deadline." },
  submissions: {
    title: "Submissions",
    summary:
      "What students hand in, and the review of it. Reviewing means either grading it or sending it back for another attempt.",
  },
  projects: { title: "Projects", summary: "Longer project work reviewed by a mentor rather than graded numerically." },
  assessments: { title: "Assessments", summary: "Quizzes and tests: their questions, marks and settings." },
  attempts: {
    title: "Assessment attempts",
    summary: "A student's individual sitting of an assessment, and grading the written answers.",
  },
  certificates: { title: "Certificates", summary: "Recommending, issuing and revoking completion certificates." },
  bookmarks: { title: "Bookmarks", summary: "A student's own saved lessons. Personal, not visible to staff." },
  notes: { title: "Lesson notes", summary: "A student's own private notes on a lesson." },
  search: { title: "Search", summary: "The global search box across lessons, resources and forum threads." },

  // ── Engagement and support ────────────────────────────────────────────────
  forum: { title: "Forum", summary: "The student discussion board: reading, posting and moderating." },
  gamification: { title: "Gamification", summary: "Points, badges and streaks shown to a student." },
  notifications: { title: "Notifications", summary: "In-app notifications a person receives." },
  notification_prefs: {
    title: "Notification preferences",
    summary: "A person's own choice of which alerts they get and on which channel.",
  },
  tickets: {
    title: "Support tickets",
    summary: "Student support requests: raising, replying, assigning and closing them.",
  },
  kb: { title: "Knowledge base", summary: "Help articles students can read for themselves." },
  canned_responses: {
    title: "Canned responses",
    summary: "Saved reply templates support staff can insert into a ticket.",
  },

  // ── Website and content ───────────────────────────────────────────────────
  content: {
    title: "Website content",
    summary:
      "Blog posts, testimonials, partners, colleges and the marketing pages themselves. Editing a page means filling in a fixed template, not rearranging the layout.",
  },
  site_settings: {
    title: "Site settings",
    summary: "Site-wide navigation, footer, contact details and default SEO for the marketing website.",
  },
  stats: {
    title: "Site stats",
    summary: "Legacy key. Homepage numbers now live in the home page's own stats section, edited with the page.",
  },
  careers: {
    title: "Careers and hiring",
    summary:
      "Job openings shown on the website and the applications that come in. Deliberately separate from website content: an application carries a stranger's CV.",
  },

  // ── Reporting and platform ────────────────────────────────────────────────
  reports: {
    title: "Reports",
    summary: "Business dashboards and the ability to export or schedule them. Each report is granted separately.",
  },
  dpdp: {
    title: "Data protection",
    summary: "Acting on a person's request to have their personal data erased, as required by the DPDP Act.",
  },
  settings: { title: "System settings", summary: "Company details, tax settings, integrations and other configuration." },
  leave: {
    title: "Leave management",
    summary: "Staff time off: applying, approving, and setting up leave types, allowances and holidays.",
  },
};

/** Action verb templates, used when a key has no hand-written sentence. */
const ACTION_TEMPLATES: Record<string, (noun: string) => string> = {
  view: (noun) => `Lets this role open and read ${noun}.`,
  create: (noun) => `Lets this role add new ${noun}.`,
  edit: (noun) => `Lets this role change existing ${noun}.`,
  delete: (noun) => `Lets this role permanently remove ${noun}.`,
  export: (noun) => `Lets this role download ${noun} as a spreadsheet or PDF.`,
  approve: (noun) => `Lets this role approve ${noun}.`,
  manage: (noun) => `Lets this role add, change and remove ${noun}.`,
};

/** Hand-written help, keyed by permission key. Anything absent falls back to a template. */
const PERMISSION_HELP: Record<string, string> = {
  // ── Students, faculty, mentors ────────────────────────────────────────────
  "students.view": "Opens the Students list and any student's record: contact details, batch, payments and progress.",
  "students.create": "Adds a student record by hand, without going through a payment or an onboarding submission.",
  "students.edit": "Changes a student's details, including their batch and their status.",
  "students.delete": "Removes a student record. It is hidden rather than erased, so history and invoices survive.",
  "students.export": "Downloads the student list as a spreadsheet, personal contact details included.",
  "students.approve": "Approves student records that are waiting on a check before they go live.",
  "faculty.view": "Opens the Faculty list and each internal trainer's record.",
  "faculty.create": "Adds a new internal faculty member.",
  "faculty.edit": "Changes a faculty member's details and their batch assignments.",
  "faculty.delete": "Removes a faculty record.",
  "faculty.export": "Downloads the faculty list as a spreadsheet.",
  "mentors.view": "Opens the Mentors list, the experts hired from outside to run batches.",
  "mentors.create": "Adds a new mentor.",
  "mentors.edit": "Changes a mentor's details.",
  "mentors.delete": "Removes a mentor record.",
  "mentors.assign": "Puts a mentor in charge of a batch, or takes them off it.",
  "mentor.dashboard.view":
    "Sees your own mentor dashboard and the batches assigned to you. This is a mentor's permission, not a manager's.",
  "batches.markComplete":
    "Declares a batch's internship programme finished, which is what makes its students eligible for a certificate.",

  // ── Courses, batches, enrolments, branches ────────────────────────────────
  "courses.view": "Opens the course catalogue and each course's modules and lessons.",
  "courses.create": "Creates a new course.",
  "courses.edit": "Changes a course, including its price and whether it is published on the website.",
  "courses.delete": "Removes a course from the catalogue.",
  "courses.export": "Downloads the course catalogue as a spreadsheet.",
  "courses.approve": "Approves a course before it can be published.",
  "batches.view": "Opens the Batches list and each batch's schedule and student roster.",
  "batches.create": "Starts a new batch of a course.",
  "batches.edit": "Changes a batch's schedule, faculty, mentor or status.",
  "batches.delete": "Removes a batch.",
  "batches.export": "Downloads batch data as a spreadsheet.",
  "enrollments.view": "Sees which students are enrolled in which batch.",
  "enrollments.create": "Enrols a student into a batch by hand.",
  "enrollments.edit": "Moves a student to another batch or changes their enrolment status.",
  "enrollments.delete": "Cancels an enrolment.",
  "enrollments.export": "Downloads enrolment data as a spreadsheet.",
  "enrollments.approve": "Approves an enrolment that is waiting on a check.",
  "branches.view": "Sees the list of offices or centres.",
  "branches.create": "Adds a branch.",
  "branches.edit": "Renames a branch or changes its details.",
  "branches.delete": "Removes a branch.",

  // ── Roles, users, security ────────────────────────────────────────────────
  "roles.view": "Opens this Roles and permissions screen.",
  "roles.create": "Creates a new role, for example a second kind of counsellor.",
  "roles.edit":
    "Changes what a role can do, which is this editor. A powerful permission: whoever holds it decides what their colleagues can reach. The server still stops anyone granting more than they hold themselves.",
  "roles.delete": "Deletes a custom role. Built-in roles cannot be deleted.",
  "users.view": "Opens the staff user list.",
  "users.create": "Invites a new staff member and gives them a sign-in.",
  "users.edit": "Changes a staff member's name, role or status.",
  "users.delete": "Deactivates a staff account so they can no longer sign in.",
  "users.remove": "Permanently deletes a staff account, as opposed to just deactivating it.",
  "users.reset_password": "Sets a new password for another staff member who is locked out.",
  "users.export": "Downloads the staff list as a spreadsheet.",
  "twofa.manage":
    "Sets up and turns off two-factor authentication on your OWN account. Every role needs this for themselves.",
  "twofa.reset":
    "Clears SOMEONE ELSE'S second factor when they have lost their phone. Kept separate from managing your own, since it is a way back into another person's account.",
  "audit_logs.view": "Reads the audit trail of who changed what and when. Nobody can edit or delete these entries.",
  "search.use": "Uses the global search box.",

  // ── Commerce ──────────────────────────────────────────────────────────────
  "orders.view": "Opens the Orders list and each order's items and payment state.",
  "orders.create": "Creates an order by hand, for a payment taken offline.",
  "orders.edit": "Changes an order before it is paid.",
  "orders.delete": "Cancels an order.",
  "orders.export": "Downloads orders as a spreadsheet.",
  "orders.approve": "Approves an order that needs a sign-off.",
  "payments.view": "Sees money received, both online and recorded by hand.",
  "payments.create": "Records a payment taken offline, by cash, cheque or bank transfer.",
  "payments.edit": "Corrects a payment record.",
  "payments.delete": "Removes a payment record. Rarely correct, since it changes the books.",
  "payments.export": "Downloads payment data as a spreadsheet.",
  "payments.approve": "Approves a payment that is held for verification.",
  "invoices.view": "Opens invoices and downloads the PDF.",
  "invoices.create": "Raises an invoice by hand.",
  "invoices.edit": "Corrects invoice details.",
  "invoices.delete": "Voids an invoice.",
  "invoices.export": "Downloads invoice data as a spreadsheet.",
  "refunds.view": "Sees refund requests and their state.",
  "refunds.create": "Starts a refund, which sends money back to the student.",
  "refunds.edit": "Changes a refund before it is processed.",
  "refunds.approve": "Approves a refund and releases the money.",
  "refunds.delete": "Cancels a refund request.",
  "refunds.export": "Downloads refund data as a spreadsheet.",
  "coupons.view": "Sees discount codes and how often each has been used.",
  "coupons.create": "Creates a discount code.",
  "coupons.edit": "Changes a code's value, limit or expiry.",
  "coupons.delete": "Withdraws a discount code.",
  "coupons.export": "Downloads coupon data as a spreadsheet.",
  "coupons.approve": "Approves a discount code before it can be used.",
  "emi.view": "Sees instalment plans and what is still owed.",
  "emi.create": "Puts a student on an instalment plan.",
  "emi.edit": "Changes an instalment schedule.",
  "emi.charge": "Collects or reconciles an instalment, which moves real money.",
  "referrals.view": "Sees referral links and who came in through them.",
  "referrals.create": "Creates a referral link.",
  "referrals.edit": "Changes a referral record.",
  "referrals.approve": "Approves a referral and releases the reward.",

  // ── Leads and marketing ───────────────────────────────────────────────────
  "leads.view": "Opens the Leads pipeline and each enquiry's details and history.",
  "leads.create": "Adds a lead by hand, for a walk-in or a phone enquiry.",
  "leads.edit": "Changes a lead's stage, owner or details.",
  "leads.delete": "Removes a lead.",
  "leads.export": "Downloads the lead list as a spreadsheet, contact details included.",
  "leads.approve": "Approves a lead that is waiting on a check.",
  "leads.convert": "Turns a lead into an enrolled student. This is the step that closes the sale.",
  "activities.view": "Reads the calls, meetings and follow-ups logged against leads and students.",
  "activities.create": "Logs a call, meeting, follow-up or note.",
  "activities.edit": "Edits a logged activity.",
  "activities.delete": "Deletes a logged activity, which removes it from the contact history.",
  "activities.export": "Downloads activity history as a spreadsheet.",
  "activities.approve": "Approves an activity that needs a sign-off.",
  "activities.convert":
    "Turns a logged activity into a lead, so an enquiry that arrived as a note enters the pipeline.",
  "bookings.view": "Sees counselling slots booked from the website.",
  "bookings.create": "Books a counselling slot on a student's behalf.",
  "bookings.edit": "Reschedules or updates a booking.",
  "bookings.delete": "Cancels a booking.",
  "bookings.export": "Downloads bookings as a spreadsheet.",
  "bookings.approve": "Confirms a requested slot.",
  "bulk.leads": "Changes many leads at once, for example reassigning a whole list to another owner.",
  "bulk.students": "Changes many student records at once.",
  "marketing_targets.view":
    "Sees YOUR OWN monthly target and how far along you are. It shows nobody else's numbers.",
  "marketing_targets.manage":
    "Sets each person's monthly deals and revenue target, and sees the whole team's progress.",
  "campaigns.view": "Sees campaigns and how they performed.",
  "campaigns.create": "Builds a new email, SMS or WhatsApp campaign.",
  "campaigns.edit": "Edits a campaign before it goes out.",
  "campaigns.send":
    "Actually sends a campaign to real people. Separate from editing on purpose, since sending cannot be undone.",
  "campaigns.delete": "Deletes a campaign.",
  "landing_pages.view": "Sees standalone campaign landing pages.",
  "landing_pages.edit": "Edits a campaign landing page.",
  "lead_forms.view": "Sees the enquiry forms used on the website.",
  "lead_forms.edit": "Changes what an enquiry form asks for.",

  // ── Onboarding ────────────────────────────────────────────────────────────
  "onboarding.view": "Opens the queue of onboarding forms students filled in after paying.",
  "onboarding.edit":
    "Accepts or rejects an onboarding submission. Accepting enrols the student, raises the invoice and emails their LMS login, so this is a permission that acts on a real person.",
  "onboarding.delete": "Deletes an onboarding submission.",
  "onboarding.fields.manage":
    "Edits the LIVE onboarding form itself: adding, renaming, reordering or removing questions. Changes appear on the public form straight away.",

  // ── Careers ───────────────────────────────────────────────────────────────
  "careers.view": "Reads job applications, including the CVs people attached.",
  "careers.review":
    "Decides an application: hold it, shortlist it, make an offer, or reject it. Three of those four email the candidate immediately, and an offer or a rejection cannot be taken back.",
  "careers.openings.manage": "Publishes, edits and closes the job openings shown on the website careers page.",

  // ── Teaching and learning ─────────────────────────────────────────────────
  "lessons.view": "Opens lessons and their content.",
  "lessons.create": "Adds a lesson to a course module.",
  "lessons.edit": "Edits lesson content.",
  "lessons.delete": "Removes a lesson.",
  "lessons.export": "Downloads lesson data as a spreadsheet.",
  "lessons.stream": "Plays the video attached to a lesson.",
  "videos.view": "Sees which videos are attached to which lessons.",
  "videos.create": "Attaches a video to a lesson.",
  "videos.edit": "Replaces or re-titles a lesson's video.",
  "videos.delete": "Detaches a video from a lesson.",
  "videos.export": "Downloads video metadata as a spreadsheet.",
  "videos.stream":
    "Plays protected course video. This is what mints the temporary playback link, so it is the permission that actually grants viewing.",
  "videolib.view": "Browses the library of uploaded videos.",
  "videolib.upload": "Uploads a video to a lesson, or replaces the one already on it.",
  "videolib.edit": "Edits a video's caption tracks.",
  "videolib.delete": "Takes a video off its lesson, leaving the lesson with no video.",
  "resources.view": "Sees the files attached to lessons.",
  "resources.create": "Attaches a file to a lesson.",
  "resources.edit": "Replaces or renames an attached file.",
  "resources.delete": "Removes an attached file.",
  "resources.export": "Downloads the resource list as a spreadsheet.",
  "resources.stream": "Opens a protected resource file through a temporary link.",
  "progress.view": "Sees how far students have got through their course.",
  "progress.create": "Records progress on a student's behalf.",
  "progress.edit": "Corrects a progress record.",
  "progress.delete": "Clears a progress record.",
  "progress.export": "Downloads progress data as a spreadsheet.",
  "liveclass.view": "Sees the live class schedule.",
  "liveclass.create": "Schedules a live class.",
  "liveclass.edit": "Reschedules or edits a live class.",
  "liveclass.cancel": "Cancels a scheduled live class and tells the students.",
  "liveclass.join": "Joins a live class as a participant.",
  "assignments.view": "Sees assignments and their briefs.",
  "assignments.create": "Sets a new assignment for a batch.",
  "assignments.edit": "Edits an assignment's brief, deadline or marks.",
  "assignments.grade":
    "Marks student work. Also covers sending work back for another attempt instead of grading it low.",
  "submissions.view": "Opens the queue of work students have handed in.",
  "submissions.create": "Submits work. This is a student's permission.",
  "submissions.grade":
    "Reviews a submission, which is two things: giving it a final grade, or sending it back with a reason so the student can try again.",
  "projects.review": "Reviews project work, which a mentor assesses rather than scores.",
  "assessments.view": "Sees quizzes and tests.",
  "assessments.create": "Builds a new quiz or test.",
  "assessments.edit": "Edits questions, marks or settings on an assessment.",
  "attempts.take": "Sits an assessment. This is a student's permission.",
  "attempts.view": "Sees students' assessment attempts and their answers.",
  "attempts.grade": "Marks the written answers in an attempt, the ones a computer cannot score.",
  "certificates.view": "Sees issued certificates.",
  "certificates.recommend": "Puts a student forward for a certificate, without issuing it.",
  "certificates.issue": "Issues the certificate, which makes it real and publicly verifiable.",
  "certificates.revoke": "Withdraws a certificate that was issued in error.",
  "certificates.verify":
    "Legacy key. Certificate verification is a public page that needs no sign-in, so no role has to hold this.",
  "bookmarks.manage": "Manages your OWN saved lessons. A student's personal list, not something staff can read.",
  "notes.manage": "Manages your OWN lesson notes. Private to the person who wrote them.",

  // ── Engagement and support ────────────────────────────────────────────────
  "forum.read": "Reads the student discussion board.",
  "forum.post": "Posts and replies on the discussion board.",
  "forum.moderate": "Edits, hides or removes other people's posts.",
  "gamification.view": "Sees your own points, badges and streaks.",
  "notifications.view": "Sees your own notifications.",
  "notification_prefs.edit": "Chooses which alerts you get and on which channel. Your own settings only.",
  "tickets.view": "Opens support tickets raised by students.",
  "tickets.create": "Raises a support ticket.",
  "tickets.edit": "Replies to and updates a support ticket.",
  "tickets.assign": "Hands a ticket to another staff member.",
  "tickets.close": "Closes a ticket as resolved.",
  "kb.view": "Reads knowledge base articles.",
  "kb.edit": "Writes and publishes knowledge base articles that students will read.",
  "canned_responses.manage": "Maintains the saved reply templates support staff insert into tickets.",

  // ── Website content ───────────────────────────────────────────────────────
  "content.view": "Opens website content in the CRM, including drafts that are not live yet.",
  "content.create": "Creates content such as a blog post, testimonial, partner or college entry.",
  "content.edit": "Edits existing content.",
  "content.delete": "Deletes content.",
  "content.publish":
    "Puts content live on the public website. Separate from editing, because publishing is what the world sees.",
  "content.builder":
    "Edits the marketing pages themselves. Each page has a fixed layout: you fill in the text and images of its sections, you cannot add, remove or reorder them. Saving publishes immediately, with a version history to fall back on.",
  "site_settings.view": "Sees site-wide settings: navigation, footer, contact details, default SEO.",
  "site_settings.edit": "Changes site-wide settings. These show on every page of the public website.",
  "stats.headline":
    "Legacy key that controls nothing. Homepage numbers are edited inside the home page's own stats section.",

  // ── Reports ───────────────────────────────────────────────────────────────
  "reports.revenue.view":
    "Opens the revenue dashboard (money collected over time) AND the team revenue report, which splits the same money by team.",
  "reports.enrollment.view": "Opens the enrolment trend report.",
  "reports.funnel.view": "Opens the lead funnel report, which measures the BUSINESS as a whole.",
  "reports.engagement.view": "Opens the course engagement report: what students are actually watching and finishing.",
  "reports.campaigns.view": "Opens the campaign performance report.",
  "reports.gamification.view": "Opens the gamification participation report.",
  "reports.forum.view": "Opens the forum health report.",
  "reports.lead_performance.view":
    "Opens the per-person lead report, which measures INDIVIDUAL STAFF BY NAME. Kept separate from the funnel report because letting a rep see colleagues' numbers is a management decision.",
  "reports.export": "Downloads reports and entity lists as CSV or PDF.",
  "reports.schedule": "Sets a report to be emailed on a schedule.",

  // ── Platform, settings, data protection ───────────────────────────────────
  "settings.view": "Sees company and system settings.",
  "settings.edit": "Changes company and system settings, which affects the whole product.",
  "dpdp.erasure.execute":
    "Carries out a data erasure request by redacting a person's personal details from the audit trail. Required by the DPDP Act and cannot be undone.",

  // ── Leave ─────────────────────────────────────────────────────────────────
  "leave.view": "Sees leave requests and balances.",
  "leave.request": "Applies for your own leave and cancels a request you made.",
  "leave.calendar.view":
    "Opens the shared team calendar, which shows WHEN someone is away but never WHY. Reasons are deliberately left out.",
  "leave.approve":
    "Approves or rejects staff leave. Held by the super admin and HR. Which requests somebody actually sees is decided by the org chart, not by this key — a team lead sees their own team.",
  "leave.manage":
    "Sets up leave types, yearly allowances, the holiday list and the working week. Held by the super admin and HR.",

  // ── Organisation ──────────────────────────────────────────────────────────
  "org.teams.view":
    "Sees the teams, who manages them and who leads them. Reading the org chart only.",
  "org.teams.manage":
    "Creates and edits teams, and names their managers and team leads. More powerful than it sounds: because a team decides who approves its members' leave, whoever holds this can change who signs somebody's absence off — including their own. Held by the super admin and HR.",
};

/**
 * True for the ten phase-0 scaffold modules whose keys guard nothing.
 *
 * Exported so the editor can file them under their own heading instead of leaving them
 * mixed in with permissions that actually do something.
 */
export function isLegacyScaffoldModule(module: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_MODULES, module);
}

/** The module heading's title and summary, with a sensible fallback for unknown modules. */
export function describeModule(module: string): ModuleHelp {
  const known = MODULE_HELP[module];
  if (known) return known;

  const legacy = LEGACY_MODULES[module];
  if (legacy) {
    return {
      title: humanize(module),
      summary: `Left over from the platform's original scaffold. Nothing in the CRM checks these keys, so granting them has no effect. ${legacy}`,
    };
  }

  return { title: humanize(module), summary: `Permissions for ${humanize(module).toLowerCase()}.` };
}

/**
 * The help sentence for one permission row. Falls back to an action-verb template so a
 * newly seeded key is never left with an empty popover.
 *
 * `label` is the catalog's own label, used only as the last-resort noun.
 */
export function describePermission(key: string, label: string): string {
  const written = PERMISSION_HELP[key];
  if (written) return written;

  const [module, ...rest] = key.split(".");
  const action = rest[rest.length - 1] ?? "";

  if (module && LEGACY_MODULES[module]) {
    return `Left over from the platform's original scaffold. Nothing checks this key, so granting it has no effect. ${LEGACY_MODULES[module]}`;
  }

  const noun = module ? describeModule(module).title.toLowerCase() : label.toLowerCase();
  const template = ACTION_TEMPLATES[action];
  return template ? template(noun) : `Controls ${label.toLowerCase()}.`;
}
