import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CertTemplateCanvas, type CertTemplateField } from "./cert-template-canvas";

const FIELDS: CertTemplateField[] = [
  { id: "f1", type: "text", label: "Student name", x: 50, y: 40, placeholder: "{{student_name}}" },
  { id: "f2", type: "image", label: "Signature", x: 70, y: 80 },
];

describe("CertTemplateCanvas", () => {
  it("shows an empty state when there is no background", () => {
    render(<CertTemplateCanvas backgroundUrl={undefined} fields={[]} />);
    expect(screen.getByText("No background uploaded")).toBeInTheDocument();
  });

  it("renders the background image when provided", () => {
    render(<CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={[]} />);
    expect(screen.getByAltText("Certificate background")).toHaveAttribute("src", "/cert-bg.png");
  });

  it("renders each field as a positioned, labelled marker", () => {
    render(<CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} />);
    expect(screen.getByTestId("cert-field-f1")).toBeInTheDocument();
    expect(screen.getByTestId("cert-field-f2")).toBeInTheDocument();
    expect(screen.getByText("{{student_name}}")).toBeInTheDocument();
  });

  it("lists fields in the accessible side panel", () => {
    render(<CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} />);
    expect(screen.getByTestId("cert-field-list-item-f1")).toHaveTextContent("Student name");
    expect(screen.getByTestId("cert-field-list-item-f2")).toHaveTextContent("Signature");
  });

  it("calls onSelectField when a field marker is clicked", async () => {
    const user = userEvent.setup();
    const onSelectField = vi.fn();
    render(<CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} onSelectField={onSelectField} />);
    await user.click(screen.getByTestId("cert-field-f1"));
    expect(onSelectField).toHaveBeenCalledWith("f1");
  });

  it("calls onSelectField when a field is chosen from the side list", async () => {
    const user = userEvent.setup();
    const onSelectField = vi.fn();
    render(<CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} onSelectField={onSelectField} />);
    await user.click(screen.getByTestId("cert-field-list-item-f2"));
    expect(onSelectField).toHaveBeenCalledWith("f2");
  });

  it("shows the precise X/Y position inputs for the selected field", () => {
    render(
      <CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} selectedFieldId="f1" onFieldsChange={vi.fn()} />,
    );
    expect(screen.getByTestId("cert-field-x-input")).toHaveValue(50);
    expect(screen.getByTestId("cert-field-y-input")).toHaveValue(40);
  });

  it("updates field position via the numeric X input", () => {
    const onFieldsChange = vi.fn();
    render(
      <CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} selectedFieldId="f1" onFieldsChange={onFieldsChange} />,
    );
    const xInput = screen.getByTestId("cert-field-x-input");
    fireEvent.change(xInput, { target: { value: "60" } });
    expect(onFieldsChange).toHaveBeenCalled();
    const lastCall = onFieldsChange.mock.calls.at(-1)![0] as CertTemplateField[];
    const updatedField = lastCall.find((f) => f.id === "f1");
    expect(updatedField?.x).toBe(60);
  });

  it("nudges the selected field's position with arrow keys", async () => {
    const user = userEvent.setup();
    const onFieldsChange = vi.fn();
    render(
      <CertTemplateCanvas
        backgroundUrl="/cert-bg.png"
        fields={FIELDS}
        selectedFieldId="f1"
        onFieldsChange={onFieldsChange}
        nudgeStep={1}
      />,
    );
    const marker = screen.getByTestId("cert-field-f1");
    marker.focus();
    await user.keyboard("{ArrowRight}");
    expect(onFieldsChange).toHaveBeenCalled();
    const lastCall = onFieldsChange.mock.calls.at(-1)![0] as CertTemplateField[];
    const updatedField = lastCall.find((f) => f.id === "f1");
    expect(updatedField?.x).toBe(51);
  });

  it("does not nudge when readOnly", async () => {
    const user = userEvent.setup();
    const onFieldsChange = vi.fn();
    render(
      <CertTemplateCanvas backgroundUrl="/cert-bg.png" fields={FIELDS} selectedFieldId="f1" onFieldsChange={onFieldsChange} readOnly />,
    );
    const marker = screen.getByTestId("cert-field-f1");
    marker.focus();
    await user.keyboard("{ArrowRight}");
    expect(onFieldsChange).not.toHaveBeenCalled();
  });

  it("shows a loading skeleton", () => {
    render(<CertTemplateCanvas fields={[]} loading />);
    expect(screen.getByLabelText("Loading template")).toBeInTheDocument();
  });
});
