import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
const actor = { employeeNo: "000001", name: "系统管理员", subsidiaryId: "sub-1", isSuperAdmin: true, adminSubsidiaryIds: [] };
const companyId = "11111111-1111-4111-8111-111111111111";
const subsidiaryId = "22222222-2222-4222-8222-222222222222";

vi.mock("@/server/db", () => ({ pool: { query }, db: {} }));
vi.mock("@/server/auth", () => ({ getActor: async () => actor }));

import { PATCH, POST } from "./[...path]/route";

describe("subsidiary management", () => {
  beforeEach(() => {
    query.mockReset();
    actor.isSuperAdmin = true;
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  });

  it("lets a super administrator create a company", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const request = new NextRequest("http://localhost:3000/api/v1/companies", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "新企业" }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["companies"] }) });

    expect(response.status).toBe(201);
    expect((await response.json()).id).toBeTruthy();
  });

  it("rejects a subsidiary name already used in the company", async () => {
    query.mockResolvedValue({ rows: [{ id: "existing-sub" }], rowCount: 1 });
    const request = new NextRequest("http://localhost:3000/api/v1/subsidiaries", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ companyId, name: "  总部  " }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["subsidiaries"] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "DUPLICATE_SUBSIDIARY", message: "子公司名称已存在" } });
  });

  it("maps a concurrent database duplicate to a clear conflict", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce({ code: "23505", constraint: "subsidiaries_name_unique" });
    const request = new NextRequest("http://localhost:3000/api/v1/subsidiaries", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ companyId, name: "总部" }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["subsidiaries"] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "DUPLICATE_SUBSIDIARY", message: "子公司名称已存在" } });
  });

  it("lets a super administrator rename a company", async () => {
    query.mockResolvedValue({ rows: [{ id: companyId }], rowCount: 1 });
    const request = new NextRequest(`http://localhost:3000/api/v1/companies/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "新企业名称" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["companies", companyId] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects renaming a subsidiary to an existing name", async () => {
    query.mockResolvedValue({ rows: [{ id: "another-sub" }], rowCount: 1 });
    const request = new NextRequest(`http://localhost:3000/api/v1/subsidiaries/${subsidiaryId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "总部" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["subsidiaries", subsidiaryId] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "DUPLICATE_SUBSIDIARY", message: "子公司名称已存在" } });
  });

  it("does not deactivate a subsidiary while its company has an active cycle", async () => {
    query.mockResolvedValue({ rows: [{ id: "cycle-1" }], rowCount: 1 });
    const request = new NextRequest(`http://localhost:3000/api/v1/subsidiaries/${subsidiaryId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ status: "INACTIVE" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["subsidiaries", subsidiaryId] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "ACTIVE_CYCLE", message: "该子公司所属企业有进行中的考核周期，暂不能停用" } });
  });

  it("rejects organization changes from employees without super administrator privileges", async () => {
    actor.isSuperAdmin = false;
    const request = new NextRequest(`http://localhost:3000/api/v1/companies/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "越权修改" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["companies", companyId] }) });

    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});
