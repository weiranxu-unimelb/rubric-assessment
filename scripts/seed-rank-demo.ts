import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.DEMO_SEED_CONFIRM !== "local-demo") throw new Error("仅本地演示可执行：设置 DEMO_SEED_CONFIRM=local-demo");
const subsidiaryId = process.env.DEMO_SUBSIDIARY_ID;
const department = process.env.DEMO_DEPARTMENT?.trim() || "综合管理部";
const password = process.env.DEMO_EMPLOYEE_PASSWORD || "user123456";
if (!subsidiaryId || !process.env.DATABASE_URL) throw new Error("请设置 DEMO_SUBSIDIARY_ID 和 DATABASE_URL");
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("演示密码至少 10 位且包含字母和数字");

const scrypt = promisify(scryptCallback);
const { Pool } = pg;
const demoLeaders = [
  { employeeNo: "DEMO-GM-01", name: "演示总经理", rank: "GENERAL_MANAGER", position: "总经理" },
  { employeeNo: "DEMO-DGM-01", name: "演示副总经理甲", rank: "DEPUTY_GENERAL_MANAGER", position: "副总经理" },
  { employeeNo: "DEMO-DGM-02", name: "演示副总经理乙", rank: "DEPUTY_GENERAL_MANAGER", position: "副总经理" },
] as const;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const subsidiary = await client.query("select id,name from subsidiaries where id=$1 for update", [subsidiaryId]);
    if (!subsidiary.rows.length) throw new Error("目标子公司不存在");
    // 已发布周期不应突然纳入没有考核单的新员工；领导先作为停用演示账号入库。
    const openCycle = await client.query("select 1 from cycles where status='ACTIVE' limit 1");
    const status = openCycle.rows.length ? "INACTIVE" : "ACTIVE";
    const updated = await client.query("update employees set department=$2 where subsidiary_id=$1 and department='' and is_super_admin=false and status='ACTIVE'", [subsidiaryId, department]);
    for (const leader of demoLeaders) {
      const salt = randomBytes(16).toString("hex");
      const hash = await scrypt(password, salt, 64) as Buffer;
      await client.query(`insert into employees (employee_no,subsidiary_id,name,department,position,rank,password_hash,status)
        values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (employee_no) do nothing`,
      [leader.employeeNo, subsidiaryId, leader.name, department, leader.position, leader.rank, `${salt}:${hash.toString("hex")}`, status]);
    }
    await client.query(`insert into department_scorer_presets (subsidiary_id,department,general_manager_factor,deputy_general_manager_factor,employee_factor)
      values ($1,$2,3,2,1) on conflict (subsidiary_id,department) do nothing`, [subsidiaryId, department]);
    await client.query("commit");
    console.log(`已为 ${subsidiary.rows[0].name} 的 ${updated.rowCount ?? 0} 名空部门员工设置 ${department}；演示领导状态：${status}。已有员工及预设不会覆盖。`);
    if (status === "INACTIVE") console.log("当前存在进行中周期，演示领导保持停用；待下一草稿周期开始后再启用，避免影响当前考核统计。");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
