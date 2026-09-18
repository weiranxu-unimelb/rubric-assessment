import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./origin";

describe("isAllowedOrigin", () => {
  const appOrigin = "http://localhost:3000";

  it("accepts the browser origin even when the server listens on 0.0.0.0", () => {
    expect(isAllowedOrigin("http://localhost:3000", appOrigin)).toBe(true);
  });

  it("rejects another origin, port, or scheme", () => {
    expect(isAllowedOrigin("http://example.com", appOrigin)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001", appOrigin)).toBe(false);
    expect(isAllowedOrigin("https://localhost:3000", appOrigin)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000.evil.example", appOrigin)).toBe(false);
  });

  it("preserves requests without an Origin header", () => {
    expect(isAllowedOrigin(null, appOrigin)).toBe(true);
  });

  it("fails closed when the public origin is missing or invalid", () => {
    expect(isAllowedOrigin("http://localhost:3000", undefined)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", "not-a-url")).toBe(false);
  });
});
