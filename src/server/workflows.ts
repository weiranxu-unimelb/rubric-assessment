import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { Actor } from "./auth";
import { calculateFinalScore, validateIndicatorTree } from "./domain";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type NewIndicator = {
  nodeCode: string;
  parentCode: string | null;
  name: string;
  description: string;
  scoringRule: string;
  maxScore: number;
  sortOrder: number;
};

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client: PoolClient, actor: Actor, action: string, entityType: string, entityId: string, detail?: unknown) {
  await client.query("insert into audit_logs (id, actor_employee_no, action, entity_type, entity_id, detail) values ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), actor.employeeNo, action, entityType, entityId, detail ? JSON.stringify(detail) : null]);
}

async function assessmentForUpdate(client: PoolClient, assessmentId: string) {
  const result = await client.query(`select a.id, a.cycle_id as "cycleId", a.employee_no as "employeeNo", a.status, a.version, e.subsidiary_id as "subsidiaryId", c.status as "cycleStatus"
    from assessments a join employees e on e.employee_no=a.employee_no join cycles c on c.id=a.cycle_id where a.id=$1 for update of a`, [assessmentId]);
  if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "考核单不存在");
  return result.rows[0] as { id: string; cycleId: string; employeeNo: string; status: string; version: number; subsidiaryId: string; cycleStatus: string };
}

function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new HttpError(409, "VERSION_CONFLICT", "数据已被他人更新，请刷新后重试");
}

function assertAdmin(actor: Actor, subsidiaryId: string) {
  if (!actor.isSuperAdmin && !actor.adminSubsidiaryIds.includes(subsidiaryId)) {
    throw new HttpError(403, "FORBIDDEN", "无权管理该子公司");
  }
}

export async function withIdempotency<T>(actor: Actor, key: string | null, payload: unknown, run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!key || key.length > 120) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "提交操作需要 Idempotency-Key");
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return inTransaction(async (client) => {
    const claim = await client.query("insert into idempotency_records (key, actor_employee_no, request_hash) values ($1,$2,$3) on conflict do nothing returning key", [key, actor.employeeNo, hash]);
    if (!claim.rowCount) {
      const previous = await client.query("select actor_employee_no as \"actorEmployeeNo\", request_hash as \"requestHash\", response_json as \"responseJson\" from idempotency_records where key=$1", [key]);
      if (previous.rows[0]?.actorEmployeeNo !== actor.employeeNo || previous.rows[0]?.requestHash !== hash) {
        throw new HttpError(422, "IDEMPOTENCY_REUSED", "请求键已用于其他操作");
      }
      if (!previous.rows[0]?.responseJson) throw new HttpError(409, "IN_PROGRESS", "该操作正在处理，请稍后重试");
      return JSON.parse(previous.rows[0].responseJson) as T;
    }
    const result = await run(client);
    await client.query("update idempotency_records set response_json=$2 where key=$1", [key, JSON.stringify(result)]);
    return result;
  });
}

