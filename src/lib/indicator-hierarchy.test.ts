import { describe, expect, it } from "vitest";
import { buildIndicatorNodes, validateIndicatorHierarchy } from "./indicator-hierarchy";

describe("indicator hierarchy", () => {
  it("accepts the one-level 100-point template and creates its hidden root", () => {
    const groups = [
      { name: "基础业务", description: "完成基础人事工作", scoringRule: "按时完成得 25 分", maxScore: "25", children: [] },
      { name: "人才引进", description: "支持招聘", scoringRule: "完成目标得 30 分", maxScore: "30", children: [] },
      { name: "数据治理", description: "维护数据", scoringRule: "符合要求得 20 分", maxScore: "20", children: [] },
      { name: "能力提升", description: "协同考核", scoringRule: "完成得 25 分", maxScore: "25", children: [] },
    ];

    expect(validateIndicatorHierarchy(groups)).toEqual([]);
    expect(buildIndicatorNodes(groups)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeCode: "R", parentCode: null, maxScore: 100 }),
      expect.objectContaining({ nodeCode: "L1", parentCode: "R", name: "基础业务", maxScore: 25 }),
    ]));
  });

  it("requires first-level scores to total 100", () => {
    const groups = [{ name: "工作业绩", description: "", scoringRule: "", maxScore: "80", children: [] }];
    expect(validateIndicatorHierarchy(groups)).toContain("一级指标分值合计应为 100 分，当前为 80 分");
  });

  it("requires second-level scores to equal their first-level score", () => {
    const groups = [{ name: "招聘管理", description: "", scoringRule: "", maxScore: "100", children: [
      { name: "候选人寻访", description: "", scoringRule: "", maxScore: "40" },
      { name: "入职转化", description: "", scoringRule: "", maxScore: "50" },
    ] }];
    expect(validateIndicatorHierarchy(groups)).toContain("“招聘管理”的二级指标分值合计应为 100 分，当前为 90 分");
  });
});
