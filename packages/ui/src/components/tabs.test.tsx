import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  it("renders tablist/tab/tabpanel roles and shows the default panel", () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Student record sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content</TabsContent>
        <TabsContent value="payments">Payments content</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tablist", { name: "Student record sections" })).toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
    expect(screen.queryByText("Payments content")).not.toBeInTheDocument();
  });

  it("switches panels via keyboard arrow navigation", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content</TabsContent>
        <TabsContent value="payments">Payments content</TabsContent>
      </Tabs>,
    );

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    overviewTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Payments" })).toHaveFocus();
    expect(screen.getByText("Payments content")).toBeInTheDocument();
  });
});
