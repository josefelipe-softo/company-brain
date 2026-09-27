/**
 * Slack audience context for knowledge-base MCP servers.
 *
 * A personal MCP connection tells the server WHO is asking (its token). A
 * reply posted in a Slack channel is also read by everyone in that channel,
 * so a server that enforces its own permissions also needs to know WHERE the
 * reply will appear. This module sends that as request headers:
 *
 *   X-Brain-Surface   dm | public_channel | private_channel
 *   X-Slack-Channel   channel the reply is posted to
 *   X-Slack-User      Slack user who asked (the connection's owner)
 *
 * Only servers whose host is listed in AUDIENCE_MCP_HOSTS receive them: other
 * MCP servers (GitHub, Linear, marketplace servers) never see Slack ids.
 *
 * The values come from the Slack event the turn is handling, set by
 * assembleTurnTools. They are never read from model output or tool arguments,
 * and connection-level extra headers cannot override them. A turn without a
 * Slack context (automations, admin tools) sends none, and a fail-closed
 * server then returns nothing.
 */

export type SlackAudienceSurface = "dm" | "public_channel" | "private_channel"

export type SlackAudience = {
	surface: SlackAudienceSurface
	channelId?: string
	slackUserId?: string
}

export const AUDIENCE_HEADERS = {
	surface: "X-Brain-Surface",
	channel: "X-Slack-Channel",
	user: "X-Slack-User",
} as const

const RESERVED = new Set(
	Object.values(AUDIENCE_HEADERS).map((name) => name.toLowerCase()),
)

/** Hostnames from AUDIENCE_MCP_HOSTS (comma or space separated, case-insensitive). */
export function audienceMcpHosts(env: Pick<Env, "AUDIENCE_MCP_HOSTS">): Set<string> {
	return new Set(
		(env.AUDIENCE_MCP_HOSTS ?? "")
			.split(/[\s,]+/)
			.map((host) => host.trim().toLowerCase())
			.filter(Boolean),
	)
}

/** True when the server enforces audience permissions and must receive (only) harness-set context. */
export function isAudienceBoundServer(
	env: Pick<Env, "AUDIENCE_MCP_HOSTS">,
	serverUrl: string | null | undefined,
): boolean {
	if (!serverUrl) return false
	let host: string
	try {
		host = new URL(serverUrl).hostname.toLowerCase()
	} catch {
		return false
	}
	return audienceMcpHosts(env).has(host)
}

/** Headers to add to every request to this server; empty for servers not in AUDIENCE_MCP_HOSTS. */
export function audienceHeaders(
	env: Pick<Env, "AUDIENCE_MCP_HOSTS">,
	serverUrl: string | null | undefined,
	audience: SlackAudience | undefined,
): Record<string, string> {
	if (!audience || !isAudienceBoundServer(env, serverUrl)) return {}
	const headers: Record<string, string> = {
		[AUDIENCE_HEADERS.surface]: audience.surface,
	}
	if (audience.channelId) headers[AUDIENCE_HEADERS.channel] = audience.channelId
	if (audience.slackUserId) headers[AUDIENCE_HEADERS.user] = audience.slackUserId
	return headers
}

/**
 * Drop audience headers from user-configured extra headers on audience-bound
 * servers, so a connection can never claim "dm" on its own. Other servers
 * keep their extra headers untouched.
 */
export function withoutReservedHeaders(
	env: Pick<Env, "AUDIENCE_MCP_HOSTS">,
	serverUrl: string | null | undefined,
	headers: Array<[string, string]>,
): Array<[string, string]> {
	if (!isAudienceBoundServer(env, serverUrl)) return headers
	return headers.filter(([name]) => !RESERVED.has(name.toLowerCase()))
}
