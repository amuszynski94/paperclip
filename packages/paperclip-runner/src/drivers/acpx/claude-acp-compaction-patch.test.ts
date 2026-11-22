import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Regression guard for the patched @agentclientprotocol/claude-agent-acp (0.73.0).
// Its `compact_boundary` handler used to await a `getContextUsage` control
// request inside the SDK message loop. After a mid-turn auto-compaction the
// request was never answered, the loop stopped consuming SDK messages and the
// prompt turn stalled until the runner's connection lease killed the run
// (about 60 minutes later). The patch reads `compact_metadata.post_tokens`
// instead, like upstream 0.109.
const require = createRequire(import.meta.url);

function compactBoundaryHandler(): string {
  const source = readFileSync(
    require.resolve("@agentclientprotocol/claude-agent-acp/dist/acp-agent.js"),
    "utf8",
  );
  const start = source.indexOf('case "compact_boundary": {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('case "local_command_output":', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("claude-agent-acp compaction patch", () => {
  it("does not block the message loop on getContextUsage after compaction", () => {
    const handler = compactBoundaryHandler();
    expect(handler).not.toMatch(/fetchContextUsedTokens\s*\(/);
    expect(handler).not.toMatch(/getContextUsage\s*\(/);
  });

  it("takes the retained context size from the boundary frame", () => {
    expect(compactBoundaryHandler()).toContain("compact_metadata?.post_tokens");
  });
});
