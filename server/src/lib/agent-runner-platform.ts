import { execFileSync } from "node:child_process";
import { paperclipRunnerSupportsPlatform } from "@paperclipai/shared";

type LocalRunnerTarget = {
  driver: "local";
  platform: NodeJS.Platform;
  architecture: string;
  libc?: "glibc" | "unknown";
  glibcVersion?: string;
};

// Synchronous on purpose: an asynchronous probe's 1 s timer races the rest of server startup.
// When module evaluation blocks the event loop for over a second, the timer fires before the
// child's exit is handled, getconf is killed, and libc stays "unknown" until the next restart.
function detectLocalRunnerTarget(): LocalRunnerTarget {
  const target: LocalRunnerTarget = {
    driver: "local", platform: process.platform, architecture: process.arch,
  };
  if (target.platform !== "linux") return target;
  target.libc = "unknown";
  try {
    const stdout = execFileSync("getconf", ["GNU_LIBC_VERSION"], {
      encoding: "utf8", timeout: 1_000, killSignal: "SIGKILL", maxBuffer: 1_024, stdio: ["ignore", "pipe", "ignore"],
    });
    const version = /^glibc\s+(\d+\.\d+(?:\.\d+)?)$/.exec(stdout.trim())?.[1];
    if (version) {
      target.libc = "glibc";
      target.glibcVersion = version;
    }
  } catch {}
  return target;
}

const localTarget = detectLocalRunnerTarget();

export function localAgentRunnerTarget(): LocalRunnerTarget {
  return { ...localTarget };
}

export function localPaperclipRunnerSupported(): boolean {
  const target = localAgentRunnerTarget();
  return paperclipRunnerSupportsPlatform("codex_local", target.platform, target.architecture, target.libc, target.glibcVersion);
}
