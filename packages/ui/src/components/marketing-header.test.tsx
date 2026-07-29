import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MarketingHeader, type NavItem } from "./marketing-header";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const navItems: NavItem[] = [
  {
    label: "Programs",
    megaMenu: {
      sections: [
        {
          heading: "Data",
          items: [
            { label: "Python", href: "/programs/python" },
            { label: "Data Science", href: "/programs/data-science" },
          ],
        },
      ],
    },
  },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
];

const logo = <img src="/logo.svg" alt="StimuliiQ" />;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("MarketingHeader — rendering", () => {
  it("renders with default data-testid='marketing-header'", () => {
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
      />,
    );
    expect(screen.getByTestId("marketing-header")).toBeInTheDocument();
  });

  it("renders the logo", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    expect(screen.getByAltText("StimuliiQ")).toBeInTheDocument();
  });

  it("renders the primary nav with a11y label", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
  });

  it("renders plain link nav items", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    // "About" is a plain link
    const aboutLinks = screen.getAllByRole("link", { name: "About" });
    expect(aboutLinks.length).toBeGreaterThan(0);
  });

  it("renders the persistent 'Book Free Slot' CTA link", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const ctas = screen.getAllByRole("link", { name: /book free slot/i });
    expect(ctas.length).toBeGreaterThan(0);
    expect(ctas[0]).toHaveAttribute("href", "/book");
  });

  it("renders the hamburger menu button (mobile)", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    expect(
      screen.getByRole("button", { name: /open navigation menu/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y — semantic structure
// ---------------------------------------------------------------------------

describe("MarketingHeader — a11y", () => {
  it("renders inside a <header> element", () => {
    const { container } = render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    expect(container.querySelector("header")).toBeInTheDocument();
  });

  it("mega-menu trigger has aria-haspopup", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
  });

  it("mega-menu trigger has aria-expanded=false when closed", () => {
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

// ---------------------------------------------------------------------------
// Mega-menu keyboard: open / close / Escape
// ---------------------------------------------------------------------------

describe("MarketingHeader — mega-menu keyboard", () => {
  it("opens mega-menu on click and shows aria-expanded=true", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("shows mega-menu items after opening", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    await user.click(trigger);
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("Data Science")).toBeInTheDocument();
  });

  it("closes mega-menu on Escape", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes mega-menu on second click of trigger (toggle)", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const trigger = screen.getByRole("button", { name: /programs/i });
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

// ---------------------------------------------------------------------------
// Mobile menu
// ---------------------------------------------------------------------------

describe("MarketingHeader — mobile menu", () => {
  it("opens mobile menu on hamburger click", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    const hamburger = screen.getByRole("button", { name: /open navigation menu/i });
    await user.click(hamburger);
    // Mobile nav dialog appears
    expect(screen.getByRole("dialog", { name: /navigation menu/i })).toBeInTheDocument();
  });

  it("closes mobile menu on close button click", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />,
    );
    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    const closeBtn = screen.getByRole("button", { name: /close navigation menu/i });
    await user.click(closeBtn);
    expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();
  });

  it("mobile menu renders the Book Free Slot CTA", async () => {
    const user = userEvent.setup();
    const onBookSlotClick = vi.fn();
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        onBookSlotClick={onBookSlotClick}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    const bookLinks = screen.getAllByRole("link", { name: /book free slot/i });
    expect(bookLinks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Book slot callback
// ---------------------------------------------------------------------------

describe("MarketingHeader — onBookSlotClick", () => {
  it("calls onBookSlotClick when the desktop CTA is clicked", async () => {
    const user = userEvent.setup();
    const onBookSlotClick = vi.fn();
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        onBookSlotClick={onBookSlotClick}
      />,
    );
    const ctas = screen.getAllByRole("link", { name: /book free slot/i });
    await user.click(ctas[0]!);
    expect(onBookSlotClick).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mega-menu hover-to-open
// ---------------------------------------------------------------------------

/**
 * Force `matchMedia("(hover: hover) and (pointer: fine)")` to a known answer for one
 * test. The shared setup stubs matchMedia to always report `matches: false`, which is
 * the touch-device branch — so hover tests must opt in explicitly.
 */
function setHoverCapable(hoverCapable: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) =>
      ({
        matches: hoverCapable && query.includes("hover: hover"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
  return () => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: original });
  };
}

describe("MarketingHeader — mega-menu hover", () => {
  it("opens the mega-menu on hover when the device supports hover", async () => {
    const restore = setHoverCapable(true);
    try {
      const user = userEvent.setup();
      render(<MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />);
      const trigger = screen.getByRole("button", { name: /programs/i });
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      await user.hover(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: /python/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("closes the mega-menu when the pointer leaves the header", async () => {
    const restore = setHoverCapable(true);
    try {
      const user = userEvent.setup();
      render(<MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />);
      const trigger = screen.getByRole("button", { name: /programs/i });
      await user.hover(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");

      await user.unhover(screen.getByTestId("marketing-header"));

      expect(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      restore();
    }
  });

  it("does NOT open on hover for touch devices — click still toggles it open", async () => {
    const restore = setHoverCapable(false);
    try {
      const user = userEvent.setup();
      render(<MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />);
      const trigger = screen.getByRole("button", { name: /programs/i });

      await user.hover(trigger);
      // A tap fires mouseenter then click; if hover opened the panel here, the click
      // below would toggle it straight back shut and the menu would be unopenable.
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    } finally {
      restore();
    }
  });
});