export async function configureAssessment(actor: Actor, input: { cycleId: string; employeeNo: string; nodes: NewIndicator[]; scorers: string[]; templateId?: string | null; preserveExistingScorers?: boolean }) {
  const mapped = input.nodes.map((node) => ({ id: node.nodeCode, parentId: node.parentCode, name: node.name, maxScore: node.maxScore }));
  const errors = validateIndicatorTree(mapped);
  if (errors.length) throw new HttpError(422, "INVALID_TREE", errors.join("；"));
  if (new Set(input.scorers).size !== input.scorers.length || input.scorers.includes(input.employeeNo)) {
    throw new HttpError(422, "INVALID_SCORERS", "打分人不可重复，且不可为本人");
  }
  return inTransaction(async (client) => {
    const target = await client.query("select e.subsidiary_id as \"subsidiaryId\", s.company_id as \"companyId\" from employees e join subsidiaries s on s.id=e.subsidiary_id where e.employee_no=$1 and e.status='ACTIVE'", [input.employeeNo]);
    if (!target.rows[0]) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "员工不存在或已停用");
    assertAdmin(actor, target.rows[0].subsidiaryId);
    const cycle = await client.query("select company_id as \"companyId\", status from cycles where id=$1 for update", [input.cycleId]);
    if (!cycle.rows[0] || cycle.rows[0].status !== "DRAFT") {
      throw new HttpError(409, "CYCLE_NOT_DRAFT", "仅草稿周期可配置指标");
    }
    const scorers = input.scorers.length ? await client.query("select e.employee_no as \"employeeNo\", e.subsidiary_id as \"subsidiaryId\", s.company_id as \"companyId\" from employees e join subsidiaries s on s.id=e.subsidiary_id where e.employee_no=any($1::text[]) and e.status='ACTIVE'", [input.scorers]) : { rows: [] as { employeeNo: string; subsidiaryId: string; companyId: string }[] };
    if (scorers.rows.length !== input.scorers.length || scorers.rows.some((row) => row.companyId !== target.rows[0].companyId || (!actor.isSuperAdmin && !actor.adminSubsidiaryIds.includes(row.subsidiaryId)))) {
      throw new HttpError(422, "INVALID_SCORERS", "打分人必须属于同一企业、在管理员授权范围内且为在职员工");
    }
    const assessment = await client.query("select id, status from assessments where cycle_id=$1 and employee_no=$2 for update", [input.cycleId, input.employeeNo]);
    const assessmentId = assessment.rows[0]?.id as string | undefined;
    if (assessmentId && assessment.rows[0].status !== "DRAFT") throw new HttpError(409, "ASSESSMENT_LOCKED", "员工已开始填报，无法重配指标");
    const id = assessmentId ?? randomUUID();
    if (!assessmentId) await client.query("insert into assessments (id,cycle_id,employee_no,template_id) values ($1,$2,$3,$4)", [id, input.cycleId, input.employeeNo, input.templateId ?? null]);
    else {
      await client.query("update assessments set template_id=$2,version=version+1 where id=$1", [id, input.templateId ?? null]);
      await client.query("delete from indicator_nodes where assessment_id=$1", [id]);
      if (!input.preserveExistingScorers) await client.query("delete from scorer_assignments where cycle_id=$1 and employee_no=$2", [input.cycleId, input.employeeNo]);
    }
    const idByCode = new Map(input.nodes.map((node) => [node.nodeCode, randomUUID()]));
    for (const node of input.nodes) {
      await client.query("insert into indicator_nodes (id,assessment_id,parent_id,node_code,name,description,scoring_rule,max_score,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [idByCode.get(node.nodeCode), id, node.parentCode ? idByCode.get(node.parentCode) : null, node.nodeCode, node.name, node.description, node.scoringRule, node.maxScore, node.sortOrder]);
    }
    for (const scorerNo of input.scorers) {
      await client.query("insert into scorer_assignments (id,cycle_id,employee_no,scorer_employee_no) values ($1,$2,$3,$4)", [randomUUID(), input.cycleId, input.employeeNo, scorerNo]);
    }
    await audit(client, actor, assessmentId ? "RECONFIGURE" : "CREATE", "ASSESSMENT", id, { employeeNo: input.employeeNo });
    return { id };
  });
}

export async function publishCycle(actor: Actor, cycleId: string, key: string | null) {
  if (!actor.isSuperAdmin) throw new HttpError(403, "FORBIDDEN", "仅超级管理员可发布考核周期");
  return withIdempotency(actor, key, { cycleId, action: "PUBLISH" }, async (client) => {
    const cycle = await client.query("select company_id as \"companyId\", status from cycles where id=$1 for update", [cycleId]);
    if (!cycle.rows[0] || cycle.rows[0].status !== "DRAFT") throw new HttpError(409, "CYCLE_NOT_DRAFT", "周期不是草稿状态");
    const missing = await client.query(`select e.employee_no from employees e
      left join assessments a on a.employee_no=e.employee_no and a.cycle_id=$1
      where e.status='ACTIVE' and a.id is null limit 10`, [cycleId]);
    if (missing.rows.length) throw new HttpError(422, "MISSING_ASSESSMENTS", `以下员工尚未配置指标：${missing.rows.map((row) => row.employee_no).join("、")}`);
    const noScorers = await client.query(`select e.employee_no from employees e
      where e.status='ACTIVE' and not exists
      (select 1 from scorer_assignments sa where sa.cycle_id=$1 and sa.employee_no=e.employee_no and sa.status='ACTIVE') limit 10`, [cycleId]);
    if (noScorers.rows.length) throw new HttpError(422, "MISSING_SCORERS", `以下员工尚未分配打分人：${noScorers.rows.map((row) => row.employee_no).join("、")}`);
    await client.query("update cycles set status='ACTIVE' where id=$1", [cycleId]);
    await audit(client, actor, "PUBLISH", "CYCLE", cycleId);
    return { id: cycleId, status: "ACTIVE" };
  });
}

