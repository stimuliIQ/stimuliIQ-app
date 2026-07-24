/**
 * BrainShowcaseBlock — page-builder block #11 (docs/specs/phase-10-page-builder.md
 * §"11. brain_showcase"). No fields; renders `brain-showcase.tsx` unmodified, per spec
 * ("a zero-config positional placeholder ... its rendered content never changes").
 */
import { BrainShowcase } from "../../home/brain-showcase";

export function BrainShowcaseBlock(): React.JSX.Element {
  return <BrainShowcase />;
}
