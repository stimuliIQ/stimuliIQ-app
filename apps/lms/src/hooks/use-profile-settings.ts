// Profile & settings hook — Phase 9 Completion, T34 (docs/plans/phase-9-completion.md,
// docs/02 §7.16). Combines:
//   - Device-local appearance prefs (theme, default video quality, language) — see
//     ../lib/user-prefs.ts. Not server-backed (see that file's header for why).
//   - "Change password": the LMS has no logged-in "current password" change endpoint;
//     the only password-change path (B9, T28) is the tokenized email flow —
//     request -> emailed link -> confirm. We reuse it here by pre-filling the request
//     with the signed-in student's own email (from useMe()).
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { RequestPasswordResetResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  getStoredVideoQuality,
  setStoredVideoQuality,
  getStoredLanguage,
  setStoredLanguage,
  type ThemePreference,
  type VideoQualityPreference,
  type LanguagePreference,
} from "../lib/user-prefs";

export interface UseProfileSettingsResult {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  videoQuality: VideoQualityPreference;
  setVideoQuality: (quality: VideoQualityPreference) => void;
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
  requestPasswordReset: (email: string) => Promise<RequestPasswordResetResponse | null>;
  isRequestingReset: boolean;
  resetRequested: boolean;
  resetError: ApiError | null;
}

export function useProfileSettings(): UseProfileSettingsResult {
  // Hydration-safe: default to the SSR-safe fallback, then sync from
  // localStorage after mount (matches the blocking init script in layout.tsx
  // for theme; quality/language have no visible flash risk).
  const [theme, setThemeState] = React.useState<ThemePreference>("system");
  const [videoQuality, setVideoQualityState] = React.useState<VideoQualityPreference>("auto");
  const [language, setLanguageState] = React.useState<LanguagePreference>("en");

  React.useEffect(() => {
    setThemeState(getStoredTheme());
    setVideoQualityState(getStoredVideoQuality());
    setLanguageState(getStoredLanguage());
  }, []);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    setStoredTheme(next);
  }, []);

  // Re-apply on system color-scheme change while "system" is selected.
  React.useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const setVideoQuality = React.useCallback((next: VideoQualityPreference) => {
    setVideoQualityState(next);
    setStoredVideoQuality(next);
  }, []);

  const setLanguage = React.useCallback((next: LanguagePreference) => {
    setLanguageState(next);
    setStoredLanguage(next);
  }, []);

  const resetMutation = useMutation<RequestPasswordResetResponse, ApiError, string>({
    mutationFn: (email) => apiClient.auth.requestPasswordReset({ email }),
  });

  return {
    theme,
    setTheme,
    videoQuality,
    setVideoQuality,
    language,
    setLanguage,
    requestPasswordReset: (email) => resetMutation.mutateAsync(email).catch(() => null),
    isRequestingReset: resetMutation.isPending,
    resetRequested: resetMutation.isSuccess,
    resetError: resetMutation.error ?? null,
  };
}