export async function saveSelf(actor: Actor, assessmentId: string, expectedVersion: number, values: { nodeId: string; content: string }[]) {
  return inTransaction(async (client) => {
    const assessment = await assessmentForUpdate(client, assessmentId);
    if (assessment.employeeNo !== actor.employeeNo) throw new HttpError(403, "FORBIDDEN", "只能填写自己的考核单");
    if (!["DRAFT", "ACTIVE"].includes(assessment.cycleStatus) || !["DRAFT", "RETURNED"].includes(assessment.status)) throw new HttpError(409, "LOCKED", "当前考核单不可编辑");
    assertVersion(assessment.version, expectedVersion);
    const nodeIds = values.map((value) => value.nodeId);
    const valid = await client.query("select id from indicator_nodes where assessment_id=$1 and id=any($2::text[])", [assessmentId, nodeIds]);
    if (valid.rows.length !== nodeIds.length || new Set(nodeIds).size !== nodeIds.length) throw new HttpError(422, "INVALID_NODES", "包含无效指标节点");
    for (const value of values) {
      await client.query("update indicator_nodes set self_content=$3 where assessment_id=$1 and id=$2", [assessmentId, value.nodeId, value.content]);
    }
    await client.query("update assessments set version=version+1 where id=$1", [assessmentId]);
    await audit(client, actor, "SAVE_SELF", "ASSESSMENT", assessmentId);
    return { id: assessmentId, version: assessment.version + 1 };
  });
}

