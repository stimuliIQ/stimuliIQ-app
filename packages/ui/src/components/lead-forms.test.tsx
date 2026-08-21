import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LeadFormInline,
  ExitIntentModal,
  StickyLeadBar,
  type LeadFormValues,
} from "./lead-forms";
import { PHONE_PLACEHOLDER } from "../lib/phone";

// ---------------------------------------------------------------------------
// LeadFormInline
// ---------------------------------------------------------------------------

describe("LeadFormInline, rendering", () => {
  it("renders with default data-testid='lead-form-inline'", () => {
    render(<LeadFormInline />);
    expect(screen.getByTestId("lead-form-inline")).toBeInTheDocument();
  });

  it("renders heading when provided", () => {
    render(<LeadFormInline heading="Talk to a counsellor" />);
    expect(screen.getByRole("heading", { name: "Talk to a counsellor" })).toBeInTheDocument();
  });

  it("renders name, phone, email fields by default", () => {
    render(<LeadFormInline />);
    expect(screen.getByPlaceholderText("Your name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(PHONE_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
  });

  it("only renders requested fields", () => {
    render(<LeadFormInline fields={["phone"]} />);
    expect(screen.getByPlaceholderText(PHONE_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Your name")).not.toBeInTheDocument();
  });

  it("renders program select when field + options provided", () => {
    render(
      <LeadFormInline
        fields={["program"]}
        programOptions={[{ value: "python", label: "Python" }]}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Python" })).toBeInTheDocument();
  });

  it("renders course, college, and language fields when requested", () => {
    render(<LeadFormInline fields={["course", "college", "language"]} />);
    expect(screen.getByPlaceholderText("e.g. Full Stack Web Development")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. IIT Bombay")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. English, Hindi, Tamil")).toBeInTheDocument();
  });

  it("renders a fixed phone prefix when phonePrefix is set", () => {
    render(<LeadFormInline fields={["phone"]} phonePrefix="+91" />);
    expect(screen.getByText("+91")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(PHONE_PLACEHOLDER)).toBeInTheDocument();
  });

  it("forwards course/college/language values to onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: LeadFormValues) => void>();
    render(
      <LeadFormInline fields={["course", "college", "language"]} onSubmit={onSubmit} submitLabel="Submit" />,
    );
    await user.type(screen.getByPlaceholderText("e.g. Full Stack Web Development"), "MERN");
    await user.type(screen.getByPlaceholderText("e.g. IIT Bombay"), "NIT Trichy");
    await user.type(screen.getByPlaceholderText("e.g. English, Hindi, Tamil"), "Tamil");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const args = onSubmit.mock.calls[0]![0];
    expect(args).toMatchObject({ course: "MERN", college: "NIT Trichy", language: "Tamil" });
  });

  it("renders submit button", () => {
    render(<LeadFormInline submitLabel="Get a Callback" />);
    expect(screen.getByRole("button", { name: "Get a Callback" })).toBeInTheDocument();
  });

  it("renders captcha slot when provided", () => {
    render(
      <LeadFormInline captchaSlot={<div data-testid="captcha-widget">Captcha</div>} />,
    );
    expect(screen.getByTestId("captcha-widget")).toBeInTheDocument();
  });

  it("renders error message with role=alert", () => {
    render(<LeadFormInline errorMessage="Something went wrong." />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("renders success slot instead of form when provided", () => {
    render(
      <LeadFormInline successSlot={<div data-testid="success">Thank you!</div>} />,
    );
    expect(screen.getByTestId("success")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Honeypot field
// ---------------------------------------------------------------------------

describe("LeadFormInline, honeypot", () => {
  it("renders a visually-hidden honeypot field", () => {
    const { container } = render(<LeadFormInline />);
    const hp = container.querySelector("input[name='_hp_field']");
    expect(hp).toBeInTheDocument();
  });

  it("honeypot field has aria-hidden=true", () => {
    const { container } = render(<LeadFormInline />);
    const hpWrapper = container.querySelector("[aria-hidden='true']");
    expect(hpWrapper).toBeInTheDocument();
    const hp = hpWrapper?.querySelector("input[name='_hp_field']");
    expect(hp).toBeInTheDocument();
  });

  it("honeypot field has tabIndex=-1", () => {
    const { container } = render(<LeadFormInline />);
    const hp = container.querySelector("input[name='_hp_field']");
    expect(hp).toHaveAttribute("tabindex", "-1");
  });

  it("honeypot field has autoComplete=off", () => {
    const { container } = render(<LeadFormInline />);
    const hp = container.querySelector("input[name='_hp_field']");
    expect(hp).toHaveAttribute("autocomplete", "off");
  });

  it("onSubmit receives _hp_email in values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: LeadFormValues) => void>();
    render(
      <LeadFormInline
        fields={["phone"]}
        onSubmit={onSubmit}
        submitLabel="Submit"
      />,
    );
    await user.type(screen.getByPlaceholderText(PHONE_PLACEHOLDER), "9876543210");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalled();
    const args = onSubmit.mock.calls[0]![0];
    expect("_hp_email" in args).toBe(true);
    // Honeypot should be empty (no bot filled it)
    expect(args._hp_email).toBe("");
  });

  it("the phone field takes exactly 10 digits and drops anything typed past that", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: LeadFormValues) => void>();
    render(<LeadFormInline fields={["phone"]} onSubmit={onSubmit} submitLabel="Submit" />);

    const field = screen.getByPlaceholderText(PHONE_PLACEHOLDER) as HTMLInputElement;
    expect(field).toHaveAttribute("maxLength", "10");
    await user.type(field, "98765432109999");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit.mock.calls[0]![0].phone).toBe("9876543210");
  });

  it("the phone field strips non-digits (paste/autofill of a formatted number)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: LeadFormValues) => void>();
    render(<LeadFormInline fields={["phone"]} onSubmit={onSubmit} submitLabel="Submit" />);

    const field = screen.getByPlaceholderText(PHONE_PLACEHOLDER);
    await user.click(field);
    await user.paste("+91 98765 43210");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit.mock.calls[0]![0].phone).toBe("9876543210");
  });
});

// ---------------------------------------------------------------------------
// ExitIntentModal
// ---------------------------------------------------------------------------

describe("ExitIntentModal, rendering", () => {
  it("renders the dialog when open=true", () => {
    render(
      <ExitIntentModal
        open
        onOpenChange={() => {}}
        heading="Wait!"
      />,
    );
    expect(screen.getByTestId("exit-intent-modal")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(
      <ExitIntentModal
        open={false}
        onOpenChange={() => {}}
        heading="Wait!"
      />,
    );
    expect(screen.queryByTestId("exit-intent-modal")).not.toBeInTheDocument();
  });

  it("renders the close button", () => {
    render(
      <ExitIntentModal open onOpenChange={() => {}} heading="Wait!" />,
    );
    expect(screen.getByRole("button", { name: /close dialog/i })).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when close button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ExitIntentModal open onOpenChange={onOpenChange} heading="Wait!" />,
    );
    await user.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders honeypot inside the modal", () => {
    render(
      <ExitIntentModal open onOpenChange={() => {}} heading="Wait!" />,
    );
    // Radix Portal renders outside the React root container, use document.body
    expect(document.body.querySelector("input[name='_hp_field']")).toBeInTheDocument();
  });

  it("renders captcha slot inside the modal", () => {
    render(
      <ExitIntentModal
        open
        onOpenChange={() => {}}
        heading="Wait!"
        captchaSlot={<div data-testid="modal-captcha">widget</div>}
      />,
    );
    expect(screen.getByTestId("modal-captcha")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StickyLeadBar
// ---------------------------------------------------------------------------

describe("StickyLeadBar, rendering", () => {
  it("renders with default data-testid='sticky-lead-bar'", () => {
    render(<StickyLeadBar />);
    expect(screen.getByTestId("sticky-lead-bar")).toBeInTheDocument();
  });

  it("renders a phone input", () => {
    render(<StickyLeadBar placeholder="Enter phone" />);
    expect(screen.getByPlaceholderText("Enter phone")).toBeInTheDocument();
  });

  it("renders submit button", () => {
    render(<StickyLeadBar submitLabel="Call Me" />);
    expect(screen.getByRole("button", { name: "Call Me" })).toBeInTheDocument();
  });

  it("renders honeypot field", () => {
    const { container } = render(<StickyLeadBar />);
    expect(container.querySelector("input[name='_hp_field']")).toBeInTheDocument();
  });

  it("calls onSubmit with phone and _hp_email values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(v: LeadFormValues) => void>();
    render(
      <StickyLeadBar
        placeholder="Phone"
        submitLabel="Submit"
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText("Phone"), "9998887776");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalled();
    const args = onSubmit.mock.calls[0]![0];
    expect(args.phone).toBe("9998887776");
    expect(args._hp_email).toBe("");
  });

  it("renders success slot instead of form when provided", () => {
    render(
      <StickyLeadBar successSlot={<div data-testid="bar-success">Submitted!</div>} />,
    );
    expect(screen.getByTestId("bar-success")).toBeInTheDocument();
  });

  it("renders captcha slot", () => {
    render(
      <StickyLeadBar captchaSlot={<div data-testid="bar-captcha">captcha</div>} />,
    );
    expect(screen.getByTestId("bar-captcha")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("Lead forms, a11y", () => {
  it("LeadFormInline submit button is ≥44px", () => {
    render(<LeadFormInline submitLabel="Submit" />);
    const btn = screen.getByRole("button", { name: "Submit" });
    expect(btn.className).toContain("min-h-[44px]");
  });

  it("StickyLeadBar submit button is ≥44px", () => {
    render(<StickyLeadBar submitLabel="Go" />);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.className).toContain("min-h-[44px]");
  });

  it("ExitIntentModal is a Radix dialog (focus-trapped)", () => {
    render(<ExitIntentModal open onOpenChange={() => {}} />);
    // Radix renders role=dialog
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });
});
