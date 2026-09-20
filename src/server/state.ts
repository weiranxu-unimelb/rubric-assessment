import { pool } from "./db";
import type { Actor } from "./auth";

export async function loadState(actor: Actor) {
  const [companies, subsidiaries, cycles, mine, myNodes, myTasks, templates] = await Promise.all([
    pool.query("select id, name from companies where $1::boolean or id in (select company_id from subsidiaries where id=$2 or id=any($3::text[])) order by name", [actor.isSuperAdmin, actor.subsidiaryId, actor.adminSubsidiaryIds]),
    pool.query("select id, company_id as \"companyId\", name, status from subsidiaries where $1::boolean or id=$2 or id=any($3::text[]) order by name", [actor.isSuperAdmin, actor.subsidiaryId, actor.adminSubsidiaryIds]),
    pool.query("select id, company_id as \"companyId\", name, status, starts_at as \"startsAt\", ends_at as \"endsAt\" from cycles order by created_at desc"),
    pool.query("select id, cycle_id as \"cycleId\", employee_no as \"employeeNo\", status, version, final_score as \"finalScore\" from assessments where employee_no = $1 order by id", [actor.employeeNo]),
    pool.query("select n.id, n.assessment_id as \"assessmentId\", n.parent_id as \"parentId\", n.node_code as \"nodeCode\", n.name, n.description, n.scoring_rule as \"scoringRule\", n.max_score as \"maxScore\", n.sort_order as \"sortOrder\", n.self_content as \"selfContent\", n.admin_feedback as \"adminFeedback\" from indicator_nodes n join assessments a on a.id=n.assessment_id where a.employee_no=$1 order by n.sort_order, n.node_code", [actor.employeeNo]),
    pool.query("select t.id, t.assessment_id as \"assessmentId\", t.status, t.version, t.total_score as \"totalScore\", a.employee_no as \"employeeNo\", e.name as \"employeeName\", a.cycle_id as \"cycleId\" from score_tasks t join assessments a on a.id=t.assessment_id join employees e on e.employee_no=a.employee_no where t.scorer_employee_no=$1 order by t.id", [actor.employeeNo]),
    actor.isSuperAdmin ? pool.query(`select template.id, template.company_id as "companyId", template.name, template.layout, template.created_by as "createdBy", coalesce(json_agg(json_build_object('id', node.id, 'name', node.name, 'deductionRule', node.deduction_rule, 'maxScore', node.max_score, 'sortOrder', node.sort_order)) filter (where node.id is not null), '[]') as nodes from indicator_templates template left join indicator_template_nodes node on node.template_id=template.id group by template.id order by template.created_at desc`) : actor.adminSubsidiaryIds.length ? pool.query(`select template.id, template.company_id as "companyId", template.name, template.layout, template.created_by as "createdBy", coalesce(json_agg(json_build_object('id', node.id, 'name', node.name, 'deductionRule', node.deduction_rule, 'maxScore', node.max_score, 'sortOrder', node.sort_order)) filter (where node.id is not null), '[]') as nodes from indicator_templates template left join indicator_template_nodes node on node.template_id=template.id where template.company_id in (select company_id from subsidiaries where id=any($1::text[])) group by template.id order by template.created_at desc`, [actor.adminSubsidiaryIds]) : Promise.resolve({ rows: [] }),
  ]);

  const taskIds = myTasks.rows.map((task) => task.id as string);
  const [taskNodes, ownScoreItems] = await Promise.all([
    taskIds.length ? pool.query("select n.id, n.assessment_id as \"assessmentId\", n.parent_id as \"parentId\", n.name, n.description, n.scoring_rule as \"scoringRule\", n.max_score as \"maxScore\", n.sort_order as \"sortOrder\", n.self_content as \"selfContent\" from indicator_nodes n join score_tasks t on t.assessment_id=n.assessment_id where t.id=any($1::text[]) order by n.sort_order,n.node_code", [taskIds]) : { rows: [] },
    taskIds.length ? pool.query("select task_id as \"taskId\", node_id as \"nodeId\", score, comment from score_items where task_id=any($1::text[])", [taskIds]) : { rows: [] },
  ]);

  const scope = actor.isSuperAdmin
    ? (await pool.query("select id from subsidiaries")).rows.map((row) => row.id as string)
    : actor.adminSubsidiaryIds;

  let adminData: Record<string, unknown> | null = null;
  if (scope.length > 0 || actor.isSuperAdmin) {
    const [employees, assessments, nodes, assignments, progress, templateAssignments] = await Promise.all([
      pool.query("select employee_no as \"employeeNo\", subsidiary_id as \"subsidiaryId\", name, department, position, phone, status, is_super_admin as \"isSuperAdmin\" from employees where subsidiary_id=any($1::text[]) order by department, name, employee_no", [scope]),
      pool.query("select a.id, a.cycle_id as \"cycleId\", a.employee_no as \"employeeNo\", e.name as \"employeeName\", e.subsidiary_id as \"subsidiaryId\", a.status, a.version, a.submitted_at as \"submittedAt\" from assessments a join employees e on e.employee_no=a.employee_no where e.subsidiary_id=any($1::text[]) order by e.name", [scope]),
      pool.query("select n.id, n.assessment_id as \"assessmentId\", n.parent_id as \"parentId\", n.node_code as \"nodeCode\", n.name, n.description, n.scoring_rule as \"scoringRule\", n.max_score as \"maxScore\", n.sort_order as \"sortOrder\", n.self_content as \"selfContent\", n.admin_feedback as \"adminFeedback\" from indicator_nodes n join assessments a on a.id=n.assessment_id join employees e on e.employee_no=a.employee_no where e.subsidiary_id=any($1::text[]) order by n.sort_order,n.node_code", [scope]),
      pool.query("select sa.id, sa.cycle_id as \"cycleId\", sa.employee_no as \"employeeNo\", sa.scorer_employee_no as \"scorerEmployeeNo\", s.name as \"scorerName\" from scorer_assignments sa join employees e on e.employee_no=sa.employee_no join employees s on s.employee_no=sa.scorer_employee_no where e.subsidiary_id=any($1::text[]) and sa.status='ACTIVE' order by e.name, s.name", [scope]),
      pool.query("select t.id, a.id as \"assessmentId\", a.cycle_id as \"cycleId\", a.employee_no as \"employeeNo\", t.scorer_employee_no as \"scorerEmployeeNo\", s.name as \"scorerName\", t.status from score_tasks t join assessments a on a.id=t.assessment_id join employees e on e.employee_no=a.employee_no join employees s on s.employee_no=t.scorer_employee_no where e.subsidiary_id=any($1::text[]) order by e.name, s.name", [scope]),
      pool.query("select ta.cycle_id as \"cycleId\",ta.employee_no as \"employeeNo\",ta.template_id as \"templateId\",t.name as \"templateName\" from template_assignments ta join employees e on e.employee_no=ta.employee_no join indicator_templates t on t.id=ta.template_id where e.subsidiary_id=any($1::text[]) order by e.name,t.name", [scope]),
    ]);
    adminData = { employees: employees.rows, assessments: assessments.rows, nodes: nodes.rows, assignments: assignments.rows, progress: progress.rows, templateAssignments: templateAssignments.rows };
  }

  let superData: Record<string, unknown> | null = null;
  if (actor.isSuperAdmin) {
    const [results, adminScopes] = await Promise.all([
      pool.query(`select a.cycle_id as "cycleId", a.employee_no as "employeeNo", e.name as "employeeName", s.name as "subsidiaryName", a.status,
        a.final_score as "finalScore", a.completed_at as "completedAt", count(t.id)::int as "scorerCount"
        from assessments a join employees e on e.employee_no=a.employee_no join subsidiaries s on s.id=e.subsidiary_id
        left join score_tasks t on t.assessment_id=a.id
        group by a.id,e.name,s.name order by a.cycle_id,s.name,e.name`),
      pool.query(`select scope.admin_employee_no as "adminEmployeeNo", scope.subsidiary_id as "subsidiaryId", employee.name as "employeeName", employee.department, employee.position, own_company.name as "companyName", managed_company.name as "managedCompanyName"
        from admin_scopes scope join employees employee on employee.employee_no=scope.admin_employee_no
        join subsidiaries own_company on own_company.id=employee.subsidiary_id
        join subsidiaries managed_company on managed_company.id=scope.subsidiary_id
        order by employee.name, managed_company.name`),
    ]);
    superData = { results: results.rows, adminScopes: adminScopes.rows };
  }

  return {
    actor,
    companies: companies.rows,
    subsidiaries: subsidiaries.rows,
    cycles: cycles.rows,
    mine: mine.rows,
    myNodes: myNodes.rows,
    myTasks: myTasks.rows,
    taskNodes: taskNodes.rows,
    ownScoreItems: ownScoreItems.rows,
    templates: templates.rows,
    admin: adminData,
    super: superData,
  };
}
