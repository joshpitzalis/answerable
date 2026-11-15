import { TopNav, TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { useRouterState } from "@tanstack/react-router";

import { RouterLink } from "./RouterLink";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <TopNav
      className="px-4"
      label="Main navigation"
      heading={
        <TopNavHeading heading="Answerable" headingHref="/" as={RouterLink} />
      }
      startContent={
        <>
          <TopNavItem
            label="Home"
            href="/"
            as={RouterLink}
            isSelected={pathname !== "/search"}
          />
          <TopNavItem
            label="Search"
            href="/search"
            as={RouterLink}
            isSelected={pathname === "/search"}
          />
        </>
      }
      endContent={<ThemeToggle />}
    />
  );
}
