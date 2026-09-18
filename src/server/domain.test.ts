import { describe, expect, it } from "vitest";
import { calculateFinalScore, validateIndicatorTree } from "./domain";

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
