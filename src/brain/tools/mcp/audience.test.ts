import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"
import { encryptToken } from "@/lib/crypto"
import {
	audienceHeaders,
	isAudienceBoundServer,
	type SlackAudience,
	withoutReservedHeaders,
} from "./audience"
import { connectMcpClient } from "./client"
import type { McpConnectionRow } from "./store"

const env = {
	AUDIENCE_MCP_HOSTS: "wiki.example.com, other-wiki.example.org",
	ENCRYPTION_SECRET: "test-secret-with-enough-length-0123456789",
} as unknown as Env

const channelAudience: SlackAudience = {
	surface: "public_channel",
	channelId: "CGERAL",
	slackUserId: "U01ANA",
}

describe("audience headers", () => {
	it("only applies to hosts listed in AUDIENCE_MCP_HOSTS", () => {
		expect(isAudienceBoundServer(env, "https://wiki.example.com/mcp")).toBe(true)
		expect(isAudienceBoundServer(env, "https://WIKI.example.com/mcp")).toBe(true)
		expect(isAudienceBoundServer(env, "https://other-wiki.example.org/x")).toBe(true)
		expect(isAudienceBoundServer(env, "https://mcp.linear.app/mcp")).toBe(false)
		expect(isAudienceBoundServer(env, "https://wiki.example.com.evil.io/mcp")).toBe(false)
		expect(isAudienceBoundServer(env, null)).toBe(false)
		expect(isAudienceBoundServer(env, "not a url")).toBe(false)
		expect(isAudienceBoundServer({} as Env, "https://wiki.example.com/mcp")).toBe(false)
	})

	it("builds the headers from the audience", () => {
		expect(audienceHeaders(env, "https://wiki.example.com/mcp", channelAudience)).toEqual({
			"X-Brain-Surface": "public_channel",
			"X-Slack-Channel": "CGERAL",
			"X-Slack-User": "U01ANA",
		})
		expect(audienceHeaders(env, "https://wiki.example.com/mcp", { surface: "dm" })).toEqual({
			"X-Brain-Surface": "dm",
		})
	})

	it("sends nothing to other servers or without a Slack audience", () => {
		expect(audienceHeaders(env, "https://mcp.linear.app/mcp", channelAudience)).toEqual({})
		expect(audienceHeaders(env, "https://wiki.example.com/mcp", undefined)).toEqual({})
	})

	it("strips user-set audience headers only on audience-bound servers", () => {
		const extras: Array<[string, string]> = [
			["x-brain-surface", "dm"],
			["X-Slack-Channel", "CFAKE"],
			["X-Tenant", "acme"],
		]
		expect(withoutReservedHeaders(env, "https://wiki.example.com/mcp", extras)).toEqual([
			["X-Tenant", "acme"],
		])
		expect(withoutReservedHeaders(env, "https://mcp.linear.app/mcp", extras)).toEqual(extras)
	})
})

// A fake MCP server behind a stubbed fetch: answers initialize and tools/list,
// and records the headers of every request the SDK transport sends.
const realFetch = globalThis.fetch

function stubMcpServer() {
	const seen: Headers[] = []
	globalThis.fetch = (async (_url: URL | string, init?: RequestInit) => {
			const headers = new Headers(init?.headers)
			seen.push(headers)
			if ((init?.method ?? "GET") === "GET") return new Response(null, { status: 405 })
			const body = JSON.parse(String(init?.body))
			if (body.id === undefined) return new Response(null, { status: 202 })
			const result =
				body.method === "initialize"
					? {
							protocolVersion: LATEST_PROTOCOL_VERSION,
							capabilities: { tools: {} },
							serverInfo: { name: "wiki", version: "1" },
						}
					: { tools: [] }
			return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
	}) as typeof fetch
	return seen
}

async function staticConnection(
	serverUrl: string,
	extraHeaders: Record<string, string> = {},
): Promise<McpConnectionRow> {
	return {
		id: "conn-1",
		orgId: "org-1",
		userId: "user-1",
		runtime: "remote_mcp",
		serverSlug: "company-wiki",
		serverUrl,
		googleWorkspaceGrantId: null,
		transport: "http",
		authType: "static",
		status: "active",
		accessToken: await encryptToken("cbk_personal", env.ENCRYPTION_SECRET),
		refreshToken: null,
		expiresAt: null,
		scopes: null,
		metadata: { extraHeaders },
		createdAt: new Date(),
		updatedAt: new Date(),
	} as McpConnectionRow
}

describe("connectMcpClient audience context", () => {
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	it("sends the harness audience to the wiki, overriding user-set headers", async () => {
		const seen = stubMcpServer()
		const conn = await staticConnection("https://wiki.example.com/mcp", {
			"x-brain-surface": "dm",
			"X-Slack-User": "UOTHER",
		})
		const handle = await connectMcpClient(env, conn, "https://brain/cb", channelAudience)
		await handle.client.listTools()
		await handle.close()

		const posts = seen.filter((h) => h.get("content-type")?.includes("json"))
		expect(posts.length).toBeGreaterThanOrEqual(2)
		for (const h of posts) {
			expect(h.get("x-brain-surface")).toBe("public_channel")
			expect(h.get("x-slack-channel")).toBe("CGERAL")
			expect(h.get("x-slack-user")).toBe("U01ANA")
			expect(h.get("authorization")).toBe("Bearer cbk_personal")
		}
	})

	it("sends no audience (and ignores a user-set 'dm') outside Slack turns", async () => {
		const seen = stubMcpServer()
		const conn = await staticConnection("https://wiki.example.com/mcp", {
			"X-Brain-Surface": "dm",
		})
		const handle = await connectMcpClient(env, conn, "https://brain/cb", undefined)
		await handle.client.listTools()
		await handle.close()
		for (const h of seen) {
			expect(h.get("x-brain-surface")).toBeNull()
			expect(h.get("x-slack-user")).toBeNull()
		}
	})

	it("never sends Slack ids to other MCP servers", async () => {
		const seen = stubMcpServer()
		const conn = await staticConnection("https://mcp.example.net/mcp", { "X-Tenant": "acme" })
		const handle = await connectMcpClient(env, conn, "https://brain/cb", channelAudience)
		await handle.client.listTools()
		await handle.close()
		for (const h of seen) {
			expect(h.get("x-brain-surface")).toBeNull()
			expect(h.get("x-slack-channel")).toBeNull()
			expect(h.get("x-slack-user")).toBeNull()
		}
		expect(seen.some((h) => h.get("x-tenant") === "acme")).toBe(true)
	})
})
