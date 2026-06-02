import { describe, expect, it } from "vitest";
import {
  presetWorkgroupRoles,
  roleDefinitionsForWorkgroupRoles,
  roleDelegationPolicyAllowsTarget,
  type WorkgroupRole
} from "@agent-hub/core";

describe("workgroup role definition mapping", () => {
  it("lets custom PM-style coordinator roles initiate RoleCalls to known targets", () => {
    const analyst = presetWorkgroupRoles.find((role) => role.handle === "analyst");
    const researcher = presetWorkgroupRoles.find((role) => role.handle === "researcher");
    expect(analyst).toBeDefined();
    expect(researcher).toBeDefined();
    const pmRole: WorkgroupRole = {
      ...(analyst as WorkgroupRole),
      id: "custom:pm",
      handle: "pm",
      displayName: "PM",
      purpose: "Coordinate role delegation for local work.",
      capabilitySummary: "Planning, coordination, delegation.",
      persona: "Project manager who coordinates role calls.",
      defaultInstructions: "Delegate bounded work to the right role.",
      tags: ["coordination"],
      metadata: { source: "custom" }
    };

    const definitions = roleDefinitionsForWorkgroupRoles([
      pmRole,
      researcher as WorkgroupRole
    ]);
    const pmDefinition = definitions.find((role) => role.handle === "pm");

    expect(pmDefinition?.trustLevel).toBe("user_defined");
    expect(pmDefinition?.delegationPolicy).toEqual(expect.objectContaining({
      canInitiateRoleCalls: true,
      allowedTargetRoles: ["*"]
    }));
    expect(
      roleDelegationPolicyAllowsTarget(
        pmDefinition?.delegationPolicy ?? {
          canInitiateRoleCalls: false,
          allowedIntentTypes: []
        },
        researcher as WorkgroupRole
      )
    ).toBe(true);
  });
});
