import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query, clientQuery, release, connect } = vi.hoisted(() => { const clientQuery = vi.fn(); const release = vi.fn(); return { query: vi.fn(), clientQuery, release, connect: vi.fn(async () => ({ query: clientQuery, release })) }; });
const actor: { employeeNo: string; name: string; subsidiaryId: string; isSuperAdmin: boolean; adminSubsidiaryIds: string[] } = { employeeNo: "000001", name: "系统管理员", subsidiaryId: "sub-1", isSuperAdmin: true, adminSubsidiaryIds: [] };
const companyId = "11111111-1111-4111-8111-111111111111";
const subsidiaryId = "22222222-2222-4222-8222-222222222222";

vi.mock("@/server/db", () => ({ pool: { query, connect }, db: {} }));
vi.mock("@/server/auth", () => ({ getActor: async () => actor, mayAdmin: (value: { isSuperAdmin: boolean; adminSubsidiaryIds: string[] }, targetSubsidiaryId: string) => value.isSuperAdmin || value.adminSubsidiaryIds.includes(targetSubsidiaryId), verifyPassword: async () => true, hashPassword: async () => "hash", revokeAllSessions: vi.fn(), createSession: vi.fn() }));

import { DELETE, PATCH, POST } from "./[...path]/route";

describe("subsidiary management", () => {
  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset(); release.mockReset(); connect.mockClear();
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

  it("creates a global cycle without requiring a company id", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const request = new NextRequest("http://localhost:3000/api/v1/cycles", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "2026 年度考核" }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["cycles"] }) });

    expect(response.status).toBe(201);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into cycles"), expect.arrayContaining(["2026 年度考核"]));
  });

  it("lets a super administrator edit a draft cycle's name and schedule", async () => {
    query.mockResolvedValue({ rows: [{ id: companyId }], rowCount: 1 });
    const request = new NextRequest(`http://localhost:3000/api/v1/cycles/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "2026 年度考核（修订）", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-12-31T23:59:59.000Z" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["cycles", companyId] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update cycles set name=$2"), expect.arrayContaining([companyId, "2026 年度考核（修订）"]));
  });

  it("rejects assessment approval while its cycle is still a draft", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ key: "review-key" }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: companyId, employeeNo: "E1001", status: "SUBMITTED", version: 3, subsidiaryId, cycleStatus: "DRAFT" }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/admin/assessments/${companyId}/approve`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": "review-key" }, body: JSON.stringify({ version: 3 }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["admin", "assessments", companyId, "approve"] }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CYCLE_LOCKED");
  });

  it("freezes each configured scorer weight when approval creates score tasks", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ key: "weighted-approval-key" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, cycleId: companyId, employeeNo: "E1001", status: "SUBMITTED", version: 3, subsidiaryId, cycleStatus: "ACTIVE" }] })
      .mockResolvedValueOnce({ rows: [{ scorerEmployeeNo: "E1002", weight: "60.00" }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/admin/assessments/${companyId}/approve`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": "weighted-approval-key" }, body: JSON.stringify({ version: 3 }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["admin", "assessments", companyId, "approve"] }) });

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into score_tasks"), expect.arrayContaining([companyId, "E1002", "60.00"]));
  });

  it("rejects saving a score while its cycle is still a draft", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: companyId, assessmentId: companyId, status: "PENDING", version: 2, assessmentStatus: "SCORING", cycleStatus: "DRAFT" }] }).mockResolvedValueOnce({ rows: [] });
    const request = new NextRequest(`http://localhost:3000/api/v1/scorer/tasks/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ version: 2, items: [] }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["scorer", "tasks", companyId] }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("LOCKED");
  });

  it("lets an employee store an incomplete indicator tree while its cycle is a draft", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, employeeNo: actor.employeeNo, status: "DRAFT", version: 1, subsidiaryId, cycleStatus: "DRAFT" }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/my/assessments/${companyId}/tree`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, nodes: [
        { nodeCode: "R", parentCode: null, name: "年度考核", description: "", scoringRule: "", maxScore: 100, sortOrder: 0 },
        { nodeCode: "L1", parentCode: "R", name: "", description: "", scoringRule: "", maxScore: 0, sortOrder: 1 },
      ] }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["my", "assessments", companyId, "tree"] }) });

    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(2);
  });

  it("rejects self-evaluation content while its cycle is still a draft", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, employeeNo: actor.employeeNo, status: "DRAFT", version: 1, subsidiaryId, cycleStatus: "DRAFT" }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/my/assessments/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, values: [] }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["my", "assessments", companyId] }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("LOCKED");
  });

  it("rejects changes to an already submitted score", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const leafId = "33333333-3333-4333-8333-333333333333";
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, assessmentId: companyId, status: "SUBMITTED", version: 2, assessmentStatus: "COMPLETED", cycleStatus: "ACTIVE" }] })
      .mockResolvedValueOnce({ rows: [{ id: leafId, maxScore: 100 }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/scorer/tasks/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ version: 2, items: [{ nodeId: leafId, score: 88, comment: "修订评分" }] }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["scorer", "tasks", companyId] }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("LOCKED");
  });

  it("lets a super administrator stop a cycle", async () => {
    query.mockResolvedValue({ rows: [{ id: companyId }], rowCount: 1 });
    const request = new NextRequest(`http://localhost:3000/api/v1/cycles/${companyId}/stop`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": "stop-cycle-key" }, body: "{}",
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["cycles", companyId, "stop"] }) });

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("STOPPED");
  });

  it("lets an administrator update an employee's editable profile fields", async () => {
    actor.isSuperAdmin = false;
    actor.adminSubsidiaryIds = [subsidiaryId];
    query.mockResolvedValueOnce({ rows: [{ subsidiaryId, companyId }] }).mockResolvedValueOnce({ rows: [{ id: subsidiaryId, companyId }] }).mockResolvedValueOnce({ rows: [{ employeeNo: "E1001" }] });
    const request = new NextRequest("http://localhost:3000/api/v1/employees/E1001", {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ subsidiaryId, department: "人力资源部", position: "专员", phone: "13800000000", status: "ACTIVE" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["employees", "E1001"] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects moving an employee with assessment history to another company", async () => {
    query.mockResolvedValueOnce({ rows: [{ subsidiaryId, companyId: "source-company" }] })
      .mockResolvedValueOnce({ rows: [{ id: subsidiaryId, companyId: "target-company" }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] });
    const request = new NextRequest("http://localhost:3000/api/v1/employees/E1001", {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ subsidiaryId, department: "人力资源部", position: "专员", phone: "", status: "ACTIVE" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ path: ["employees", "E1001"] }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("EMPLOYEE_HISTORY_EXISTS");
  });

  it("requires the exact acknowledgement before permanently deleting an employee", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/employees/E1001", {
      method: "DELETE", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "确认删除" }),
    });

    const response = await DELETE(request, { params: Promise.resolve({ path: ["employees", "E1001"] }) });

    expect(response.status).toBe(422);
    expect(query).not.toHaveBeenCalled();
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

  it("does not save a structure template without at least one editable column", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/templates", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "空结构模板", layout: { columns: [], rows: [] } }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["templates"] }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION");
    expect(query).not.toHaveBeenCalled();
  });

  it("lets an administrator update a saved template structure", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: companyId, companyId }] }).mockResolvedValueOnce({ rows: [{ id: companyId }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/templates/${companyId}`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "人事专员模板", layout: { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [{ id: "row-1", label: "" }] } }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["templates", companyId] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("update indicator_templates set name"), expect.arrayContaining([companyId, "人事专员模板"]));
  });

  it("accepts a draft tree preset with empty indicator fields", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const request = new NextRequest("http://localhost:3000/api/v1/templates", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ companyId, name: "空白树模板", layout: { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [], tree: [{ name: "", description: "", scoringRule: "", maxScore: null, children: [] }] } }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["templates"] }) });

    expect(response.status).toBe(201);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into indicator_templates"), expect.any(Array));
  });

  it("rejects publishing a cycle whose saved indicator tree does not total 100", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ key: "publish-key" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, status: "DRAFT" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { assessmentId: "assessment-1", employeeNo: "E1001", nodeCode: "R", parentCode: null, name: "年度考核", maxScore: 100 },
        { assessmentId: "assessment-1", employeeNo: "E1001", nodeCode: "L1", parentCode: "R", name: "一级指标", maxScore: 90 },
      ] });
    const request = new NextRequest(`http://localhost:3000/api/v1/cycles/${companyId}/publish`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": "publish-key" }, body: "{}",
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["cycles", companyId, "publish"] }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_INDICATOR_TREES");
  });

  it("accepts legacy 32-character assessment ids at the tree endpoint", async () => {
    const legacyAssessmentId = "84c64e3af8ad066a76a63c8698a33af9";
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: legacyAssessmentId, employeeNo: actor.employeeNo, status: "DRAFT", version: 1, subsidiaryId, cycleStatus: "DRAFT" }] });
    const request = new NextRequest(`http://localhost:3000/api/v1/my/assessments/${legacyAssessmentId}/tree`, {
      method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, nodes: [{ nodeCode: "R", parentCode: null, name: "年度考核", description: "", scoringRule: "", maxScore: 100, sortOrder: 0 }, { nodeCode: "L1", parentCode: "R", name: "一级指标", description: "", scoringRule: "", maxScore: 90, sortOrder: 1 }] }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ path: ["my", "assessments", legacyAssessmentId, "tree"] }) });

    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(2);
  });

  it("replaces a draft assessment with a structure-only template without requiring indicator content or a score", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: companyId, companyId, layout: { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [] } }] });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, status: "DRAFT" }] })
      .mockResolvedValueOnce({ rows: [{ companyId, layout: { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [] } }] })
      .mockResolvedValueOnce({ rows: [{ employeeNo: "E1001", subsidiaryId, companyId }] })
      .mockResolvedValueOnce({ rows: [{ id: "existing-draft", employeeNo: "E1001", status: "DRAFT" }] });
    const request = new NextRequest("http://localhost:3000/api/v1/template-assignments", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ cycleId: companyId, templateId: companyId, employeeNos: ["E1001"] }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["template-assignments"] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assigned: 1 });
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("delete from indicator_nodes"), ["existing-draft"]);
  });

  it("creates a visible draft assessment and preserves a blank template tree when first matched", async () => {
    const layout = { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [], tree: [{ name: "", description: "", scoringRule: "", maxScore: null, children: [{ name: "", description: "", scoringRule: "", maxScore: null }] }] };
    query.mockResolvedValueOnce({ rows: [{ id: companyId, companyId, layout }] });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, status: "DRAFT" }] })
      .mockResolvedValueOnce({ rows: [{ companyId, layout }] })
      .mockResolvedValueOnce({ rows: [{ employeeNo: "E1001", subsidiaryId, companyId }] })
      .mockResolvedValueOnce({ rows: [] });
    const request = new NextRequest("http://localhost:3000/api/v1/template-assignments", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ cycleId: companyId, templateId: companyId, employeeNos: ["E1001"] }) });

    const response = await POST(request, { params: Promise.resolve({ path: ["template-assignments"] }) });

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into assessments"), expect.any(Array));
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into indicator_nodes"), expect.arrayContaining([expect.any(String), expect.any(String), expect.anything(), expect.any(String), "待填写一级指标 1"]));
  });

  it("rolls back the complete template match when rebuilding an assessment fails", async () => {
    const layout = { columns: [{ id: "indicator", label: "指标名称", type: "TEXT", required: true }], rows: [] };
    query.mockResolvedValueOnce({ rows: [{ id: companyId, companyId, layout }] });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: companyId, status: "DRAFT" }] })
      .mockResolvedValueOnce({ rows: [{ companyId, layout }] })
      .mockResolvedValueOnce({ rows: [{ employeeNo: "E1001", subsidiaryId, companyId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error("indicator insert failed"));
    const request = new NextRequest("http://localhost:3000/api/v1/template-assignments", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ cycleId: companyId, templateId: companyId, employeeNos: ["E1001"] }),
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request, { params: Promise.resolve({ path: ["template-assignments"] }) });
    consoleError.mockRestore();

    expect(response.status).toBe(500);
    expect(clientQuery).toHaveBeenCalledWith("rollback");
    expect(clientQuery).not.toHaveBeenCalledWith("commit");
  });

  it("rejects a scorer relationship that assigns an employee to score themselves", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/scorer-assignments", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ cycleId: companyId, employeeNo: "E1001", scorerEmployeeNos: ["E1001"] }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["scorer-assignments"] }) });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "INVALID_SCORERS", message: "打分人不可重复或为本人" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects scorer weights that do not total 100 before querying employees", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/scorer-assignments", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ cycleId: companyId, employeeNo: "E1001", scorerAssignments: [{ scorerEmployeeNo: "E1002", weight: 60 }, { scorerEmployeeNo: "E1003", weight: 30 }] }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["scorer-assignments"] }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_SCORER_WEIGHTS");
    expect(query).not.toHaveBeenCalled();
  });

  it("allows scorer setup after a structure template is matched, before indicator content is filled", async () => {
    query.mockImplementationOnce((sql: string) => { expect(sql).toContain("assessments"); return Promise.resolve({ rows: [{ subsidiaryId, companyId }] }); }).mockResolvedValueOnce({ rows: [{ employeeNo: "E1002", subsidiaryId, companyId }] });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: "draft-assessment" }], rowCount: 1 });
    const request = new NextRequest("http://localhost:3000/api/v1/scorer-assignments", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ cycleId: companyId, employeeNo: "E1001", scorerEmployeeNos: ["E1002"] }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["scorer-assignments"] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("insert into scorer_assignments"), expect.arrayContaining(["E1001", "E1002", 100]));
  });
});
