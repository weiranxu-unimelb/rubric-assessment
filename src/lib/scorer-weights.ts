export const EMPLOYEE_RANKS = ["EMPLOYEE", "DEPUTY_GENERAL_MANAGER", "GENERAL_MANAGER"] as const;
export type EmployeeRank = typeof EMPLOYEE_RANKS[number];

export const rankLabels: Record<EmployeeRank, string> = {
  EMPLOYEE: "员工",
  DEPUTY_GENERAL_MANAGER: "副总经理",
  GENERAL_MANAGER: "总经理",
};

export type RankFactors = Record<EmployeeRank, number>;
export const DEFAULT_RANK_FACTORS: RankFactors = {
  GENERAL_MANAGER: 3,
  DEPUTY_GENERAL_MANAGER: 2,
  EMPLOYEE: 1,
};

export function calculateRankWeights(
  scorers: { employeeNo: string; rank: EmployeeRank }[],
  factors: RankFactors,
): number[] {
  if (!scorers.length || scorers.length > 20 || new Set(scorers.map((person) => person.employeeNo)).size !== scorers.length) {
    throw new Error("请选择 1–20 位不同的打分人");
  }
  if (EMPLOYEE_RANKS.some((rank) => !Number.isInteger(factors[rank]) || factors[rank] < 1 || factors[rank] > 100)) {
    throw new Error("职级系数必须是 1–100 的整数");
  }
  const units = scorers.map((person) => factors[person.rank]);
  if (units.some((unit) => unit === undefined)) throw new Error("打分人职级无效");
  const total = units.reduce((sum, unit) => sum + unit, 0);
  const cents = units.map((unit) => Math.floor(unit * 10_000 / total));
  const remainder = 10_000 - cents.reduce((sum, value) => sum + value, 0);
  const byFraction = scorers.map((person, index) => ({
    index,
    employeeNo: person.employeeNo,
    fraction: units[index] * 10_000 % total,
  })).sort((left, right) => right.fraction - left.fraction || left.employeeNo.localeCompare(right.employeeNo, "en"));
  for (let i = 0; i < remainder; i++) cents[byFraction[i].index]++;
  return cents.map((value) => value / 100);
}
