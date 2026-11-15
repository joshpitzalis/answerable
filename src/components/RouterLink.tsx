import { Link } from "@tanstack/react-router";

// ponytail: href -> to adapter so Astryx nav items and tabs client-side navigate.
// Astryx passes href/className/style/children; TanStack Link wants `to`.
export const RouterLink = ({ href, ...rest }: { href?: string }) => (
  <Link to={href ?? "/"} {...rest} />
);
