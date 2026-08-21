// Offline fallback — Wave 5b PWA.
//
// Precached by the service worker (public/sw.js) and served for navigations when
// the network is unavailable. Kept dependency-light and self-contained so it
// renders from cache without any runtime data fetch.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline | stimuliiq",
};

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-700/20"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l22 22" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-fg">You&apos;re offline</h1>
      <p className="text-sm text-fg-muted">
        We couldn&apos;t reach the network. Your progress is saved automatically, so
        reconnect to keep learning. Videos and live data need a connection.
      </p>
      <a
        href="/"
        className="mt-2 inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try again
      </a>
    </main>
  );
}
