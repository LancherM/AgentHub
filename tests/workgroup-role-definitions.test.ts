import { describe, expect, it } from "vitest";
import {
  presetWorkgroupRoles,
  roleDefinitionsForWorkgroupRoles,
  roleDelegationPolicyAllowsIntentTarget,
  roleDelegationPolicyAllowsLineStartTarget,
  roleDelegationPolicyAllowsTarget,
  type WorkgroupRole
} from "@agent-hub/core";

describe("workgroup role definition mapping", () => {
  it("keeps preset RoleCall initiators aligned with the line-start protocol", () => {
    const definitions = roleDefinitionsForWorkgroupRoles(presetWorkgroupRoles);
    const rolesByHandle = new Map(
      presetWorkgroupRoles.map((role) => [role.handle, role as WorkgroupRole])
    );
    const initiators = definitions.filter(
      (role) => role.delegationPolicy.canInitiateRoleCalls
    );

    expect(initiators.map((role) => role.handle).sort()).toEqual([
      "analyst",
      "engineer",
      "operator"
    ]);

    for (const definition of initiators) {
      expect(definition.delegationPolicy.allowedIntentTypes).toContain("delegate");
      for (const targetHandle of definition.delegationPolicy.allowedTargetRoles ?? []) {
        if (targetHandle === "*") {
          continue;
        }
        const target = rolesByHandle.get(targetHandle);
        expect(target).toBeDefined();
        expect(
          roleDelegationPolicyAllowsLineStartTarget(
            definition.delegationPolicy,
            target as WorkgroupRole
          )
        ).toBe(true);
      }
    }
  });

  it("allows preset engineers to delegate line-start RoleCalls to reviewer and operator", () => {
    const engineer = presetWorkgroupRoles.find((role) => role.handle === "engineer");
    const reviewer = presetWorkgroupRoles.find((role) => role.handle === "reviewer");
    const operator = presetWorkgroupRoles.find((role) => role.handle === "operator");
    expect(engineer).toBeDefined();
    expect(reviewer).toBeDefined();
    expect(operator).toBeDefined();

    const definitions = roleDefinitionsForWorkgroupRoles([
      engineer as WorkgroupRole,
      reviewer as WorkgroupRole,
      operator as WorkgroupRole
    ]);
    const engineerDefinition = definitions.find((role) => role.handle === "engineer");

    expect(engineerDefinition?.delegationPolicy).toEqual(expect.objectContaining({
      canInitiateRoleCalls: true,
      allowedIntentTypes: expect.arrayContaining(["delegate"]),
      allowedTargetRoles: ["reviewer", "operator"]
    }));
    expect(
      roleDelegationPolicyAllowsLineStartTarget(
        engineerDefinition?.delegationPolicy ?? {
          canInitiateRoleCalls: false,
          allowedIntentTypes: []
        },
        reviewer as WorkgroupRole
      )
    ).toBe(true);
    expect(
      roleDelegationPolicyAllowsLineStartTarget(
        engineerDefinition?.delegationPolicy ?? {
          canInitiateRoleCalls: false,
          allowedIntentTypes: []
        },
        operator as WorkgroupRole
      )
    ).toBe(true);
  });

  it("does not treat target permission as line-start permission without delegate intent", () => {
    const reviewer = presetWorkgroupRoles.find((role) => role.handle === "reviewer");
    expect(reviewer).toBeDefined();
    const policy = {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["request_review" as const],
      allowedTargetRoles: ["reviewer"]
    };

    expect(roleDelegationPolicyAllowsTarget(policy, reviewer as WorkgroupRole))
      .toBe(true);
    expect(
      roleDelegationPolicyAllowsIntentTarget(
        policy,
        reviewer as WorkgroupRole,
        "request_review"
      )
    ).toBe(true);
    expect(
      roleDelegationPolicyAllowsLineStartTarget(policy, reviewer as WorkgroupRole)
    ).toBe(false);
  });

  it("requires custom PM roles to configure RoleCall delegation explicitly", () => {
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

    const defaultDefinitions = roleDefinitionsForWorkgroupRoles([
      pmRole,
      researcher as WorkgroupRole
    ]);
    const defaultPmDefinition = defaultDefinitions.find((role) => role.handle === "pm");
    expect(defaultPmDefinition?.delegationPolicy).toEqual(expect.objectContaining({
      canInitiateRoleCalls: false
    }));

    const definitions = roleDefinitionsForWorkgroupRoles([
      {
        ...pmRole,
        delegationPolicy: {
          canInitiateRoleCalls: true,
          allowedIntentTypes: ["delegate"],
          allowedTargetRoles: ["researcher"]
        }
      },
      researcher as WorkgroupRole
    ]);
    const pmDefinition = definitions.find((role) => role.handle === "pm");

    expect(pmDefinition?.trustLevel).toBe("user_defined");
    expect(pmDefinition?.delegationPolicy).toEqual(expect.objectContaining({
      canInitiateRoleCalls: true,
      allowedTargetRoles: ["researcher"]
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
