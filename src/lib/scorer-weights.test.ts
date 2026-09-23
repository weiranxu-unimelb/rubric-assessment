import { describe, expect, it } from "vitest";
import { calculateRankWeights } from "./scorer-weights";

const preset = { GENERAL_MANAGER: 3, DEPUTY_GENERAL_MANAGER: 2, EMPLOYEE: 1 } as const;

describe("calculateRankWeights", () => {
  it("applies department factors to the selected scorer counts", () => {
    const result = calculateRankWeights([
      { employeeNo: "G1", rank: "GENERAL_MANAGER" },
      { employeeNo: "D1", rank: "DEPUTY_GENERAL_MANAGER" },
      { employeeNo: "D2", rank: "DEPUTY_GENERAL_MANAGER" },
      { employeeNo: "E1", rank: "EMPLOYEE" },
      { employeeNo: "E2", rank: "EMPLOYEE" },
      { employeeNo: "E3", rank: "EMPLOYEE" },
    ], preset);
    expect(result).toEqual([30, 20, 20, 10, 10, 10]);
  });

  it("assigns unavoidable hundredth remainders deterministically", () => {
    const result = calculateRankWeights([
      { employeeNo: "E3", rank: "EMPLOYEE" },
      { employeeNo: "E1", rank: "EMPLOYEE" },
      { employeeNo: "E2", rank: "EMPLOYEE" },
    ], preset);
    expect(result).toEqual([33.33, 33.34, 33.33]);
  });

  it("rejects invalid factors and duplicate scorers", () => {
    expect(() => calculateRankWeights([{ employeeNo: "E1", rank: "EMPLOYEE" }], { ...preset, EMPLOYEE: 0 })).toThrow();
    expect(() => calculateRankWeights([{ employeeNo: "E1", rank: "EMPLOYEE" }, { employeeNo: "E1", rank: "EMPLOYEE" }], preset)).toThrow();
  });
});
