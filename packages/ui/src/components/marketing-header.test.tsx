import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("MarketingHeader, rendering", () => {
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
// a11y, semantic structure
// ---------------------------------------------------------------------------

describe("MarketingHeader, a11y", () => {
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

describe("MarketingHeader, mega-menu keyboard", () => {
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

describe("MarketingHeader, mobile menu", () => {
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

describe("MarketingHeader, onBookSlotClick", () => {
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
 * the touch-device branch, so hover tests must opt in explicitly.
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

describe("MarketingHeader, mega-menu hover", () => {
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

  it("does NOT open on hover for touch devices, click still toggles it open", async () => {
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

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

describe("MarketingHeader, active nav state", () => {
  it("marks the plain link whose path is current with aria-current='page'", () => {
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        activePath="/about"
      />,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Blog" })).not.toHaveAttribute("aria-current");
  });

  it("keeps a section link active on its descendant pages", () => {
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        activePath="/blog/why-neurology"
      />,
    );
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the mega-menu trigger active when the current page is inside its panel", () => {
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        activePath="/programs/python"
      />,
    );
    expect(screen.getByRole("button", { name: /programs/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("marks the mega-menu trigger active via activeMatch, for pages not listed in the panel", () => {
    const items: NavItem[] = [
      { ...navItems[0]!, activeMatch: ["/programs"] },
      ...navItems.slice(1),
    ];
    render(
      <MarketingHeader
        logo={logo}
        navItems={items}
        bookSlotHref="/book"
        activePath="/programs"
      />,
    );
    // "/programs" is the catalog index, the panel only lists /programs/[slug] pages,
    // so without activeMatch this trigger would stay unlit.
    expect(screen.getByRole("button", { name: /programs/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("marks the current program inside an open mega-menu panel", async () => {
    const user = userEvent.setup();
    render(
      <MarketingHeader
        logo={logo}
        navItems={navItems}
        bookSlotHref="/book"
        activePath="/programs/python"
      />,
    );
    await user.click(screen.getByRole("button", { name: /programs/i }));

    expect(screen.getByRole("link", { name: /^python$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /data science/i })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks nothing active when activePath is omitted", () => {
    render(<MarketingHeader logo={logo} navItems={navItems} bookSlotHref="/book" />);
    for (const name of ["About", "Blog"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
    expect(screen.getByRole("button", { name: /programs/i })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

// ---------------------------------------------------------------------------
// Mega-menu row badges
// ---------------------------------------------------------------------------

const badgedNavItems: NavItem[] = [
  {
    label: "Courses",
    megaMenu: {
      sections: [
        {
          heading: "Clinical Research",
          items: [
            {
              label: "Clinical Research",
              href: "/programs/clinical-research",
              badge: { label: "New", style: { backgroundColor: "#16A34A", color: "#FFFFFF" } },
            },
            { label: "Neurology Workshop", href: "/programs/neurology" },
          ],
        },
      ],
    },
  },
];

describe("MarketingHeader, mega-menu badges", () => {
  it("renders the badge chip on a desktop row that carries one", async () => {
    const user = userEvent.setup();
    render(<MarketingHeader logo={logo} navItems={badgedNavItems} bookSlotHref="/book" />);
    await user.click(screen.getByRole("button", { name: /courses/i }));

    // The chip lives INSIDE the row's link, so the accessible name carries it, this is
    // what proves it renders next to the right program rather than as a stray node.
    expect(
      screen.getByRole("link", { name: /clinical research\s+new/i }),
    ).toBeInTheDocument();
  });

  it("applies the staff-picked colour as an inline style", async () => {
    const user = userEvent.setup();
    render(<MarketingHeader logo={logo} navItems={badgedNavItems} bookSlotHref="/book" />);
    await user.click(screen.getByRole("button", { name: /courses/i }));

    const chip = screen.getByText("New");
    expect(chip).toHaveStyle({ backgroundColor: "#16A34A", color: "#FFFFFF" });
  });

  it("renders no chip for a row without a badge", async () => {
    const user = userEvent.setup();
    render(<MarketingHeader logo={logo} navItems={badgedNavItems} bookSlotHref="/book" />);
    await user.click(screen.getByRole("button", { name: /courses/i }));

    expect(screen.getByRole("link", { name: "Neurology Workshop" })).toBeInTheDocument();
    // Exactly one chip in the panel, a missing badge must not fall back to a placeholder.
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("renders the badge in the mobile menu too", async () => {
    const user = userEvent.setup();
    render(<MarketingHeader logo={logo} navItems={badgedNavItems} bookSlotHref="/book" />);
    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));

    // Scoped to the dialog: the desktop trigger is also in the DOM under jsdom (it is
    // hidden by CSS, which jsdom does not apply), so an unscoped /courses/i match is
    // ambiguous and would not prove the MOBILE row rendered the chip.
    const dialog = within(screen.getByRole("dialog", { name: /navigation menu/i }));
    await user.click(dialog.getByRole("button", { name: /courses/i }));

    expect(dialog.getByText("New")).toHaveStyle({ backgroundColor: "#16A34A" });
  });
});
