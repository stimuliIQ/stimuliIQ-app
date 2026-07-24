import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  it("renders header/content/footer composition with semantic heading", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Full-Stack Internship</CardTitle>
          <CardDescription>12-week cohort</CardDescription>
        </CardHeader>
        <CardContent>Details about the program.</CardContent>
        <CardFooter>
          <span>Footer action</span>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Full-Stack Internship" })).toBeInTheDocument();
    expect(screen.getByText("12-week cohort")).toBeInTheDocument();
    expect(screen.getByText("Details about the program.")).toBeInTheDocument();
    expect(screen.getByText("Footer action")).toBeInTheDocument();
  });
});
