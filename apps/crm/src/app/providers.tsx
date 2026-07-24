// App-root providers: TanStack Query + @repo/ui's ToastProvider. Mounted once
// in main.tsx so every component can use useQuery/useToast.
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import { ApiError } from "@repo/api-client";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // A 4xx (401 expired session, 403 missing permission, 404) is a
            // settled answer, not a transient failure — retrying it 3× just
            // spams the console/network log with identical failing requests
            // (seen with /crm/mentors 403 for roles without `mentors.view`).
            // Only genuine 5xx/network blips are worth retrying. Mirrors the
            // per-hook pattern documented in use-mentor-dashboard.ts, applied
            // as the client-wide default.
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
              failureCount < 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
