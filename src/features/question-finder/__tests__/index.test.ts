import { describe, expect, it } from "vitest";

import {
  activateHarvest,
  listQuestions,
  parseProject,
  refreshHarvest,
} from "../index";
import { STUB_PROJECTS } from "../lib/projects.utils";

describe("Harvest transport", () => {
  it("keeps state-changing Harvest requests on POST and saved reads on GET", () => {
    expect(activateHarvest.method).toBe("POST");
    expect(refreshHarvest.method).toBe("POST");
    expect(listQuestions.method).toBe("GET");
  });
});

describe(parseProject, () => {
  it("resolves a known slug to its Project", () => {
    expect(parseProject("effect", STUB_PROJECTS)).toMatchObject({
      id: "effect",
      label: "Effect",
      slug: "effect",
    });
  });

  it("keeps identity when a Project's label and route change", () => {
    const renamed = {
      ...STUB_PROJECTS[0],
      label: "Renamed library",
      slug: "renamed-library",
    };

    expect(parseProject("renamed-library", [renamed]).id).toBe("effect");
    expect(() => parseProject("effect", [renamed])).toThrow(
      /unknown project/iu
    );
  });

  it("refuses duplicate Project IDs even when their slugs differ", () => {
    const [project] = STUB_PROJECTS;
    expect(() =>
      parseProject("effect", [
        { ...project, id: "stable" },
        { ...project, id: "stable", slug: "renamed" },
      ])
    ).toThrow(/duplicate project id/iu);
  });

  it.each(["", "   "])("refuses an empty Project ID: %j", (id) => {
    expect(() => parseProject("effect", [{ ...STUB_PROJECTS[0], id }])).toThrow(
      /empty project id/iu
    );
  });

  it("refuses an unknown slug", () => {
    expect(() => parseProject("nope", STUB_PROJECTS)).toThrow(
      /unknown project: nope/iu
    );
  });

  it("refuses a slug that is not in the list it is given", () => {
    expect(() => parseProject("effect", [])).toThrow(
      /unknown project: effect/iu
    );
  });
});
