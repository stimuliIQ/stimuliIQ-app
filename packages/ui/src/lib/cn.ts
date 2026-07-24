import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Shadcn-style class merge helper: combines conditional classnames (clsx) and resolves
 * Tailwind class conflicts (tailwind-merge). Used by every primitive in this package.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