export async function saveOwnIndicatorTree(actor: Actor, assessmentId: string, expectedVersion: number, nodes: NewIndicator[]) {
  const mapped = nodes.map((node) => ({ id: node.nodeCode, parentId: node.parentCode, name: node.name, maxScore: node.maxScore }));
  const errors = validateIndicatorTree(mapped);
  if (errors.length) throw new HttpError(422, "INVALID_TREE", errors.join("；"));
  return inTransaction(async (client) => {
    const assessment = await assessmentForUpdate(client, assessmentId);
    if (assessment.employeeNo !== actor.employeeNo) throw new HttpError(403, "FORBIDDEN", "只能修改自己的考核单");
    if (!["DRAFT", "ACTIVE"].includes(assessment.cycleStatus) || !["DRAFT", "RETURNED"].includes(assessment.status)) throw new HttpError(409, "LOCKED", "当前考核单不可编辑");
    assertVersion(assessment.version, expectedVersion);
    await client.query("delete from indicator_nodes where assessment_id=$1", [assessmentId]);
    const idByCode = new Map(nodes.map((node) => [node.nodeCode, randomUUID()]));
    for (const node of nodes) await client.query("insert into indicator_nodes (id,assessment_id,parent_id,node_code,name,description,scoring_rule,max_score,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [idByCode.get(node.nodeCode), assessmentId, node.parentCode ? idByCode.get(node.parentCode) : null, node.nodeCode, node.name, node.description, node.scoringRule, node.maxScore, node.sortOrder]);
    await client.query("update assessments set version=version+1 where id=$1", [assessmentId]);
    await audit(client, actor, "EDIT_INDICATOR_TREE", "ASSESSMENT", assessmentId);
    return { id: assessmentId, version: assessment.version + 1 };
  });
}

export async function submitSelf(actor: Actor, assessmentId: string, expectedVersion: number, key: string | null) {
  return withIdempotency(actor, key, { assessmentId, expectedVersion, action: "SUBMIT_SELF" }, async (client) => {
    const assessment = await assessmentForUpdate(client, assessmentId);
    if (assessment.employeeNo !== actor.employeeNo) throw new HttpError(403, "FORBIDDEN", "只能提交自己的考核单");
    if (!["DRAFT", "ACTIVE"].includes(assessment.cycleStatus) || !["DRAFT", "RETURNED"].includes(assessment.status)) throw new HttpError(409, "LOCKED", "当前考核单不可提交");
    assertVersion(assessment.version, expectedVersion);
    await client.query("update assessments set status='SUBMITTED', version=version+1, submitted_at=now() where id=$1", [assessmentId]);
    await audit(client, actor, "SUBMIT_SELF", "ASSESSMENT", assessmentId);
    return { id: assessmentId, status: "SUBMITTED", version: assessment.version + 1 };
  });
}

export async function returnAssessment(actor: Actor, assessmentId: string, expectedVersion: number, feedback: { nodeId: string; comment: string }[], key: string | null) {
  if (!feedback.length || feedback.every((item) => !item.comment.trim())) throw new HttpError(422, "FEEDBACK_REQUIRED", "退回时至少填写一条指标参考意见");
  return withIdempotency(actor, key, { assessmentId, expectedVersion, feedback, action: "RETURN" }, async (client) => {
    const assessment = await assessmentForUpdate(client, assessmentId);
    assertAdmin(actor, assessment.subsidiaryId);
    if (assessment.status !== "SUBMITTED") throw new HttpError(409, "NOT_SUBMITTED", "只能退回待预审考核单");
    assertVersion(assessment.version, expectedVersion);
    const ids = feedback.map((item) => item.nodeId);
    const valid = await client.query("select id from indicator_nodes where assessment_id=$1 and id=any($2::text[])", [assessmentId, ids]);
    if (valid.rows.length !== ids.length || new Set(ids).size !== ids.length) throw new HttpError(422, "INVALID_NODES", "包含无效指标节点");
    for (const item of feedback) {
      await client.query("update indicator_nodes set admin_feedback=$3 where assessment_id=$1 and id=$2", [assessmentId, item.nodeId, item.comment]);
    }
    await client.query("update assessments set status='RETURNED', version=version+1 where id=$1", [assessmentId]);
    await audit(client, actor, "RETURN_SELF", "ASSESSMENT", assessmentId, { nodeIds: ids });
    return { id: assessmentId, status: "RETURNED", version: assessment.version + 1 };
  });
}

export async function approveAssessment(actor: Actor, assessmentId: string, expectedVersion: number, key: string | null) {
  return withIdempotency(actor, key, { assessmentId, expectedVersion, action: "APPROVE" }, async (client) => {
    const assessment = await assessmentForUpdate(client, assessmentId);
    assertAdmin(actor, assessment.subsidiaryId);
    if (assessment.status !== "SUBMITTED") throw new HttpError(409, "NOT_SUBMITTED", "只能通过待预审考核单");
    if (!["DRAFT", "ACTIVE"].includes(assessment.cycleStatus)) throw new HttpError(409, "CYCLE_LOCKED", "当前考核周期不可审核");
    assertVersion(assessment.version, expectedVersion);
    const assignments = await client.query("select scorer_employee_no as \"scorerEmployeeNo\" from scorer_assignments where cycle_id=$1 and employee_no=$2 and status='ACTIVE' order by scorer_employee_no for update", [assessment.cycleId, assessment.employeeNo]);
    if (!assignments.rows.length) throw new HttpError(422, "NO_SCORERS", "请先配置打分人");
    for (const row of assignments.rows) {
      await client.query("insert into score_tasks (id,assessment_id,scorer_employee_no) values ($1,$2,$3)", [randomUUID(), assessmentId, row.scorerEmployeeNo]);
    }
    await client.query("update assessments set status='SCORING', version=version+1, approved_at=now() where id=$1", [assessmentId]);
    await audit(client, actor, "APPROVE_SELF", "ASSESSMENT", assessmentId);
    return { id: assessmentId, status: "SCORING", version: assessment.version + 1, taskCount: assignments.rows.length };
  });
}

async function taskForUpdate(client: PoolClient, actor: Actor, taskId: string) {
  const result = await client.query(`select t.id, t.assessment_id as "assessmentId", t.status, t.version,
    a.status as "assessmentStatus", c.status as "cycleStatus"
    from score_tasks t join assessments a on a.id=t.assessment_id join cycles c on c.id=a.cycle_id
    where t.id=$1 and t.scorer_employee_no=$2 for update of t`, [taskId, actor.employeeNo]);
  if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "打分任务不存在");
  return result.rows[0] as { id: string; assessmentId: string; status: string; version: number; assessmentStatus: string; cycleStatus: string };
}

