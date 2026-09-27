import Supermemory from "supermemory"
import { memoryWritesDisabled } from "./write-switch"

const clients = new WeakMap<object, Supermemory>()

/**
 * The brain's memory lives in supermemory, reached through the public API.
 * One client per Env so connections and config are reused across a request.
 */
export function memoryClient(env: Env): Supermemory {
	const existing = clients.get(env as unknown as object)
	if (existing) return existing
	if (!env.SUPERMEMORY_API_KEY) {
		throw new Error(
			"SUPERMEMORY_API_KEY is not set — the brain has nowhere to read or write memory.",
		)
	}
	const base = new Supermemory({ apiKey: env.SUPERMEMORY_API_KEY })
	const client = memoryWritesDisabled(env) ? readOnlyMemoryClient(base) : base
	clients.set(env as unknown as object, client)
	return client
}

// Write methods skipped under BRAIN_MEMORY_WRITES=off. Reads and deletes
// (documents.delete/deleteBulk, memories.forget) go through unchanged.
const SKIPPED_WRITES: Record<string, ReadonlySet<string>> = {
	"": new Set(["add", "patch", "put"]),
	documents: new Set(["add", "batchAdd", "update", "uploadFile"]),
	memories: new Set(["updateMemory"]),
	settings: new Set(["update"]),
}

function skippedWrite(path: string): Promise<{ id: string; status: string }> {
	console.log(`[memory] write skipped (BRAIN_MEMORY_WRITES=off): ${path}`)
	return Promise.resolve({ id: "", status: "skipped" })
}

function readOnlyProxy<T extends object>(target: T, resource: string): T {
	return new Proxy(target, {
		get(obj, prop, receiver) {
			const value = Reflect.get(obj, prop, receiver)
			if (typeof prop !== "string") return value
			if (SKIPPED_WRITES[resource]?.has(prop) && typeof value === "function") {
				return () => skippedWrite(resource ? `${resource}.${prop}` : prop)
			}
			if (resource === "" && prop in SKIPPED_WRITES && value && typeof value === "object") {
				return readOnlyProxy(value as object, prop)
			}
			return typeof value === "function" ? value.bind(obj) : value
		},
	})
}

function readOnlyMemoryClient(client: Supermemory): Supermemory {
	return readOnlyProxy(client, "")
}
