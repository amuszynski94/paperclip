import { describe, expect, it } from "vitest";
import { isCodexLocalKnownModel, isCodexLocalManualModel, models } from "./index.js";

describe("codex local adapter metadata", () => {
  it("advertises GPT-5.6 Sol as a built-in model", () => {
    expect(models).toContainEqual({ id: "gpt-5.6-sol", label: "gpt-5.6-sol" });
    expect(isCodexLocalKnownModel("gpt-5.6-sol")).toBe(true);
    expect(isCodexLocalManualModel("gpt-5.6-sol")).toBe(false);
  });
});
