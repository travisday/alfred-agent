import { execFileSync } from "node:child_process";
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const BLOCKS_MARKER = "=== BLOCKS (always-on context) ===";

type BaseLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];

function runMemoryLoader(scriptPath: string): string {
  try {
    const memoryRoot = process.env.ALFRED_MEMORY_ROOT?.trim() || "/alfred";
    const out = execFileSync(scriptPath, {
      encoding: "utf8",
      maxBuffer: 2_000_000,
      env: { ...process.env, ALFRED_MEMORY_ROOT: memoryRoot },
    });
    return out.trim();
  } catch (err) {
    console.warn("[Discord bridge] memory-loader.sh failed:", err);
    return "";
  }
}

/**
 * Appends fresh `blocks/*.yaml` output every time Pi builds the system prompt
 * (after {@link AgentSession.setActiveToolsByName} or initial session build).
 */
export class AlfredDiscordResourceLoader extends DefaultResourceLoader {
  private readonly memoryLoaderPath: string;

  constructor(options: BaseLoaderOptions & { memoryLoaderPath: string }) {
    const { memoryLoaderPath, ...rest } = options;
    super(rest);
    this.memoryLoaderPath = memoryLoaderPath;
  }

  getAppendSystemPrompt(): string[] {
    const base = super.getAppendSystemPrompt();
    const mem = runMemoryLoader(this.memoryLoaderPath);
    const withoutStaleBlocks = base.filter((s) => !s.includes(BLOCKS_MARKER));
    return mem ? [...withoutStaleBlocks, mem] : withoutStaleBlocks;
  }
}
