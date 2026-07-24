/**
 * mdx-components.tsx — required by @next/mdx when using the App Router.
 *
 * This file must be in the root of the app directory (or at the project root).
 * It allows customising the HTML elements rendered by MDX files globally.
 *
 * Per @next/mdx docs: https://nextjs.org/docs/app/building-your-application/configuring/mdx
 *
 * We use the default pass-through (no overrides) so standard MDX HTML elements
 * render with Tailwind's `prose` class applied by the parent article element.
 * If custom components are needed (e.g., a custom CodeBlock, Callout), add them here.
 */
import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Use all default MDX components (standard HTML elements).
    // Override specific elements here if needed, e.g.:
    //   h1: ({ children }) => <h1 className="text-3xl font-bold">{children}</h1>,
    ...components,
  };
}
