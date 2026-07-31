// prisma/seed-psychology-curriculum.ts — curriculum for the Certified Psychology Program.
//
//     pnpm db:seed:psychology            # apply
//     pnpm db:seed:psychology --dry-run  # report what would change, commit nothing
//
// Data only — the writer (idempotent, never-deletes, transactional) lives in
// ./curriculum-seed.ts. See that file for the safety properties and the week/title
// convention. This file is the source of truth for the syllabus: edit here and re-run,
// don't hand-edit rows in Supabase.
//
// SHAPE NOTE: unlike the neurology programme, this syllabus has no weekly "Practical
// Activities" blocks, and the capstone is Module 16 rather than a separate section — so
// it is 16 modules, with the capstone's options as its lessons.

import { a, runCurriculumSeed, type ModuleSpec } from "./curriculum-seed";

const CURRICULUM: ModuleSpec[] = [
  // ── Week 1 — Foundations of Psychology & Human Behaviour ────────────────
  {
    title: "Week 1 · Module 1: Introduction to Psychology",
    lessons: [
      "What is Psychology?",
      "Branches of Psychology",
      "Schools of Psychology",
      "Evolution of Psychology",
      "Applications in Healthcare",
    ],
  },
  {
    title: "Week 1 · Module 2: Research & Ethics",
    lessons: [
      "Scientific Method",
      "Research Designs",
      "Observation Methods",
      "Ethical Guidelines",
      "Psychology vs Psychiatry vs Counselling",
    ],
  },
  {
    title: "Week 1 · Module 3: Biological Basis of Behaviour",
    lessons: [
      "Brain Anatomy",
      "Nervous System",
      "Endocrine System",
      "Neurotransmitters",
      "Sleep & Consciousness",
      "Sensation & Perception",
    ],
  },
  {
    title: "Week 1 · Module 4: Learning & Memory",
    lessons: [
      "Classical Conditioning",
      "Operant Conditioning",
      "Observational Learning",
      "Memory Models",
      "Forgetting",
      "Behaviour Modification",
    ],
  },

  // ── Week 2 — Human Development, Personality & Social Behaviour ──────────
  {
    title: "Week 2 · Module 5: Human Development",
    lessons: [
      "Prenatal Development",
      "Childhood",
      "Adolescence",
      "Adulthood",
      "Aging",
      "Piaget",
      "Erikson",
      "Vygotsky",
    ],
  },
  {
    title: "Week 2 · Module 6: Personality Psychology",
    lessons: [
      "Freud",
      "Jung",
      "Adler",
      "Trait Theory",
      "Big Five",
      "Humanistic Theory",
      "Self-esteem",
      "Identity",
    ],
  },
  {
    title: "Week 2 · Module 7: Intelligence & Emotional Intelligence",
    lessons: [
      "IQ",
      "Gardner's Theory",
      "Sternberg Theory",
      "Emotional Intelligence",
      "Emotional Regulation",
      "Motivation",
      "Growth Mindset",
    ],
  },
  {
    title: "Week 2 · Module 8: Social Psychology",
    lessons: [
      "Attitudes",
      "Conformity",
      "Obedience",
      "Group Behaviour",
      "Leadership",
      "Aggression",
      "Relationships",
      "Communication",
    ],
  },

  // ── Week 3 — Clinical Psychology & Mental Health ────────────────────────
  {
    title: "Week 3 · Module 9: Positive Psychology",
    lessons: [
      "Happiness",
      "Mindfulness",
      "Gratitude",
      "Resilience",
      "Optimism",
      "Goal Setting",
      "Well-being",
    ],
  },
  {
    title: "Week 3 · Module 10: Mental Health",
    lessons: [
      "Stress",
      "Anxiety",
      "Depression",
      "Burnout",
      "Coping Strategies",
      "Suicide Awareness",
      "Psychological First Aid",
    ],
  },
  {
    title: "Week 3 · Module 11: Abnormal Psychology",
    lessons: [
      "Mood Disorders",
      "Anxiety Disorders",
      "OCD",
      "PTSD",
      "Schizophrenia",
      "ADHD",
      "Autism",
      "Personality Disorders",
      "Eating Disorders",
      "Substance Use Disorders",
    ],
  },
  {
    title: "Week 3 · Module 12: Counselling Skills",
    lessons: [
      "Rapport Building",
      "Active Listening",
      "Empathy",
      "Communication Skills",
      "Ethical Practice",
      "Confidentiality",
      "Referral Guidelines",
    ],
  },

  // ── Week 4 — Clinical Skills, Research & Career Readiness ───────────────
  {
    title: "Week 4 · Module 13: Psychological Assessments",
    lessons: [
      "Clinical Interview Basics",
      "Case History Taking",
      "Mental Status Examination",
      "Personality Assessments",
      "Anxiety & Depression Screening",
      "Behaviour Observation",
      "Assessment Interpretation Basics",
    ],
  },
  {
    title: "Week 4 · Module 14: Research Skills",
    lessons: [
      "Literature Review",
      "APA Referencing",
      "Google Scholar",
      "PubMed",
      "Research Proposal Basics",
      "Introduction to SPSS",
      "AI Tools in Psychology",
    ],
  },
  {
    title: "Week 4 · Module 15: Career Development",
    lessons: [
      "Clinical Psychology Pathway",
      "RCI Licensing Overview",
      "Higher Education Options",
      "Resume Building",
      "LinkedIn Profile Optimization",
      "Interview Preparation",
      "Freelancing & Entrepreneurship in Psychology",
    ],
  },
  {
    // The syllabus makes the capstone Module 16 itself; its "students choose one"
    // options are the lessons, typed as assignments since each is student output.
    title: "Week 4 · Module 16: Capstone Project (choose any one)",
    lessons: [
      a("Clinical Case Formulation"),
      a("Mental Health Awareness Campaign"),
      a("Research Proposal"),
      a("Literature Review"),
      a("Community Mental Health Project"),
      a("Psychological Assessment Report (using sample cases)"),
    ],
  },
];

runCurriculumSeed({
  label: "psych",
  tenantSlug: "stimuliiq",
  programSlug: "certified-psychology-program",
  curriculum: CURRICULUM,
});
