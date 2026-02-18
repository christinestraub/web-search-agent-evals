import { MCP_SERVERS } from "../../mcp-servers.ts";
import { ALL_AGENTS } from "./shared.constants.ts";
import type { Agent, Mode, SearchProvider } from "./shared.types.ts";

export type CommonOptions = {
    agents: Agent[];
    mode?: Mode;
    searchProvider?: SearchProvider;
    concurrency?: number;
    promptConcurrency?: number;
    dryRun?: boolean;
};

export const parseCommonArgs = (args: string[]): CommonOptions => {
    const agents: Agent[] = [];
    let mode: Mode | undefined;
    let searchProvider: SearchProvider | undefined;
    let concurrency: number | undefined;
    let promptConcurrency: number | undefined;
    let dryRun = false;

    const validProviders = ["builtin", ...Object.keys(MCP_SERVERS)];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--agent" && i + 1 < args.length) {
            const agent = args[i + 1];
            if (!ALL_AGENTS.includes(agent as Agent)) {
                throw new Error(`Invalid agent: ${agent}. Must be one of: ${ALL_AGENTS.join(", ")}`);
            }
            agents.push(agent as Agent);
            i++;
        } else if (args[i] === "--mode" && i + 1 < args.length) {
            const m = args[i + 1];
            if (m !== "test" && m !== "full") {
                throw new Error(`Invalid mode: ${m}. Must be "test" or "full"`);
            }
            mode = m;
            i++;
        } else if ((args[i] === "--search-provider" || args[i] === "--mcp") && i + 1 < args.length) {
            const tool = args[i + 1];
            if (!validProviders.includes(tool as string)) {
                throw new Error(`Invalid search provider: ${tool}. Must be one of: ${validProviders.join(", ")}`);
            }
            searchProvider = tool as SearchProvider;
            i++;
        } else if ((args[i] === "-j" || args[i] === "--concurrency") && i + 1 < args.length) {
            const arg = args[i + 1];
            if (!arg) throw new Error("Missing value for concurrency flag");

            const value = Number.parseInt(arg, 10);
            if (Number.isNaN(value) || value < 0) {
                throw new Error(`Invalid concurrency: ${arg}. Must be a non-negative integer (0 for unlimited)`);
            }
            concurrency = value === 0 ? Infinity : value;
            i++;
        } else if (args[i] === "--prompt-concurrency" && i + 1 < args.length) {
            const arg = args[i + 1];
            if (!arg) throw new Error("Missing value for prompt-concurrency flag");

            const value = Number.parseInt(arg, 10);
            if (Number.isNaN(value) || value < 1) {
                throw new Error(`Invalid prompt-concurrency: ${arg}. Must be a positive integer`);
            }
            promptConcurrency = value;
            i++;
        } else if (args[i] === "--dry-run") {
            dryRun = true;
        }
    }

    return {
        agents: agents.length > 0 ? agents : ALL_AGENTS,
        mode,
        searchProvider,
        concurrency,
        promptConcurrency,
        dryRun,
    };
};
