import { Tab, TabList } from "@astryxdesign/core/TabList";

import { RouterLink } from "#/components/RouterLink.tsx";

import type { Project } from "../domain";

// The tabs are links: the router navigates, so the selection follows the URL.
const noop = () => {
  // Navigation is the link's job.
};

/** One tab per Project, each a link to that Project's route. */
export const ProjectTabs = ({
  projects,
  currentSlug,
}: {
  projects: readonly Project[];
  currentSlug: string;
}) => (
  <TabList value={currentSlug} onChange={noop} hasDivider>
    {projects.map((project) => (
      <Tab
        key={project.slug}
        value={project.slug}
        label={project.label}
        href={`/${project.slug}`}
        as={RouterLink}
      />
    ))}
  </TabList>
);
