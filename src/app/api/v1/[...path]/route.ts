import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import ExcelJS from "exceljs";
import { createSession, destroySession, getActor, hashPassword, mayAdmin, verifyPassword, type Actor } from "@/server/auth";
import { pool } from "@/server/db";
import { loadState } from "@/server/state";
import { isAllowedOrigin } from "@/server/origin";
import { approveAssessment, configureAssessment, HttpError, publishCycle, returnAssessment, saveScore, saveSelf, submitScore, submitSelf } from "@/server/workflows";
import { buildIndicatorNodes, validateIndicatorHierarchy, type IndicatorGroupDraft } from "@/lib/indicator-hierarchy";

export const runtime = "nodejs";
const text = z.string().trim().min(1).max(200);
const id = z.string().uuid();
const employeeNo = z.string().trim().min(1).max(40);
const newPassword = z.string().min(10).max(128).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "密码需同时包含字母和数字");
const score = z.number().finite().min(0).max(100);
const node = z.object({ nodeCode: text, parentCode: text.nullable(), name: text, description: z.string().max(2000).default(""), scoringRule: z.string().max(2000).default(""), maxScore: score, sortOrder: z.number().int().default(0) });
const employeeImportRow = z.object({ employeeNo, name: text, subsidiaryName: text, department: text, position: z.string().max(200), phone: z.string().max(40), initialPassword: newPassword });

