/**
 * Shared building blocks for the legal pages (terms, privacy, refund policy) — one
 * clean, minimal card-based style instead of each page reinventing typography.
 */
import type { ReactNode } from "react";

export function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ContactLink({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </a>
  );
}

export function LegalHeader({
  title,
  lastUpdated,
  intro,
}: {
  title: string;
  lastUpdated: string;
  intro: ReactNode;
}) {
  return (
    <header className="border-b border-border pb-8">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-fg-subtle">Last updated: {lastUpdated}</p>
      <p className="mt-6 text-lg leading-relaxed text-fg-muted">{intro}</p>
    </header>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-xl font-bold text-fg">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

/** A list of short items, each with a checkmark badge — for enumerated points. */
export function LegalItemList({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ul role="list" className="mt-6 flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.title} className="flex gap-4 rounded-xl border border-border bg-card p-5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"
          >
            <CheckIcon />
          </span>
          <div>
            <h3 className="text-base font-semibold text-fg">{item.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LegalContactCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="mt-12 rounded-2xl border border-brand-100 bg-brand-50 p-6 md:p-8"
    >
      <h2 id={id} className="text-xl font-bold text-fg">
        {title}
      </h2>
      <p className="mt-3 text-base leading-relaxed text-fg-muted">{children}</p>
    </section>
  );
}
