import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FormField } from "./form-field";

describe("FormField", () => {
  it("wires label, control id, and helper text via aria-describedby", () => {
    render(
      <FormField label="College" helperText="As per ID proof">
        {(fieldProps) => <input {...fieldProps} name="college" />}
      </FormField>,
    );

    const input = screen.getByLabelText("College");
    const helper = screen.getByText("As per ID proof");
    expect(input.getAttribute("aria-describedby")).toContain(helper.id);
  });

  it("marks the control invalid and links the error as an alert", () => {
    render(
      <FormField label="College" error="College is required">
        {(fieldProps) => <input {...fieldProps} name="college" />}
      </FormField>,
    );

    const input = screen.getByLabelText("College");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("College is required");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });
});
