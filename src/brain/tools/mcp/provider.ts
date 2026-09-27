import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js"
import type { SlackAudience } from "./audience"
import type { McpConnectionRow } from "./store"

export type ProviderTool = {
	name: string
	description?: string
	inputSchema: McpTool["inputSchema"]
	annotations?: McpTool["annotations"]
	normalizeInput?: (args: Record<string, unknown>) => Record<string, unknown>
}

export type ProviderCallOptions = { retryOnTimeout?: boolean }

export interface ToolProviderHandle {
	listTools(): Promise<ProviderTool[]>
	callTool(
		name: string,
		args: Record<string, unknown>,
		options?: ProviderCallOptions,
	): Promise<unknown>
	close(): Promise<void>
}

type ProviderConnectors = {
	remote: (
		env: Env,
		connection: McpConnectionRow,
		callbackUrl: string,
		audience?: SlackAudience,
	) => Promise<ToolProviderHandle>
	embedded: (
		env: Env,
		connection: McpConnectionRow,
	) => Promise<ToolProviderHandle>
}

const defaultConnectors: ProviderConnectors = {
	remote: async (env, connection, callbackUrl, audience) => {
		const { connectRemoteMcpProvider } = await import("./client")
		return connectRemoteMcpProvider(env, connection, callbackUrl, audience)
	},
	embedded: async (env, connection) => {
		if (connection.serverSlug === "gmail") {
			const { connectGmailProvider } = await import("./google/gmail")
			return connectGmailProvider(env, connection)
		}
		throw new Error(`unsupported embedded provider '${connection.serverSlug}'`)
	},
}

export async function connectToolProvider(
	env: Env,
	connection: McpConnectionRow,
	callbackUrl: string,
	options: {
		/** Slack audience of the turn; only audience-bound servers receive it. */
		audience?: SlackAudience
		connectors?: ProviderConnectors
	} = {},
): Promise<ToolProviderHandle> {
	const connectors = options.connectors ?? defaultConnectors
	if (connection.runtime === "embedded") {
		return connectors.embedded(env, connection)
	}
	return connectors.remote(env, connection, callbackUrl, options.audience)
}
