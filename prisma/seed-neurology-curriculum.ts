// prisma/seed-neurology-curriculum.ts — curriculum for the Certified Neurology Program.
//
//     pnpm db:seed:neurology            # apply
//     pnpm db:seed:neurology --dry-run  # report what would change, commit nothing
//
// Data only — the writer (idempotent, never-deletes, transactional) lives in
// ./curriculum-seed.ts. See that file for the safety properties and the week/title
// convention. This file is the source of truth for the syllabus: edit here and re-run,
// don't hand-edit rows in Supabase.
//
// SHAPE NOTE: this syllabus has a Practical Activities block in weeks 1–3 (week 4 has
// none) and a standalone capstone section — 20 modules in total.

import { a, q, runCurriculumSeed, type ModuleSpec } from "./curriculum-seed";

const CURRICULUM: ModuleSpec[] = [
  // ── Week 1 — Foundations of Clinical Neurology ───────────────────────────
  {
    title: "Week 1 · Module 1: Introduction to Neurology",
    lessons: [
      "Evolution of Neurology",
      "Scope of Clinical Neurology",
      "Neurologist vs Neurosurgeon",
      "Common Neurological Presentations",
      "Evidence-Based Neurological Practice",
    ],
  },
  {
    title: "Week 1 · Module 2: Neuroanatomy Essentials",
    lessons: [
      "Central Nervous System",
      "Peripheral Nervous System",
      "Brain Lobes & Their Functions",
      "Brainstem",
      "Cerebellum",
      "Spinal Cord",
      "Cranial Nerves",
      "Meninges",
      "Blood Supply to the Brain",
    ],
  },
  {
    title: "Week 1 · Module 3: Neurophysiology",
    lessons: [
      "Neurons & Synapses",
      "Action Potential",
      "Neurotransmitters",
      "Sensory Pathways",
      "Motor Pathways",
      "Reflex Arc",
      "Autonomic Nervous System",
      "Neuroplasticity",
    ],
  },
  {
    title: "Week 1 · Module 4: Clinical Neurological Symptoms",
    lessons: [
      "Weakness",
      "Numbness",
      "Tremors",
      "Headache",
      "Seizures",
      "Vertigo",
      "Syncope",
      "Altered Consciousness",
    ],
  },
  {
    title: "Week 1 · Practical Activities",
    lessons: [
      a("Brain Anatomy Lab (3D Models)"),
      a("Cranial Nerve Identification"),
      a("Symptom Localization Exercise"),
      q("Neuroanatomy Quiz"),
    ],
  },

  // ── Week 2 — Neurological Disorders ─────────────────────────────────────
  {
    title: "Week 2 · Module 5: Cerebrovascular Disorders",
    lessons: [
      "Stroke",
      "Transient Ischemic Attack (TIA)",
      "Hemorrhagic Stroke",
      "Stroke Management",
      "Stroke Rehabilitation",
    ],
  },
  {
    title: "Week 2 · Module 6: Epilepsy & Seizure Disorders",
    lessons: [
      "Types of Seizures",
      "Epilepsy Classification",
      "EEG Basics",
      "Status Epilepticus",
      "First Aid for Seizures",
    ],
  },
  {
    title: "Week 2 · Module 7: Neurodegenerative Disorders",
    lessons: [
      "Parkinson's Disease",
      "Alzheimer's Disease",
      "Huntington's Disease",
      "Dementia",
      "Amyotrophic Lateral Sclerosis (ALS)",
    ],
  },
  {
    title: "Week 2 · Module 8: Neuroimmunology & Neuromuscular Disorders",
    lessons: [
      "Multiple Sclerosis",
      "Myasthenia Gravis",
      "Guillain–Barré Syndrome",
      "Peripheral Neuropathies",
      "Muscular Dystrophies",
    ],
  },
  {
    title: "Week 2 · Practical Activities",
    lessons: [
      a("MRI Case Interpretation"),
      a("Clinical Case Discussions"),
      a("Differential Diagnosis Exercise"),
      q("Disorder Recognition Quiz"),
    ],
  },

  // ── Week 3 — Neurological Examination & Diagnostics ─────────────────────
  {
    title: "Week 3 · Module 9: Neurological Examination",
    lessons: [
      "History Taking",
      "Higher Mental Functions",
      "Cranial Nerve Examination",
      "Motor Examination",
      "Sensory Examination",
      "Reflex Examination",
      "Cerebellar Examination",
      "Gait Assessment",
    ],
  },
  {
    title: "Week 3 · Module 10: Neurodiagnostic Tools",
    lessons: [
      "CT Scan",
      "MRI",
      "Functional MRI (fMRI)",
      "Electroencephalography (EEG)",
      "Electromyography (EMG)",
      "Nerve Conduction Studies (NCS)",
      "Lumbar Puncture",
      "Cerebrospinal Fluid (CSF) Analysis",
    ],
  },
  {
    title: "Week 3 · Module 11: Clinical Decision Making",
    lessons: [
      "Neurological Red Flags",
      "Localization of Lesions",
      "Differential Diagnosis",
      "Emergency Neurology",
      "Referral Guidelines",
    ],
  },
  {
    title: "Week 3 · Module 12: Neuropharmacology",
    lessons: [
      "Antiepileptic Drugs",
      "Parkinson's Medications",
      "Stroke Medications",
      "Corticosteroids",
      "Neuromuscular Drugs",
      "Drug Safety",
      "Adverse Drug Effects",
    ],
  },
  {
    title: "Week 3 · Practical Activities",
    lessons: [
      a("Neurological Examination Demonstration"),
      a("MRI & CT Interpretation Workshop"),
      a("EEG Reading Basics"),
      q("Clinical Case-Based Quiz"),
    ],
  },

  // ── Week 4 — Advanced Neurology, Research & Career Development ──────────
  {
    title: "Week 4 · Module 13: Neurorehabilitation",
    lessons: [
      "Physiotherapy in Neurology",
      "Occupational Therapy",
      "Speech Therapy",
      "Cognitive Rehabilitation",
      "Patient Counselling",
      "Caregiver Education",
    ],
  },
  {
    title: "Week 4 · Module 14: Emerging Trends in Neurology",
    lessons: [
      "Artificial Intelligence in Neurology",
      "Brain-Computer Interfaces",
      "Neuroprosthetics",
      "Deep Brain Stimulation",
      "Personalized Neurology",
      "Stem Cell Therapy",
      "Tele-Neurology",
    ],
  },
  {
    title: "Week 4 · Module 15: Neurology Research",
    lessons: [
      "Clinical Research Basics",
      "Reading Research Papers",
      "PubMed Literature Search",
      "Case Report Writing",
      "Research Ethics",
      "AI Tools for Medical Research",
    ],
  },
  {
    title: "Week 4 · Module 16: Career Development",
    lessons: [
      "DM Neurology Career Pathway",
      "Careers in Neuroscience",
      "Clinical Research Opportunities",
      "Medical Writing",
      "Higher Education Opportunities",
      "Resume & LinkedIn Building",
    ],
  },

  // ── Capstone ────────────────────────────────────────────────────────────
  {
    title: "Capstone Project (choose any one)",
    lessons: [
      a("Stroke Case Analysis"),
      a("Parkinson's Disease Case Review"),
      a("EEG Interpretation Presentation"),
      a("Neurorehabilitation Plan"),
      a("Neurological Research Proposal"),
      a("Neurology Awareness Campaign"),
    ],
  },
];

runCurriculumSeed({
  label: "neuro",
  tenantSlug: "stimuliiq",
  programSlug: "certified-neurology-program",
  curriculum: CURRICULUM,
});
