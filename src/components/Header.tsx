import { TopNav, TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { Link, useRouterState } from "@tanstack/react-router";

import ThemeToggle from "./ThemeToggle";

// ponytail: href -> to adapter so Astryx nav items client-side navigate.
// Astryx passes href/className/style/children; TanStack Link wants `to`.
const RouterLink = ({ href, ...rest }: { href?: string }) => (
  <Link to={href ?? "/"} {...rest} />
);

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
            isSelected={pathname === "/"}
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
