import type { SlackMemberLookup } from "../slack/workspace"
import type { SlackAudience } from "../tools/mcp/audience"

// Who a brain turn runs as. Org-scoped, optionally tied to a Slack user.
export type TurnActor = {
	orgId: string
	userId?: string
	isAdmin?: boolean
	/** Slack turns use only the asker's personal connections, not org-shared. */
	personalConnectionsOnly?: boolean
	/** Automations read strictly org-shared connections, ignoring userId. */
	orgSharedOnly?: boolean
	/** Block ALL MCP writes (org-shared and personal). Automations are read-only. */
	readOnly?: boolean
	memberLookup?: SlackMemberLookup
	/**
	 * Where this turn's reply will be read. Set only by assembleTurnTools from
	 * the Slack event, never from model output; sent to audience-bound MCP
	 * servers (AUDIENCE_MCP_HOSTS). Absent outside Slack turns.
	 */
	slackAudience?: SlackAudience
}
