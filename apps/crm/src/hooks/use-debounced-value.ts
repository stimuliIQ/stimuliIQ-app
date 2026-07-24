// Generic debounce hook — used by directory search inputs (Students/
// Faculty/Courses) to avoid firing a server request per keystroke
// (docs/03 §16 "debounced search").
import * as React from "react";

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
