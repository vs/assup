import { describe, it, expect } from "vitest";
import { refreshUpdatesSchema } from "@assup/shared";

describe("refreshUpdatesSchema", () => {
  it.each(["positions", "orders", "allocation", "all"])("accepts %s", (type) => {
    expect(refreshUpdatesSchema.parse({ type })).toEqual({ type });
  });

  it.each([{}, { type: "position" }, { type: "ALL" }, { type: 1 }])("rejects %j", (body) => {
    const result = refreshUpdatesSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('"positions", "orders", "allocation", "all"');
    }
  });
});
