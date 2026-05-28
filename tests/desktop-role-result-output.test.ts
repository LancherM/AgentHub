import { describe, expect, it } from "vitest";
import { roleResultSummaryFromText } from "../apps/desktop/src/lib/role-result-output";

describe("roleResultSummaryFromText", () => {
  it("extracts summary from exact RoleResult JSON", () => {
    expect(
      roleResultSummaryFromText(JSON.stringify({
        summary: "3",
        evidence: ["RoleCall.task states: output 3."]
      }))
    ).toBe("3");
  });

  it("extracts the last embedded RoleResult summary from mixed assistant text", () => {
    expect(
      roleResultSummaryFromText([
        "Using the provided Agent Hub role brief.",
        JSON.stringify({
          summary: "3",
          evidence: ["RoleCall.task states: output 3."]
        })
      ].join("\n"))
    ).toBe("3");
  });
});
