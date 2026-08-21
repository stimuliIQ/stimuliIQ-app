"use client";

/**
 * JobDetailView — one role's full advert at /careers/<slug>, plus the apply dialog.
 *
 * TWO APPLY BUTTONS, top and bottom, and that is deliberate rather than decorative. A
 * candidate who already knows they want the job should not have to read to the end to find
 * the button, and one who reads the whole advert should not have to scroll back up. Both
 * open the same dialog. A third, sticky bar was considered and dropped: it covers content on
 * exactly the small screens where content is scarcest.
 *
 * The client boundary is here rather than on the page, so the page itself stays a server
 * component that fetches, sets metadata and renders JSON-LD.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BriefcaseIcon,
  CalendarClockIcon,
  ClockIcon,
  MapPinIcon,
  RupeeIcon,
  UsersIcon,
} from "./icons";
import type { PublicJobOpening } from "@repo/types";
import { CareerApplyModal } from "./career-apply-modal";

const WORK_MODE_LABEL: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

/** "31 Aug 2026" — formatted in UTC so an inclusive DATE never slips a day. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ApplyButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-brand-500 px-8 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-testid={testId}
    >
      Apply for this role
    </button>
  );
}

function FactRow({ icon: Icon, label, value }: { icon: typeof MapPinIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand-500" />
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
        <dd className="mt-0.5 text-sm text-fg">{value}</dd>
      </div>
    </div>
  );
}

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2.5" role="list">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-relaxed text-fg-muted">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function JobDetailView({ opening }: { opening: PublicJobOpening }) {
  const [applyOpen, setApplyOpen] = useState(false);
  const open = () => setApplyOpen(true);

  const paragraphs = (opening.description ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6 md:py-14">
        <Link
          href="/careers"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4" />
          All open roles
        </Link>

        {/* ── Header + the TOP apply button ── */}
        <header className="mt-6 border-b border-border pb-8">
          {opening.department ? (
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{opening.department}</p>
          ) : null}
          <h1 className="mt-2 text-3xl font-bold text-fg sm:text-4xl">{opening.title}</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">{opening.summary}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ApplyButton onClick={open} testId="career-apply-top" />
            {opening.closesOn ? (
              <p className="text-sm text-fg-muted">
                Applications close <strong className="text-fg">{formatDate(opening.closesOn)}</strong>
              </p>
            ) : null}
          </div>
        </header>

        <div className="grid gap-10 py-8 md:grid-cols-[1fr_260px] md:gap-12">
          {/* ── The advert ── */}
          <div className="flex flex-col gap-8">
            {paragraphs.length > 0 ? (
              <section>
                <h2 className="text-lg font-bold text-fg">About the role</h2>
                <div className="mt-3 flex flex-col gap-3">
                  {paragraphs.map((para) => (
                    <p key={para} className="text-sm leading-relaxed text-fg-muted">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            <BulletSection title="What you'll do" items={opening.responsibilities} />
            <BulletSection title="What we're looking for" items={opening.requirements} />
          </div>

          {/* ── At-a-glance facts ── */}
          <aside className="md:sticky md:top-24 md:self-start">
            <dl className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
              <FactRow icon={MapPinIcon} label="Location" value={opening.location} />
              <FactRow icon={ClockIcon} label="Employment type" value={opening.employmentType} />
              {opening.workMode ? (
                <FactRow
                  icon={BriefcaseIcon}
                  label="Work mode"
                  value={WORK_MODE_LABEL[opening.workMode] ?? opening.workMode}
                />
              ) : null}
              {opening.experienceLevel ? (
                <FactRow icon={UsersIcon} label="Experience" value={opening.experienceLevel} />
              ) : null}
              {opening.compensationNote ? (
                <FactRow icon={RupeeIcon} label="Compensation" value={opening.compensationNote} />
              ) : null}
              {opening.openingsCount > 1 ? (
                <FactRow icon={UsersIcon} label="Positions open" value={String(opening.openingsCount)} />
              ) : null}
              {opening.closesOn ? (
                <FactRow icon={CalendarClockIcon} label="Applications close" value={formatDate(opening.closesOn)} />
              ) : null}
            </dl>
          </aside>
        </div>

        {/* ── The BOTTOM apply button ── */}
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-bold text-fg">Interested in this role?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
            Send us your resume and a short note. A real person reads every application, and you will hear back from us
            either way.
          </p>
          <div className="mt-5 flex justify-center">
            <ApplyButton onClick={open} testId="career-apply-bottom" />
          </div>
        </div>
      </div>

      <CareerApplyModal open={applyOpen} onOpenChange={setApplyOpen} opening={opening} />
    </>
  );
}

JobDetailView.displayName = "JobDetailView";