export async function saveScore(actor: Actor, taskId: string, expectedVersion: number, items: { nodeId: string; score: number; comment: string }[]) {
  return inTransaction(async (client) => {
    const task = await taskForUpdate(client, actor, taskId);
    if (task.status !== "PENDING" || task.assessmentStatus !== "SCORING" || !["DRAFT", "ACTIVE"].includes(task.cycleStatus)) throw new HttpError(409, "LOCKED", "评分已提交或考核周期已停止，不能再修改");
    assertVersion(task.version, expectedVersion);
    const ids = items.map((item) => item.nodeId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "DUPLICATE_NODES", "打分项不可重复");
    const leaves = await client.query(`select n.id, n.max_score as "maxScore" from indicator_nodes n where n.assessment_id=$1 and n.id not in
      (select parent_id from indicator_nodes where assessment_id=$1 and parent_id is not null)`, [task.assessmentId]);
    const maxById = new Map(leaves.rows.map((row) => [row.id as string, Number(row.maxScore)]));
    for (const item of items) {
      const max = maxById.get(item.nodeId);
      if (max === undefined || !Number.isFinite(item.score) || item.score < 0 || item.score > max) {
        throw new HttpError(422, "INVALID_SCORE", "得分超出对应指标范围");
      }
      await client.query(`insert into score_items (task_id,node_id,score,comment) values ($1,$2,$3,$4)
        on conflict (task_id,node_id) do update set score=excluded.score, comment=excluded.comment`,
        [taskId, item.nodeId, item.score, item.comment]);
    }
    await client.query("update score_tasks set version=version+1 where id=$1", [taskId]);
    await audit(client, actor, "SAVE_SCORE", "SCORE_TASK", taskId);
    return { id: taskId, version: task.version + 1 };
  });
}

export async function submitScore(actor: Actor, taskId: string, expectedVersion: number, key: string | null) {
  return withIdempotency(actor, key, { taskId, expectedVersion, action: "SUBMIT_SCORE" }, async (client) => {
    const task = await taskForUpdate(client, actor, taskId);
    if (task.status !== "PENDING" || task.assessmentStatus !== "SCORING" || !["DRAFT", "ACTIVE"].includes(task.cycleStatus)) throw new HttpError(409, "LOCKED", "评分已提交或考核周期已停止，不能再提交");
    assertVersion(task.version, expectedVersion);
    const leaves = await client.query(`select n.id, n.max_score as "maxScore", i.score from indicator_nodes n
      left join score_items i on i.node_id=n.id and i.task_id=$2
      where n.assessment_id=$1 and n.id not in (select parent_id from indicator_nodes where assessment_id=$1 and parent_id is not null)`, [task.assessmentId, taskId]);
    if (!leaves.rows.length || leaves.rows.some((row) => row.score === null || Number(row.score) < 0 || Number(row.score) > Number(row.maxScore))) {
      throw new HttpError(422, "INCOMPLETE_SCORE", "请完成每个叶子指标的有效评分");
    }
    const total = Math.round(leaves.rows.reduce((sum, row) => sum + Number(row.score), 0) * 100) / 100;
    await client.query("update score_tasks set status='SUBMITTED', version=version+1, total_score=$2, submitted_at=now() where id=$1", [taskId, total]);
    await client.query("select id from assessments where id=$1 for update", [task.assessmentId]);
    const all = await client.query("select status, total_score from score_tasks where assessment_id=$1", [task.assessmentId]);
    if (all.rows.every((row) => row.status === "SUBMITTED")) {
      const finalScore = calculateFinalScore(all.rows.map((row) => Number(row.total_score)));
      await client.query("update assessments set status='COMPLETED', final_score=$2, version=version+1, completed_at=now() where id=$1", [task.assessmentId, finalScore]);
    }
    await audit(client, actor, "SUBMIT_SCORE", "SCORE_TASK", taskId);
    return { id: taskId, status: "SUBMITTED", version: task.version + 1, assessmentCompleted: all.rows.every((row) => row.status === "SUBMITTED") };
  });
}