function response(data: unknown, status = 200) { return NextResponse.json(data, { status }); }
function failure(error: unknown) {
  if (error instanceof HttpError) return response({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError) return response({ error: { code: "VALIDATION", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") } }, 422);
  if (error && typeof error === "object" && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "subsidiaries_name_unique") return response({ error: { code: "DUPLICATE_SUBSIDIARY", message: "子公司名称已存在" } }, 409);
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return response({ error: { code: "DUPLICATE", message: "工号或名称已存在，请检查后重试" } }, 409);
  if (error && typeof error === "object" && "code" in error && error.code === "23503") return response({ error: { code: "INVALID_REFERENCE", message: "引用的员工、企业或子公司不存在" } }, 422);
  console.error(error);
  return response({ error: { code: "INTERNAL", message: "服务器处理失败，请稍后重试" } }, 500);
}
async function body(req: NextRequest) { return await req.json().catch(() => { throw new HttpError(400, "INVALID_JSON", "请求体不是有效 JSON"); }); }
function guardOrigin(req: NextRequest) {
  if (!process.env.APP_ORIGIN) throw new HttpError(500, "APP_ORIGIN_NOT_CONFIGURED", "服务未配置对外访问地址");
  if (!isAllowedOrigin(req.headers.get("origin"), process.env.APP_ORIGIN)) throw new HttpError(403, "ORIGIN", "禁止跨站请求");
}
async function actorRequired(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new HttpError(401, "UNAUTHORIZED", "请先登录");
  return actor;
}
function superRequired(actor: Actor) { if (!actor.isSuperAdmin) throw new HttpError(403, "FORBIDDEN", "仅超级管理员可操作"); }
function adminRequired(actor: Actor) { if (!actor.isSuperAdmin && !actor.adminSubsidiaryIds.length) throw new HttpError(403, "FORBIDDEN", "仅管理员可操作"); }
async function companyForSubsidiary(subsidiaryId: string) {
  const result = await pool.query("select company_id from subsidiaries where id=$1", [subsidiaryId]);
  if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "子公司不存在");
  return result.rows[0].company_id as string;
}
async function createEmployee(actor: Actor, value: unknown) {
  const data = z.object({ employeeNo, subsidiaryId: id, name: text, department: text, position: z.string().max(200).default(""), phone: z.string().max(40).default(""), initialPassword: newPassword }).parse(value);
  if (!mayAdmin(actor, data.subsidiaryId)) throw new HttpError(403, "FORBIDDEN", "无权管理该子公司");
  await companyForSubsidiary(data.subsidiaryId);
  const passwordHash = await hashPassword(data.initialPassword);
  await pool.query("insert into employees (employee_no,subsidiary_id,name,department,position,phone,password_hash) values ($1,$2,$3,$4,$5,$6,$7)", [data.employeeNo, data.subsidiaryId, data.name, data.department, data.position, data.phone, passwordHash]);
  return { employeeNo: data.employeeNo };
}
async function excelResponse(rows: (string | number | null)[][], name: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据");
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`, "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await ctx.params).path.join("/");
    const actor = await actorRequired();
    if (path === "state") return response(await loadState(actor));
    if (path === "templates/employees" || path === "templates/indicators" || path === "templates/scorers") {
      adminRequired(actor);
      if (path === "templates/employees") return excelResponse([["工号", "姓名", "公司名称", "部门", "职位", "手机号", "初始密码"], ["E1001", "张三", "请填公司名称", "人力资源部", "人事专员", "", "至少10位密码"]], "员工导入模板");
      if (path === "templates/indicators") return excelResponse([["一级指标", "一级考核内容", "一级计分规则", "一级分值", "二级指标", "二级考核内容", "二级计分规则", "二级分值"], ["人力资源基础业务规范开展", "完成基础人力资源工作", "按完成质量与时效评分", 25, "", "", "", ""], ["人才引进及任务服务支持", "完成招聘及服务支持", "按任务完成情况评分", 30, "", "", "", ""], ["岗位绩效考核协同及业务能力提升", "协同完成考核工作", "按协同质量评分", 45, "招聘计划执行", "完成招聘计划", "按招聘达成率评分", 25], ["岗位绩效考核协同及业务能力提升", "", "", 45, "考核协同", "完成绩效协同", "按协同及时性评分", 20]], "指标导入模板");
      return excelResponse([["被打分人工号", "打分人工号"], ["E1001", "E1002"], ["E1001", "E1003"]], "打分人关系模板");
    }
    if (path === "export/employees" || path === "export/scorers" || path === "export/indicators") {
      adminRequired(actor);
      const scope = actor.isSuperAdmin ? null : actor.adminSubsidiaryIds;
      if (path === "export/employees") {
        const result = await pool.query(`select e.employee_no,e.name,s.name as subsidiary_name,e.department,e.position,e.phone,e.status from employees e join subsidiaries s on s.id=e.subsidiary_id where $1::text[] is null or e.subsidiary_id=any($1::text[]) order by s.name,e.department,e.name`, [scope]);
        return excelResponse([["工号", "姓名", "公司", "部门", "职位", "手机号", "状态"], ...result.rows.map((r) => [r.employee_no, r.name, r.subsidiary_name, r.department, r.position, r.phone, r.status])], "员工名单");
      }
      const cycleId = id.parse(req.nextUrl.searchParams.get("cycleId"));
      if (path === "export/scorers") {
        const result = await pool.query(`select sa.employee_no,sa.scorer_employee_no,sa.status from scorer_assignments sa join employees e on e.employee_no=sa.employee_no where sa.cycle_id=$1 and ($2::text[] is null or e.subsidiary_id=any($2::text[])) order by sa.employee_no,sa.scorer_employee_no`, [cycleId, scope]);
        return excelResponse([["被打分人工号", "打分人工号", "状态"], ...result.rows.map((r) => [r.employee_no, r.scorer_employee_no, r.status])], "打分人关系");
      }
      const result = await pool.query(`select a.employee_no,n.node_code,p.node_code as parent_code,n.name,n.description,n.scoring_rule,n.max_score,n.sort_order from indicator_nodes n join assessments a on a.id=n.assessment_id join employees e on e.employee_no=a.employee_no left join indicator_nodes p on p.id=n.parent_id where a.cycle_id=$1 and ($2::text[] is null or e.subsidiary_id=any($2::text[])) order by a.employee_no,n.sort_order`, [cycleId, scope]);
      return excelResponse([["工号", "指标编码", "父指标编码", "名称", "考核内容", "计分规则", "分值", "排序"], ...result.rows.map((r) => [r.employee_no, r.node_code, r.parent_code, r.name, r.description, r.scoring_rule, Number(r.max_score), r.sort_order])], "指标配置");
    }
    if (path === "export/final" || path === "export/detail") {
      const cycleId = id.parse(req.nextUrl.searchParams.get("cycleId"));
      const cycle = await pool.query("select company_id from cycles where id=$1", [cycleId]);
      if (!cycle.rows[0]) throw new HttpError(404, "NOT_FOUND", "考核周期不存在");
      if (path === "export/detail") {
        superRequired(actor);
        const result = await pool.query(`select a.employee_no, e.name as employee_name, s.name as subsidiary_name, t.scorer_employee_no, scorer.name as scorer_name, n.node_code, n.name as indicator_name, i.score, i.comment, a.final_score
          from assessments a join employees e on e.employee_no=a.employee_no join subsidiaries s on s.id=e.subsidiary_id
          join score_tasks t on t.assessment_id=a.id join employees scorer on scorer.employee_no=t.scorer_employee_no
          join score_items i on i.task_id=t.id join indicator_nodes n on n.id=i.node_id where a.cycle_id=$1 order by s.name,e.name,scorer.name,n.sort_order`, [cycleId]);
        return excelResponse([["工号", "姓名", "子公司", "打分人工号", "打分人", "指标编码", "指标", "得分", "评语", "最终总分"], ...result.rows.map((r) => [r.employee_no, r.employee_name, r.subsidiary_name, r.scorer_employee_no, r.scorer_name, r.node_code, r.indicator_name, Number(r.score), r.comment, r.final_score === null ? null : Number(r.final_score)])], "考核评分明细");
      }
      adminRequired(actor);
      const scope = actor.isSuperAdmin ? null : actor.adminSubsidiaryIds;
      const pending = await pool.query(`select e.employee_no from employees e join subsidiaries s on s.id=e.subsidiary_id
        left join assessments a on a.employee_no=e.employee_no and a.cycle_id=$1
        where s.company_id=$2 and e.status='ACTIVE' and ($3::text[] is null or e.subsidiary_id=any($3::text[]))
        and (a.id is null or a.status<>'COMPLETED') limit 1`, [cycleId, cycle.rows[0].company_id, scope]);
      if (pending.rows.length) throw new HttpError(409, "NOT_COMPLETE", "授权范围内所有人员完成打分后才可导出");
      const result = await pool.query(`select a.employee_no, e.name, s.name as subsidiary_name, c.name as cycle_name, a.status, a.final_score, a.completed_at from assessments a
        join employees e on e.employee_no=a.employee_no join subsidiaries s on s.id=e.subsidiary_id
        join cycles c on c.id=a.cycle_id
        where a.cycle_id=$1 and ($2::text[] is null or e.subsidiary_id=any($2::text[])) order by s.name,e.name`, [cycleId, scope]);
      if (!result.rows.length || result.rows.some((r) => r.status !== "COMPLETED")) throw new HttpError(409, "NOT_COMPLETE", "授权范围内所有人员完成打分后才可导出");
      return excelResponse([["工号", "姓名", "子公司", "考核周期", "最终总分", "完成时间"], ...result.rows.map((r) => [r.employee_no, r.name, r.subsidiary_name, r.cycle_name, Number(r.final_score), r.completed_at?.toISOString() ?? ""])], "考核最终总分");
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    guardOrigin(req);
    const path = (await ctx.params).path.join("/");
    if (path === "auth/login") {
      const data = z.object({ employeeNo, password: z.string().min(1) }).parse(await body(req));
      const result = await pool.query("select password_hash, status from employees where employee_no=$1", [data.employeeNo]);
      if (!result.rows[0] || result.rows[0].status !== "ACTIVE" || !(await verifyPassword(data.password, result.rows[0].password_hash))) throw new HttpError(401, "LOGIN_FAILED", "工号或密码错误");
      await createSession(data.employeeNo);
      return response({ ok: true });
    }
    const actor = await actorRequired();
    if (path === "auth/logout") { await destroySession(); return response({ ok: true }); }
    if (path === "auth/change-password") {
      const data = z.object({ currentPassword: z.string().min(1), newPassword: newPassword.min(12) }).parse(await body(req));
      const current = await pool.query("select password_hash from employees where employee_no=$1", [actor.employeeNo]);
      if (!current.rows[0] || !(await verifyPassword(data.currentPassword, current.rows[0].password_hash))) throw new HttpError(403, "PASSWORD", "当前密码错误");
      await pool.query("update employees set password_hash=$2 where employee_no=$1", [actor.employeeNo, await hashPassword(data.newPassword)]);
      await destroySession();
      return response({ ok: true });
    }
    if (path === "companies") {
      superRequired(actor);
      const data = z.object({ name: text }).parse(await body(req));
      const newId = randomUUID();
      await pool.query("insert into companies (id,name) values ($1,$2)", [newId, data.name]);
      return response({ id: newId }, 201);
    }
    if (path === "subsidiaries") {
      superRequired(actor);
      const data = z.object({ companyId: id, name: text }).parse(await body(req));
      const existing = await pool.query("select id from subsidiaries where lower(btrim(name))=lower($1) limit 1", [data.name]);
      if (existing.rows.length) throw new HttpError(409, "DUPLICATE_SUBSIDIARY", "子公司名称已存在");
      const newId = randomUUID();
      await pool.query("insert into subsidiaries (id,company_id,name) values ($1,$2,$3)", [newId, data.companyId, data.name]);
      return response({ id: newId }, 201);
    }
    if (path === "cycles") {
      superRequired(actor);
      const data = z.object({ companyId: id, name: text }).parse(await body(req));
      const newId = randomUUID();
      await pool.query("insert into cycles (id,company_id,name) values ($1,$2,$3)", [newId, data.companyId, data.name]);
      return response({ id: newId }, 201);
    }
    if (path === "employees") { adminRequired(actor); return response(await createEmployee(actor, await body(req)), 201); }
    if (path === "admin-scopes") {
      superRequired(actor);
      const data = z.object({ employeeNo, subsidiaryId: id }).parse(await body(req));
      await pool.query("insert into admin_scopes (admin_employee_no,subsidiary_id) values ($1,$2) on conflict do nothing", [data.employeeNo, data.subsidiaryId]);
      return response({ ok: true });
    }
    if (path === "assessments") {
      adminRequired(actor);
      const data = z.object({ cycleId: id, employeeNo, nodes: z.array(node).min(1).max(300), scorers: z.array(employeeNo).min(1).max(20) }).parse(await body(req));
      return response(await configureAssessment(actor, data), 201);
    }
    if (path === "imports/employees") {
      adminRequired(actor);
      if (Number(req.headers.get("content-length") ?? 0) > 2_100_000) throw new HttpError(413, "FILE_TOO_LARGE", "上传文件超过 2MB");
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 2_000_000) throw new HttpError(422, "FILE", "请选择小于 2MB 的 xlsx 文件");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > 501) throw new HttpError(422, "FILE", "单次最多导入 500 人");
      const errors: string[] = [];
      const rows: (z.infer<typeof employeeImportRow> & { subsidiaryId: string })[] = [];
      const subsidiaries = await pool.query("select id,name from subsidiaries where $1::boolean or id=any($2::text[])", [actor.isSuperAdmin, actor.adminSubsidiaryIds]);
      const seen = new Set<string>();
      for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
        const row = sheet.getRow(rowIndex);
        const cell = (n: number) => String(row.getCell(n).text ?? "").trim();
        if (!cell(1)) continue;
        const parsed = employeeImportRow.safeParse({ employeeNo: cell(1), name: cell(2), subsidiaryName: cell(3), department: cell(4), position: cell(5), phone: cell(6), initialPassword: cell(7) });
        if (!parsed.success) { errors.push(`第 ${rowIndex} 行：${parsed.error.issues.map((issue) => issue.path.join(".")).join("、")}无效`); continue; }
        if (seen.has(parsed.data.employeeNo)) { errors.push(`第 ${rowIndex} 行：工号在文件中重复`); continue; }
        seen.add(parsed.data.employeeNo);
        const matches = subsidiaries.rows.filter((s) => s.name === parsed.data.subsidiaryName);
        if (matches.length !== 1) { errors.push(`第 ${rowIndex} 行：子公司名称不存在或不唯一`); continue; }
        rows.push({ ...parsed.data, subsidiaryId: matches[0].id });
      }
      if (!rows.length && !errors.length) errors.push("文件中没有有效数据行");
      if (rows.length) {
        const existing = await pool.query("select employee_no from employees where employee_no=any($1::text[])", [rows.map((r) => r.employeeNo)]);
        for (const row of existing.rows) errors.push(`工号 ${row.employee_no} 已存在`);
      }
      if (errors.length) return response({ imported: 0, valid: rows.length, errors }, 422);
      if (form.get("commit") !== "true") return response({ preview: true, valid: rows.length, errors: [] });
      const hashes = await Promise.all(rows.map((row) => hashPassword(row.initialPassword)));
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          await client.query("insert into employees (employee_no,subsidiary_id,name,department,position,phone,password_hash) values ($1,$2,$3,$4,$5,$6,$7)", [row.employeeNo, row.subsidiaryId, row.name, row.department, row.position, row.phone, hashes[i]]);
        }
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
      return response({ imported: rows.length, valid: rows.length, errors: [] });
    }
    if (path === "imports/indicators") {
      adminRequired(actor);
      if (Number(req.headers.get("content-length") ?? 0) > 2_100_000) throw new HttpError(413, "FILE_TOO_LARGE", "上传文件超过 2MB");
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 2_000_000) throw new HttpError(422, "FILE", "请选择小于 2MB 的 xlsx 文件");
      const cycleId = id.parse(form.get("cycleId")); const targetNo = employeeNo.parse(form.get("employeeNo"));
      const scorers = z.array(employeeNo).min(1).parse(JSON.parse(String(form.get("scorers") ?? "[]")));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > 301) throw new HttpError(422, "FILE", "单次最多导入 300 个指标节点");
      const header = String(sheet.getRow(1).getCell(1).text ?? "").trim();
      const nodes = [];
      if (header === "指标编码") {
        for (let i = 2; i <= sheet.rowCount; i++) {
          const row = sheet.getRow(i); const cell = (n: number) => String(row.getCell(n).text ?? "").trim();
          if (!cell(1)) continue;
          nodes.push(node.parse({ nodeCode: cell(1), parentCode: cell(2) || null, name: cell(3), description: cell(4), scoringRule: "", maxScore: Number(cell(5)), sortOrder: Number(cell(6) || i) }));
        }
      } else if (header === "一级指标") {
        const groups: IndicatorGroupDraft[] = [];
        const groupsByName = new Map<string, IndicatorGroupDraft>();
        for (let i = 2; i <= sheet.rowCount; i++) {
          const row = sheet.getRow(i); const cell = (n: number) => String(row.getCell(n).text ?? "").trim();
          if (!cell(1)) continue;
          const name = cell(1); const maxScore = cell(4);
          let group = groupsByName.get(name);
          if (!group) {
            group = { name, description: cell(2), scoringRule: cell(3), maxScore, children: [] };
            groupsByName.set(name, group); groups.push(group);
          } else if (group.maxScore !== maxScore) {
            throw new HttpError(422, "INVALID_TEMPLATE", `第 ${i} 行：同名一级指标的分值必须一致`);
          }
          if (cell(5)) group.children.push({ name: cell(5), description: cell(6), scoringRule: cell(7), maxScore: cell(8) });
        }
        const errors = validateIndicatorHierarchy(groups);
        if (errors.length) throw new HttpError(422, "INVALID_TREE", errors.join("；"));
        nodes.push(...buildIndicatorNodes(groups));
      } else {
        throw new HttpError(422, "INVALID_TEMPLATE", "指标模板表头应为“一级指标”，请下载最新模板后导入");
      }
      return response(await configureAssessment(actor, { cycleId, employeeNo: targetNo, nodes, scorers }));
    }
    if (path === "imports/scorers") {
      adminRequired(actor);
      if (Number(req.headers.get("content-length") ?? 0) > 2_100_000) throw new HttpError(413, "FILE_TOO_LARGE", "上传文件超过 2MB");
      const form = await req.formData(); const file = form.get("file");
      if (!(file instanceof File) || file.size > 2_000_000) throw new HttpError(422, "FILE", "请选择小于 2MB 的 xlsx 文件");
      const cycleId = id.parse(form.get("cycleId"));
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > 501) throw new HttpError(422, "FILE", "单次最多导入 500 条关系");
      const cycle = await pool.query("select company_id,status from cycles where id=$1", [cycleId]);
      if (!cycle.rows[0] || cycle.rows[0].status !== "DRAFT") throw new HttpError(409, "CYCLE_NOT_DRAFT", "仅草稿周期可导入打分关系");
      const pairs: { employeeNo: string; scorerNo: string }[] = []; const errors: string[] = []; const seen = new Set<string>();
      for (let i = 2; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i); const target = String(row.getCell(1).text ?? "").trim(); const scorer = String(row.getCell(2).text ?? "").trim();
        if (!target && !scorer) continue;
        const parsed = z.tuple([employeeNo, employeeNo]).safeParse([target, scorer]);
        if (!parsed.success || target === scorer || seen.has(`${target}:${scorer}`)) { errors.push(`第 ${i} 行：工号无效、自评或关系重复`); continue; }
        seen.add(`${target}:${scorer}`); pairs.push({ employeeNo: target, scorerNo: scorer });
      }
      if (!pairs.length && !errors.length) errors.push("文件中没有有效数据行");
      const employeeNos = [...new Set(pairs.flatMap((p) => [p.employeeNo, p.scorerNo]))];
      const people = await pool.query(`select e.employee_no,e.subsidiary_id,s.company_id,e.status from employees e join subsidiaries s on s.id=e.subsidiary_id where e.employee_no=any($1::text[])`, [employeeNos]);
      const byNo = new Map(people.rows.map((p) => [p.employee_no as string, p]));
      for (const pair of pairs) {
        const target = byNo.get(pair.employeeNo); const scorer = byNo.get(pair.scorerNo);
        if (!target || !scorer || target.status !== "ACTIVE" || scorer.status !== "ACTIVE" || target.company_id !== cycle.rows[0].company_id || scorer.company_id !== cycle.rows[0].company_id || !mayAdmin(actor, target.subsidiary_id) || !mayAdmin(actor, scorer.subsidiary_id)) errors.push(`${pair.employeeNo} → ${pair.scorerNo}：人员不存在、已停用或超出授权范围`);
      }
      const targetNos = [...new Set(pairs.map((p) => p.employeeNo))];
      const assessments = await pool.query("select employee_no,status from assessments where cycle_id=$1 and employee_no=any($2::text[])", [cycleId, targetNos]);
      if (assessments.rows.length !== targetNos.length || assessments.rows.some((a) => a.status !== "DRAFT")) errors.push("请先为全部被打分人配置草稿指标，且不得已有填报");
      if (errors.length) return response({ imported: 0, valid: pairs.length, errors }, 422);
      if (form.get("commit") !== "true") return response({ preview: true, valid: pairs.length, errors: [] });
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from cycles where id=$1 and status='DRAFT' for update", [cycleId]);
        await client.query("delete from scorer_assignments where cycle_id=$1 and employee_no=any($2::text[])", [cycleId, targetNos]);
        for (const pair of pairs) await client.query("insert into scorer_assignments (id,cycle_id,employee_no,scorer_employee_no) values ($1,$2,$3,$4)", [randomUUID(), cycleId, pair.employeeNo, pair.scorerNo]);
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
      return response({ imported: pairs.length, valid: pairs.length, errors: [] });
    }
    const match = path.match(/^cycles\/([^/]+)\/publish$/);
    if (match) return response(await publishCycle(actor, id.parse(match[1]), req.headers.get("idempotency-key")));
    const selfSubmit = path.match(/^my\/assessments\/([^/]+)\/submit$/);
    if (selfSubmit) { const data = z.object({ version: z.number().int().positive() }).parse(await body(req)); return response(await submitSelf(actor, id.parse(selfSubmit[1]), data.version, req.headers.get("idempotency-key"))); }
    const review = path.match(/^admin\/assessments\/([^/]+)\/(approve|return)$/);
    if (review) {
      const data = z.object({ version: z.number().int().positive(), feedback: z.array(z.object({ nodeId: id, comment: z.string().max(2000) })).default([]) }).parse(await body(req));
      return response(review[2] === "approve" ? await approveAssessment(actor, id.parse(review[1]), data.version, req.headers.get("idempotency-key")) : await returnAssessment(actor, id.parse(review[1]), data.version, data.feedback, req.headers.get("idempotency-key")));
    }
    const scoreSubmit = path.match(/^scorer\/tasks\/([^/]+)\/submit$/);
    if (scoreSubmit) { const data = z.object({ version: z.number().int().positive() }).parse(await body(req)); return response(await submitScore(actor, id.parse(scoreSubmit[1]), data.version, req.headers.get("idempotency-key"))); }
    const reminder = path.match(/^admin\/assessments\/([^/]+)\/remind$/);
    if (reminder) {
      adminRequired(actor);
      const result = await pool.query("select e.subsidiary_id from assessments a join employees e on e.employee_no=a.employee_no where a.id=$1", [id.parse(reminder[1])]);
      if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "考核单不存在");
      if (!mayAdmin(actor, result.rows[0].subsidiary_id)) throw new HttpError(403, "FORBIDDEN", "无权催办");
      await pool.query("insert into audit_logs (id,actor_employee_no,action,entity_type,entity_id) values ($1,$2,'REMIND','ASSESSMENT',$3)", [randomUUID(), actor.employeeNo, reminder[1]]);
      return response({ ok: true, message: "已记录催办；当前版本暂无短信或企业微信推送" });
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return failure(error); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    guardOrigin(req);
    const actor = await actorRequired(); const path = (await ctx.params).path.join("/");
    const company = path.match(/^companies\/([^/]+)$/);
    if (company) {
      superRequired(actor);
      const companyId = id.parse(company[1]);
      const data = z.object({ name: text }).parse(await body(req));
      const result = await pool.query("update companies set name=$2 where id=$1 returning id", [companyId, data.name]);
      if (!result.rows.length) throw new HttpError(404, "NOT_FOUND", "企业不存在");
      return response({ ok: true });
    }
    const subsidiary = path.match(/^subsidiaries\/([^/]+)$/);
    if (subsidiary) {
      superRequired(actor);
      const subsidiaryId = id.parse(subsidiary[1]);
      const data = z.object({ name: text.optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
        .refine((value) => value.name !== undefined || value.status !== undefined, "请提供名称或状态").parse(await body(req));
      if (data.name !== undefined) {
        const existing = await pool.query("select id from subsidiaries where lower(btrim(name))=lower($1) and id<>$2 limit 1", [data.name, subsidiaryId]);
        if (existing.rows.length) throw new HttpError(409, "DUPLICATE_SUBSIDIARY", "子公司名称已存在");
      }
      if (data.status === "INACTIVE") {
        const active = await pool.query("select c.id from cycles c join subsidiaries s on s.company_id=c.company_id where s.id=$1 and c.status='ACTIVE' limit 1", [subsidiaryId]);
        if (active.rows.length) throw new HttpError(409, "ACTIVE_CYCLE", "该子公司所属企业有进行中的考核周期，暂不能停用");
      }
      const result = await pool.query("update subsidiaries set name=coalesce($2,name),status=coalesce($3,status) where id=$1 returning id", [subsidiaryId, data.name ?? null, data.status ?? null]);
      if (!result.rows.length) throw new HttpError(404, "NOT_FOUND", "子公司不存在");
      return response({ ok: true });
    }
    const self = path.match(/^my\/assessments\/([^/]+)$/);
    if (self) {
      const data = z.object({ version: z.number().int().positive(), values: z.array(z.object({ nodeId: id, content: z.string().max(4000) })).max(300) }).parse(await body(req));
      return response(await saveSelf(actor, id.parse(self[1]), data.version, data.values));
    }
    const task = path.match(/^scorer\/tasks\/([^/]+)$/);
    if (task) {
      const data = z.object({ version: z.number().int().positive(), items: z.array(z.object({ nodeId: id, score, comment: z.string().max(2000) })).max(300) }).parse(await body(req));
      return response(await saveScore(actor, id.parse(task[1]), data.version, data.items));
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return failure(error); }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    guardOrigin(req);
    const actor = await actorRequired(); superRequired(actor);
    const path = (await ctx.params).path.join("/");
    if (path === "admin-scopes") {
      const data = z.object({ employeeNo, subsidiaryId: id }).parse(await body(req));
      await pool.query("delete from admin_scopes where admin_employee_no=$1 and subsidiary_id=$2", [data.employeeNo, data.subsidiaryId]);
      return response({ ok: true });
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return failure(error); }
}
