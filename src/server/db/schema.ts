import { pgTable, text, integer, boolean, numeric, timestamp, primaryKey, unique, index } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const subsidiaries = pgTable("subsidiaries", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("ACTIVE"),
});

export const employees = pgTable("employees", {
  employeeNo: text("employee_no").primaryKey(),
  subsidiaryId: text("subsidiary_id").notNull().references(() => subsidiaries.id),
  name: text("name").notNull(),
  position: text("position"),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminScopes = pgTable("admin_scopes", {
  adminEmployeeNo: text("admin_employee_no").notNull().references(() => employees.employeeNo),
  subsidiaryId: text("subsidiary_id").notNull().references(() => subsidiaries.id),
}, (table) => [primaryKey({ columns: [table.adminEmployeeNo, table.subsidiaryId] })]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  employeeNo: text("employee_no").notNull().references(() => employees.employeeNo),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const cycles = pgTable("cycles", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("DRAFT"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assessments = pgTable("assessments", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => cycles.id),
  employeeNo: text("employee_no").notNull().references(() => employees.employeeNo),
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  finalScore: numeric("final_score", { precision: 5, scale: 2 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [unique("assessment_cycle_employee_unique").on(table.cycleId, table.employeeNo), index("assessment_status_idx").on(table.cycleId, table.status)]);

export const indicatorNodes = pgTable("indicator_nodes", {
  id: text("id").primaryKey(),
  assessmentId: text("assessment_id").notNull().references(() => assessments.id),
  parentId: text("parent_id"),
  nodeCode: text("node_code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  selfContent: text("self_content").notNull().default(""),
  adminFeedback: text("admin_feedback").notNull().default(""),
}, (table) => [unique("indicator_assessment_code_unique").on(table.assessmentId, table.nodeCode), index("indicator_assessment_idx").on(table.assessmentId)]);

export const scorerAssignments = pgTable("scorer_assignments", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => cycles.id),
  employeeNo: text("employee_no").notNull().references(() => employees.employeeNo),
  scorerEmployeeNo: text("scorer_employee_no").notNull().references(() => employees.employeeNo),
  status: text("status").notNull().default("ACTIVE"),
}, (table) => [unique("scorer_assignment_unique").on(table.cycleId, table.employeeNo, table.scorerEmployeeNo)]);

export const scoreTasks = pgTable("score_tasks", {
  id: text("id").primaryKey(),
  assessmentId: text("assessment_id").notNull().references(() => assessments.id),
  scorerEmployeeNo: text("scorer_employee_no").notNull().references(() => employees.employeeNo),
  status: text("status").notNull().default("PENDING"),
  version: integer("version").notNull().default(1),
  totalScore: numeric("total_score", { precision: 5, scale: 2 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
}, (table) => [unique("score_task_assessment_scorer_unique").on(table.assessmentId, table.scorerEmployeeNo), index("score_task_scorer_idx").on(table.scorerEmployeeNo, table.status)]);

export const scoreItems = pgTable("score_items", {
  taskId: text("task_id").notNull().references(() => scoreTasks.id),
  nodeId: text("node_id").notNull().references(() => indicatorNodes.id),
  score: numeric("score", { precision: 5, scale: 2 }).notNull(),
  comment: text("comment").notNull().default(""),
}, (table) => [primaryKey({ columns: [table.taskId, table.nodeId] })]);

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  actorEmployeeNo: text("actor_employee_no").notNull().references(() => employees.employeeNo),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyRecords = pgTable("idempotency_records", {
  key: text("key").primaryKey(),
  actorEmployeeNo: text("actor_employee_no").notNull().references(() => employees.employeeNo),
  requestHash: text("request_hash").notNull(),
  responseJson: text("response_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
