// SSR-/jsdom-safe `matchMedia` subscription. Starts `false` and corrects itself in
// an effect, so a render that happens before the browser answers never *hides*
// anything — every layout decision in the shell is made in CSS (`lg:` variants) and
// only genuinely capability-based behaviour (does this device have a hover state?)
// reads this hook.
import * as React from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (event: MediaQueryListEvent): void => setMatches(event.matches);
    // Safari < 14 only has the deprecated addListener; guard so the CRM doesn't
    // hard-crash on an old iPad rather than merely losing hover-open.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, [query]);

  return matches;
}
