import { describe, expect, it } from "vitest";
import { calculateFinalScore, calculateWeightedFinalScore, distributeScorerWeights, validateIndicatorTree, validateScorerWeights } from "./domain";

describe("validateIndicatorTree", () => {
  it("accepts a nested 100-point tree", () => {
    const errors = validateIndicatorTree([
      { id: "root", parentId: null, name: "考核", maxScore: 100 },
      { id: "a", parentId: "root", name: "业绩", maxScore: 60 },
      { id: "b", parentId: "root", name: "协作", maxScore: 40 },
      { id: "a1", parentId: "a", name: "销售", maxScore: 60 },
    ]);
    expect(errors).toEqual([]);
  });

  it("reports the node with an incorrect child total", () => {
    const errors = validateIndicatorTree([
      { id: "root", parentId: null, name: "考核", maxScore: 100 },
      { id: "a", parentId: "root", name: "业绩", maxScore: 60 },
    ]);
    expect(errors).toContain("考核：子项满分合计应为 100，实际为 60");
  });

  it("rejects cycles and duplicate nodes", () => {
    expect(validateIndicatorTree([
      { id: "root", parentId: null, name: "考核", maxScore: 100 },
      { id: "a", parentId: "b", name: "A", maxScore: 50 },
      { id: "b", parentId: "a", name: "B", maxScore: 50 },
      { id: "a", parentId: "root", name: "A2", maxScore: 50 },
    ])).toEqual(expect.arrayContaining([expect.stringContaining("重复"), expect.stringContaining("循环")]));
  });
});

describe("calculateFinalScore", () => {
  it("averages all submitted scorer totals to two decimals", () => {
    expect(calculateFinalScore([76, 81, 83])).toBe(80);
    expect(calculateFinalScore([80, 81, 82])).toBe(81);
  });

  it("rejects missing or invalid scores", () => {
    expect(() => calculateFinalScore([])).toThrow();
    expect(() => calculateFinalScore([101])).toThrow();
  });
});

describe("scorer weights", () => {
  it("distributes an exact 100 percent across multiple scorers", () => {
    expect(distributeScorerWeights(1)).toEqual([100]);
    expect(distributeScorerWeights(3)).toEqual([33.34, 33.33, 33.33]);
  });

  it("requires positive two-decimal weights totaling exactly 100", () => {
    expect(validateScorerWeights([50, 30, 20])).toEqual([]);
    expect(validateScorerWeights([33.33, 33.33, 33.33])).toContain("打分人权重合计必须为 100.00，当前为 99.99");
    expect(validateScorerWeights([100.001])).toContain("打分人权重最多保留两位小数");
    expect(validateScorerWeights([0, 100])).toContain("每位打分人的权重必须大于 0 且不超过 100");
  });

  it("calculates the final score from frozen scorer weights", () => {
    expect(calculateWeightedFinalScore([
      { score: 90, weight: 50 },
      { score: 80, weight: 30 },
      { score: 95, weight: 20 },
    ])).toBe(88);
  });
});
