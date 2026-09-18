import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ pool: { query: async () => ({ rows: [] }) } }));

import { loadState } from "./state";

describe("loadState", () => {
  it("provides an empty management workspace to a super administrator without subsidiaries", async () => {
    const state = await loadState({ employeeNo: "000001", name: "系统管理员", subsidiaryId: "none", isSuperAdmin: true, adminSubsidiaryIds: [] });

    expect(state.admin).toEqual({ employees: [], assessments: [], nodes: [], assignments: [], progress: [] });
    expect(state.super).not.toBeNull();
  });
});
