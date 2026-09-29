/**
 * Ambient knowledge-base recall for audience-bound MCP servers.
 *
 * Supermemory gets an automatic recall before every Slack turn; a custom MCP
 * server is only a tool the model may or may not decide to call. For the
 * company wiki that is the wrong default: whether the answer is grounded in
 * the knowledge base would depend on the model's tool choice.
 *
 * This module makes the first lookup deterministic. Before the model runs,
 * each active connection to an audience-bound server (AUDIENCE_MCP_HOSTS) is
 * searched with the user's request, through the same client and the same
 * audience headers as a regular tool call. The server applies its own
 * permissions, so the recall can never show more than the tool would. The
 * result goes into the runtime context; the model can still call the
 * server's tools to read notes in full.
 *
 * Fail-soft: a slow or failing server is logged and skipped, and the turn
 * goes on without the recall (the tools stay available).
 */

import type { SlackAudience } from "./audience"
import { isAudienceBoundServer } from "./audience"
import { connectToolProvider, type ToolProviderHandle } from "./provider"
import type { McpConnectionRow } from "./store"

export const DEFAULT_RECALL_TOOL = "buscar_notas"
export const DEFAULT_RECALL_ARG = "consulta"
export const RECALL_TIMEOUT_MS = 5000
export const RECALL_MAX_CHARS = 6000
const MAX_SERVERS = 2

type RecallEnv = Pick<
	Env,
	"AUDIENCE_MCP_HOSTS" | "AUDIENCE_MCP_RECALL_TOOL" | "AUDIENCE_MCP_RECALL_ARG"
>

type Connect = (
	env: Env,
	connection: McpConnectionRow,
	callbackUrl: string,
	options: { audience?: SlackAudience },
) => Promise<ToolProviderHandle>

export type AmbientRecallArgs = {
	env: Env
	connections: readonly McpConnectionRow[]
	audience: SlackAudience | undefined
	query: string | undefined
	callbackUrl: string
	traceId: string
	connect?: Connect
	timeoutMs?: number
}

/** Active connections whose server enforces audience permissions. */
export function audienceBoundConnections(
	env: Pick<Env, "AUDIENCE_MCP_HOSTS">,
	connections: readonly McpConnectionRow[],
): McpConnectionRow[] {
	return connections.filter(
		(connection) =>
			connection.status === "active" &&
			isAudienceBoundServer(env, connection.serverUrl),
	)
}

/** Text of an MCP CallToolResult (content blocks, or structured content as JSON). */
export function recallText(result: unknown): { text: string; isError: boolean } {
	const r = (result ?? {}) as {
		content?: Array<{ type?: string; text?: string }>
		structuredContent?: unknown
		isError?: boolean
	}
	const parts = (r.content ?? [])
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
	let text = parts.join("\n").trim()
	if (!text && r.structuredContent !== undefined) {
		text = JSON.stringify(r.structuredContent)
	}
	return { text, isError: Boolean(r.isError) }
}

/** Slack markup out of the request: bot mentions go, channel links keep their name. */
export function cleanQuery(text: string | undefined): string {
	return (text ?? "")
		.replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/g, " ")
		.replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

function truncate(text: string): string {
	return text.length <= RECALL_MAX_CHARS
		? text
		: `${text.slice(0, RECALL_MAX_CHARS)}\n[... truncado]`
}

/**
 * Runtime-context block with the knowledge-base results for this request,
 * or null when there is nothing to add (no Slack audience, no audience-bound
 * connection, empty request, or every server failed).
 */
export async function buildAmbientKnowledgeContext(
	args: AmbientRecallArgs,
): Promise<string | null> {
	const query = cleanQuery(args.query)
	if (!args.audience || !query) return null
	const targets = audienceBoundConnections(args.env, args.connections).slice(
		0,
		MAX_SERVERS,
	)
	if (targets.length === 0) return null

	const env = args.env as RecallEnv & Env
	const toolName = env.AUDIENCE_MCP_RECALL_TOOL?.trim() || DEFAULT_RECALL_TOOL
	if (toolName.toLowerCase() === "off") return null
	const argName = env.AUDIENCE_MCP_RECALL_ARG?.trim() || DEFAULT_RECALL_ARG
	const connect: Connect =
		args.connect ??
		((e, connection, callbackUrl, options) =>
			connectToolProvider(e, connection, callbackUrl, options))
	const timeoutMs = args.timeoutMs ?? RECALL_TIMEOUT_MS

	const blocks = await Promise.all(
		targets.map(async (connection) => {
			const startedAt = Date.now()
			let handle: ToolProviderHandle | undefined
			try {
				const call = (async () => {
					handle = await connect(args.env, connection, args.callbackUrl, {
						audience: args.audience,
					})
					return handle.callTool(toolName, { [argName]: query })
				})()
				const { text, isError } = recallText(await withTimeout(call, timeoutMs))
				console.log(
					`[company-brain][${args.traceId}] ambient kb recall server=${connection.serverSlug} surface=${args.audience?.surface} chars=${text.length} error=${isError ? "yes" : "no"} ms=${Date.now() - startedAt}`,
				)
				if (!text) return null
				const name = (connection.metadata?.serverName || connection.serverSlug).replace(/"/g, "")
				return [
					`<knowledge_base_recall source="${name}" tool="${toolName}"${isError ? ' status="refused"' : ""}>`,
					truncate(text),
					"</knowledge_base_recall>",
				].join("\n")
			} catch (error) {
				console.warn(
					`[company-brain][${args.traceId}] ambient kb recall failed server=${connection.serverSlug} ms=${Date.now() - startedAt}: ${error instanceof Error ? error.message : String(error)}`,
				)
				return null
			} finally {
				const h = handle as ToolProviderHandle | undefined
				h?.close().catch(() => {})
			}
		}),
	)
	const found = blocks.filter((block): block is string => Boolean(block))
	if (found.length === 0) return null
	return [
		"Company knowledge base (automatic lookup for this request, already filtered by who will read this reply):",
		...found,
		"Ground answers about the company in these results first. They are search hits, not full notes: call the knowledge base tools (for example ler_nota) to read a note before quoting details. If the block says nothing can be shown here, say so instead of looking elsewhere for the same information.",
	].join("\n")
}
