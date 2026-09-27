/**
 * BRAIN_MEMORY_WRITES=off turns the brain's supermemory memory read-only.
 *
 * For deployments where another system is the source of truth (e.g. a
 * company wiki reached over MCP) and Slack content must not be copied into
 * supermemory. Reads keep working, and so does forgetting (deletes). Every
 * write is skipped: turn writeback, channel observation, history import,
 * interaction-style notes, entity cache and container settings.
 */
export function memoryWritesDisabled(env: Pick<Env, "BRAIN_MEMORY_WRITES">): boolean {
	return (env.BRAIN_MEMORY_WRITES ?? "").trim().toLowerCase() === "off"
}
