import { describe, expect, it } from "vitest"
import type { SlackAudience } from "./audience"
import {
	buildAmbientKnowledgeContext,
	cleanQuery,
	recallText,
} from "./ambient-kb"
import type { ToolProviderHandle } from "./provider"
import type { McpConnectionRow } from "./store"

const env = { AUDIENCE_MCP_HOSTS: "wiki.example.com" } as unknown as Env

const audience: SlackAudience = {
	surface: "public_channel",
	channelId: "CGERAL",
	slackUserId: "U01ANA",
}

function row(over: Partial<McpConnectionRow>): McpConnectionRow {
	return {
		id: "c1",
		orgId: "o1",
		userId: "u1",
		serverSlug: "company-wiki",
		serverUrl: "https://wiki.example.com/mcp",
		status: "active",
		metadata: { serverName: "Company Wiki" },
		...over,
	} as McpConnectionRow
}

type Call = { url: string | null; audience?: SlackAudience; tool: string; args: unknown }

function fakeConnect(result: unknown, calls: Call[], opts: { delayMs?: number; fail?: boolean } = {}) {
	return async (
		_env: Env,
		connection: McpConnectionRow,
		_cb: string,
		options: { audience?: SlackAudience },
	): Promise<ToolProviderHandle> => {
		if (opts.fail) throw new Error("connect refused")
		return {
			listTools: async () => [],
			callTool: async (name, args) => {
				calls.push({ url: connection.serverUrl, audience: options.audience, tool: name, args })
				if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
				return result
			},
			close: async () => {},
		}
	}
}

const hits = {
	content: [{ type: "text", text: '[{"slug":"projeto-atlas","titulo":"Projeto Atlas"}]' }],
}

describe("ambient knowledge-base recall", () => {
	it("searches audience-bound servers with the turn's audience, before the model", async () => {
		const calls: Call[] = []
		const out = await buildAmbientKnowledgeContext({
			env,
			connections: [row({}), row({ id: "c2", serverSlug: "linear", serverUrl: "https://mcp.linear.app/mcp" })],
			audience,
			query: "<@U0BOT> O que você sabe sobre o projeto atlas?",
			callbackUrl: "https://x/cb",
			traceId: "t",
			connect: fakeConnect(hits, calls),
		})
		expect(calls).toEqual([
			{
				url: "https://wiki.example.com/mcp",
				audience,
				tool: "buscar_notas",
				args: { consulta: "O que você sabe sobre o projeto atlas?" },
			},
		])
		expect(out).toContain('<knowledge_base_recall source="Company Wiki" tool="buscar_notas">')
		expect(out).toContain("projeto-atlas")
	})

	it("does nothing without a Slack audience, an audience-bound connection, or a request", async () => {
		const calls: Call[] = []
		const base = { env, callbackUrl: "x", traceId: "t", connect: fakeConnect(hits, calls) }
		expect(await buildAmbientKnowledgeContext({ ...base, connections: [row({})], audience: undefined, query: "atlas" })).toBeNull()
		expect(await buildAmbientKnowledgeContext({ ...base, connections: [row({ serverUrl: "https://other.io/mcp" })], audience, query: "atlas" })).toBeNull()
		expect(await buildAmbientKnowledgeContext({ ...base, connections: [row({ status: "error" })], audience, query: "atlas" })).toBeNull()
		expect(await buildAmbientKnowledgeContext({ ...base, connections: [row({})], audience, query: "<@U0BOT>" })).toBeNull()
		expect(calls).toEqual([])
	})

	it("passes the server's refusal through, so the model says nothing can be shown here", async () => {
		const refused = {
			isError: true,
			content: [{ type: "text", text: "Nada da base pode ser mostrado aqui." }],
		}
		const out = await buildAmbientKnowledgeContext({
			env, connections: [row({})], audience, query: "orion", callbackUrl: "x", traceId: "t",
			connect: fakeConnect(refused, []),
		})
		expect(out).toContain('status="refused"')
		expect(out).toContain("Nada da base pode ser mostrado aqui.")
	})

	it("is fail-soft: a slow or broken server is skipped", async () => {
		const base = { env, connections: [row({})], audience, query: "atlas", callbackUrl: "x", traceId: "t" }
		expect(await buildAmbientKnowledgeContext({ ...base, connect: fakeConnect(hits, [], { delayMs: 50 }), timeoutMs: 10 })).toBeNull()
		expect(await buildAmbientKnowledgeContext({ ...base, connect: fakeConnect(hits, [], { fail: true }) })).toBeNull()
	})

	it("can be turned off or pointed at another tool", async () => {
		const calls: Call[] = []
		const base = { connections: [row({})], audience, query: "atlas", callbackUrl: "x", traceId: "t", connect: fakeConnect(hits, calls) }
		expect(await buildAmbientKnowledgeContext({ ...base, env: { ...env, AUDIENCE_MCP_RECALL_TOOL: "off" } as Env })).toBeNull()
		await buildAmbientKnowledgeContext({
			...base,
			env: { ...env, AUDIENCE_MCP_RECALL_TOOL: "search", AUDIENCE_MCP_RECALL_ARG: "q" } as Env,
		})
		expect(calls.map((c) => [c.tool, c.args])).toEqual([["search", { q: "atlas" }]])
	})
})

describe("recall helpers", () => {
	it("cleans Slack markup from the request", () => {
		expect(cleanQuery("<@U0BOT|brain>  status do <#C123|teste-geral>?")).toBe("status do #teste-geral?")
	})

	it("reads text content, falling back to structured content", () => {
		expect(recallText(hits)).toEqual({ text: '[{"slug":"projeto-atlas","titulo":"Projeto Atlas"}]', isError: false })
		expect(recallText({ structuredContent: { result: [] } })).toEqual({ text: '{"result":[]}', isError: false })
	})
})
