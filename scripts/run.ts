#!/usr/bin/env bun

/**
 * Parallel evaluation runner for web search agents
 *
 * @remarks
 * Runs multiple agent × search provider combinations in parallel using Docker Compose.
 * Each combination is executed as a separate scenario with isolated output and status tracking.
 *
 * ## Execution Model
 *
 * The script creates an agent × search provider matrix and runs each combination:
 * - **Agents**: claude-code, gemini, droid, codex
 * - **Search Providers**: builtin (no MCP) or MCP servers (you, exa, etc.)
 * - **Modes**: test (5 prompts) or full (151 prompts)
 *
 * Each scenario runs in a separate Docker container with isolated environment variables:
 * ```bash
 * docker compose run --rm \
 *   -e SEARCH_PROVIDER=you \
 *   -e DATASET=test \
 *   claude-code
 * ```
 *
 * ## Output Format
 *
 * Results are written to `data/results/[mode]/` with naming pattern:
 * ```
 * results-[agent]-[search-provider].jsonl
 * ```
 *
 * ## Status Reporting
 *
 * Each scenario logs:
 * - Start/completion timestamps with duration
 * - Real-time stdout/stderr from Docker containers
 * - Exit codes with visual indicators (✓ success, ✗ failure)
 * - Summary report of all scenarios at the end
 *
 * ## Error Handling
 *
 * - Non-zero exit codes are reported but don't stop other scenarios
 * - All scenarios run to completion regardless of failures
 * - Final exit code reflects worst outcome (0 = all pass, >0 = any failed)
 *
 * Usage:
 *   bun scripts/run.ts                                    # All agents, current mode (default: unlimited containers, sequential prompts)
 *   bun scripts/run.ts --agent claude-code                # Single agent
 *   bun scripts/run.ts --mode test                        # Test mode (5 prompts)
 *   bun scripts/run.ts --search-provider you              # Specific MCP server
 *   bun scripts/run.ts -j 4                               # 4 containers in parallel
 *   bun scripts/run.ts -j 0                               # Unlimited container parallelism
 *   bun scripts/run.ts --prompt-concurrency 8             # 8 prompts per container
 *   bun scripts/run.ts -j 2 --prompt-concurrency 4        # Custom both levels
 *   bun scripts/run.ts --dry-run                          # Show what would run
 *
 * @public
 */

import { join } from "node:path";
import { MCP_SERVERS, type McpServerKey } from "../mcp-servers.ts";
import type { Mode, RunConfig, SearchProvider } from "./shared/shared.types.ts";
import { limitConcurrency } from "./shared/concurrency-limiter.ts";
import { runDockerScenario } from "./shared/docker-runner.ts";
import { createStatusHeartbeat, printResultsSummary, handleExit } from "./shared/reporting.ts";
import { parseCommonArgs } from "./shared/args.ts";

const detectCurrentMode = async (): Promise<Mode> => {
  // Check TypeScript entrypoint for DATASET variable default
  const entrypointFile = join(process.cwd(), "docker", "entrypoint");
  const content = await Bun.file(entrypointFile).text();

  const datasetMatch = content.match(/const DATASET = process\.env\.DATASET \|\| "(\w+)"/);
  if (datasetMatch?.[1]) {
    return datasetMatch[1] as Mode;
  }

  // Fallback: check for test or full patterns in prompt paths
  if (content.includes(`/eval/data/prompts/\${DATASET}.jsonl`) || content.includes("prompts/test.jsonl")) {
    return "test";
  }
  if (content.includes("prompts/full.jsonl")) {
    return "full";
  }
  throw new Error("Could not detect current mode from docker/entrypoint");
};

const main = async () => {
  const args = process.argv.slice(2);

  try {
    const options = parseCommonArgs(args);

    // Apply defaults logic that was in parseArgs
    const concurrency = options.concurrency ?? Infinity;
    const promptConcurrency = options.promptConcurrency ?? 1;

    if (options.dryRun) {
      console.log("[DRY RUN] Validation mode - no docker commands will run\n");
    }

    // Determine dataset mode (use override if provided, otherwise detect from entrypoint default)
    const currentMode = options.mode || (await detectCurrentMode());

    console.log(`${options.dryRun ? "[DRY RUN] " : ""}Running in ${currentMode} mode`);
    console.log(`Agents: ${options.agents.join(", ")}`);

    // Determine which search providers to test
    const mcpProviders = Object.keys(MCP_SERVERS) as McpServerKey[];
    const searchProviders: SearchProvider[] = options.searchProvider
      ? [options.searchProvider]
      : ["builtin", ...mcpProviders];
    console.log(`Search providers: ${searchProviders.join(", ")}`);
    console.log("");

    // Build execution list (each agent runs with each search provider)
    const runs: RunConfig[] = [];
    for (const agent of options.agents) {
      for (const provider of searchProviders) {
        runs.push({ agent, searchProvider: provider });
      }
    }

    const concurrencyLabel = concurrency === Infinity ? "unlimited" : concurrency;
    console.log(
      `${options.dryRun ? "[DRY RUN] Would run" : "Running"} ${runs.length} scenarios (container concurrency: ${concurrencyLabel}, prompt concurrency: ${promptConcurrency})\n`,
    );

    if (options.dryRun) {
      console.log("[DRY RUN] Execution plan:");
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (!run) continue;
        console.log(
          `  [${i + 1}/${runs.length}] ${run.agent}-${run.searchProvider}: docker compose run --rm -e SEARCH_PROVIDER=${run.searchProvider
          } -e DATASET=${currentMode} -e PROMPT_CONCURRENCY=${promptConcurrency} ${run.agent}`,
        );
      }
      console.log("\n[DRY RUN] No services were executed.");
      process.exit(0);
    }

    // Track completion status
    const completed = new Set<number>();
    const startTime = Date.now();

    const statusInterval = createStatusHeartbeat({
      runs,
      completed,
      concurrency,
      intervalMs: 30000,
      startTime,
    });

    // Run all scenarios with controlled concurrency
    const results = await limitConcurrency(
      runs.map(
        ({ agent, searchProvider }, index) =>
          () =>
            runDockerScenario({
              agent,
              searchProvider,
              envVars: [
                "-e",
                `SEARCH_PROVIDER=${searchProvider}`,
                "-e",
                `DATASET=${currentMode}`,
                "-e",
                `PROMPT_CONCURRENCY=${promptConcurrency}`,
              ],
              label: `[${index + 1}/${runs.length}] ${agent}-${searchProvider}`,
            }).then((result) => {
              completed.add(index + 1);
              return result.exitCode;
            }),
      ),
      concurrency,
    );

    clearInterval(statusInterval);

    const { failures } = printResultsSummary({ runs, results, startTime });
    await handleExit(failures);
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
};

main();
