import { Tab, TabList } from "@astryxdesign/core/TabList";

import { RouterLink } from "#/components/RouterLink.tsx";

import type { Project } from "../domain";

const ignoreChange = () => {
  // TabList requires onChange, but each Tab is a link: the router navigates and
  // the selection follows the URL.
};

export const ProjectTabs = ({
  projects,
  currentSlug,
}: {
  projects: readonly Project[];
  currentSlug: string;
}) => (
  <TabList value={currentSlug} onChange={ignoreChange} hasDivider>
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
