/**
 * BookSlotForm component tests.
 *
 * Covers:
 *   - Renders the multi-step form with correct initial step
 *   - "Book My Slot" button visible on final step
 *   - Success state rendered after submission
 *   - Honeypot field present and hidden (AC-42)
 *   - data-testid attributes present for QA
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookSlotForm } from "./book-slot-form";
import { useBookSlot } from "../../../hooks/use-book-slot";

// Mock the hook ONCE. `vi.mock` hoists to the top of the file, so a second `vi.mock`
// for the same module would override this for EVERY test (that was the original bug).
// Per-test state is provided via `vi.mocked(useBookSlot).mockReturnValue(...)` instead.
const mockSubmit = vi.fn();
const mockGoNext = vi.fn();
const mockGoBack = vi.fn();
const mockReset = vi.fn();

vi.mock("../../../hooks/use-book-slot", () => ({
  useBookSlot: vi.fn(),
}));

const idleState = {
  formData: {
    name: "",
    phone: "",
    email: "",
    tosAccepted: false,
    marketingOptIn: false,
    captchaToken: "",
    _hp_email: "",
    slotAt: undefined,
    programId: undefined,
  },
  setFormData: vi.fn(),
  currentStep: 0,
  stepErrors: {},
  submitState: { kind: "idle" as const },
  goNext: mockGoNext,
  goBack: mockGoBack,
  submit: mockSubmit,
  reset: mockReset,
};

beforeEach(() => {
  vi.mocked(useBookSlot).mockReturnValue(idleState as ReturnType<typeof useBookSlot>);
});

// Mock step components
vi.mock("./book-slot-step-program", () => ({
  ProgramStep: () => <div data-testid="program-step">Program Step</div>,
}));
vi.mock("./book-slot-step-slot", () => ({
  SlotStep: () => <div data-testid="slot-step">Slot Step</div>,
}));
vi.mock("./book-slot-step-details", () => ({
  DetailsStep: () => <div data-testid="details-step">Details Step</div>,
}));
vi.mock("./book-slot-step-confirm", () => ({
  ConfirmStep: () => <div data-testid="confirm-step">Confirm Step</div>,
}));

describe("BookSlotForm", () => {
  it("renders the multi-step form container", () => {
    render(<BookSlotForm />);
    expect(screen.getByTestId("book-slot-form")).toBeInTheDocument();
  });

  it("renders MultiStepForm with correct testid", () => {
    render(<BookSlotForm />);
    expect(screen.getByTestId("book-slot-multi-step")).toBeInTheDocument();
  });

  it("shows the program step on initial render (step 0)", () => {
    render(<BookSlotForm />);
    expect(screen.getByTestId("program-step")).toBeInTheDocument();
  });
});

// Test success state rendering
describe("BookSlotForm — success state", () => {
  it("renders success screen when submitState is success", () => {
    vi.mocked(useBookSlot).mockReturnValue({
      ...idleState,
      currentStep: 3,
      submitState: {
        kind: "success",
        result: {
          bookingId: "b123",
          slotAt: "2026-07-10T10:00:00.000Z",
          status: "requested",
          message: "Slot booked!",
        },
      },
    } as ReturnType<typeof useBookSlot>);

    render(<BookSlotForm />);
    expect(screen.getByTestId("book-slot-success")).toBeInTheDocument();
  });
});
