import { randomUUID, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env");
const { Pool } = pg;
const scrypt = promisify(scryptCallback);
const employeeNo = process.env.BOOTSTRAP_SUPER_ADMIN_NO;
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME || "系统管理员";
if (!employeeNo || !password || password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  throw new Error("请设置 BOOTSTRAP_SUPER_ADMIN_NO 和至少 12 位且含字母、数字的 BOOTSTRAP_SUPER_ADMIN_PASSWORD");
}
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select employee_no from employees where is_super_admin=true limit 1");
    if (existing.rows.length) {
      console.log(`已存在超级管理员 ${existing.rows[0].employee_no}；未修改现有账号。`);
    } else {
      const companyId = randomUUID(); const subsidiaryId = randomUUID();
      const salt = randomBytes(16).toString("hex");
      const hash = await scrypt(password!, salt, 64) as Buffer;
      await client.query("insert into companies (id,name) values ($1,$2)", [companyId, process.env.BOOTSTRAP_COMPANY_NAME || "示例企业"]);
      await client.query("insert into subsidiaries (id,company_id,name) values ($1,$2,$3)", [subsidiaryId, companyId, process.env.BOOTSTRAP_SUBSIDIARY_NAME || "总部"]);
      await client.query("insert into employees (employee_no,subsidiary_id,name,password_hash,is_super_admin) values ($1,$2,$3,$4,true)", [employeeNo, subsidiaryId, name, `${salt}:${hash.toString("hex")}`]);
      console.log(`超级管理员 ${employeeNo} 已创建。初始企业与子公司已创建。`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
