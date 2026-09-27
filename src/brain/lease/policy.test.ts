import { describe, expect, it } from "vitest"
import { withoutAudienceBoundConnections } from "./policy"

const env = { AUDIENCE_MCP_HOSTS: "wiki.example.com" } as Env

describe("lease owners", () => {
	it("never lends a connection to an audience-bound server", () => {
		const rows = [
			{ userId: "u1", serverUrl: "https://wiki.example.com/mcp" },
			{ userId: "u2", serverUrl: "https://mcp.linear.app/mcp" },
			{ userId: "u3", serverUrl: null },
		]
		expect(withoutAudienceBoundConnections(env, rows).map((r) => r.userId)).toEqual([
			"u2",
			"u3",
		])
	})

	it("matches by URL, not by the user-chosen slug", () => {
		const rows = [{ userId: "u1", serverSlug: "linear", serverUrl: "https://wiki.example.com/x" }]
		expect(withoutAudienceBoundConnections(env, rows)).toEqual([])
	})

	it("changes nothing when AUDIENCE_MCP_HOSTS is unset", () => {
		const rows = [{ userId: "u1", serverUrl: "https://wiki.example.com/mcp" }]
		expect(withoutAudienceBoundConnections({} as Env, rows)).toEqual(rows)
	})
})
