import { afterEach, describe, expect, it } from "vitest"
import { memoryClient } from "./client"
import { memoryWritesDisabled } from "./write-switch"

const realFetch = globalThis.fetch
const calls: string[] = []

function recordFetch() {
	calls.length = 0
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		calls.push(`${(init?.method ?? "GET").toUpperCase()} ${new URL(url).pathname}`)
		return new Response(JSON.stringify({ id: "doc-1", status: "queued" }), {
			status: 200,
			headers: { "content-type": "application/json" },
		})
	}) as typeof fetch
}

const envFor = (writes?: string) =>
	({ SUPERMEMORY_API_KEY: "sm_test", BRAIN_MEMORY_WRITES: writes }) as unknown as Env

describe("BRAIN_MEMORY_WRITES", () => {
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	it("is off only when set to off", () => {
		expect(memoryWritesDisabled(envFor("off"))).toBe(true)
		expect(memoryWritesDisabled(envFor(" OFF "))).toBe(true)
		expect(memoryWritesDisabled(envFor())).toBe(false)
		expect(memoryWritesDisabled(envFor("on"))).toBe(false)
	})

	it("skips every write without calling supermemory", async () => {
		recordFetch()
		const client = memoryClient(envFor("off"))
		expect(await client.documents.add({ content: "x" })).toEqual({ id: "", status: "skipped" })
		await client.documents.update("doc-1", { metadata: { a: "b" } })
		await client.patch("/v3/container-tags/sm_org_shared", { body: {} })
		await client.memories.updateMemory({ containerTag: "t", newContent: "x" } as never)
		await client.add({ content: "x" })
		expect(calls).toEqual([])
	})

	it("still lets the brain forget (deletes go through)", async () => {
		recordFetch()
		const client = memoryClient(envFor("off"))
		await client.documents.delete("doc-1")
		expect(calls).toEqual(["DELETE /v3/documents/doc-1"])
	})

	it("writes normally when the switch is not set", async () => {
		recordFetch()
		const client = memoryClient(envFor())
		await client.documents.add({ content: "x" })
		expect(calls).toEqual(["POST /v3/documents"])
	})
})
