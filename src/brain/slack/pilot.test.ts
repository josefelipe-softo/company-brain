import { describe, expect, it } from "vitest"
import { startAutomaticTeamInviteRollout } from "../turn/team-invite"
import type { CompanyBrainAgent } from "../turn/agent"
import { installGreeting } from "./greet"
import { pilotMode } from "./pilot"
import { armPublicChannelBeachhead } from "./public-channel-rollout"

// A Durable Object stand-in that fails the test if anything touches its
// storage or scheduler: in pilot mode the guards must return first.
function untouchableAgent(env: Partial<Env>) {
	const fail = (what: string) => () => {
		throw new Error(`pilot mode should not reach ${what}`)
	}
	return {
		env,
		name: "org-1",
		sql: fail("sql"),
		schedule: fail("schedule"),
		waitUntil: fail("waitUntil"),
	} as unknown as CompanyBrainAgent
}

describe("BRAIN_PILOT_MODE", () => {
	it("is on only when set to on", () => {
		expect(pilotMode({ BRAIN_PILOT_MODE: "on" } as Env)).toBe(true)
		expect(pilotMode({ BRAIN_PILOT_MODE: " ON " } as Env)).toBe(true)
		expect(pilotMode({} as Env)).toBe(false)
		expect(pilotMode({ BRAIN_PILOT_MODE: "off" } as Env)).toBe(false)
	})

	it("never starts the member wave", async () => {
		const agent = untouchableAgent({ BRAIN_PILOT_MODE: "on" })
		await expect(
			startAutomaticTeamInviteRollout(agent, {
				teamId: "T1",
				installerSlackUserId: "U1",
			}),
		).resolves.toBeUndefined()
	})

	it("never schedules the public-channel beachhead", async () => {
		const agent = untouchableAgent({ BRAIN_PILOT_MODE: "on" })
		await expect(
			armPublicChannelBeachhead(agent, { teamId: "T1", installerSlackUserId: "U1" }),
		).resolves.toBeUndefined()
	})

	it("doesn't promise the member wave or research in the installer greeting", () => {
		const pilot = installGreeting({ firstName: "Ana", homeChannelId: "C1", pilot: true })
		expect(pilot).toContain("Pilot mode")
		expect(pilot).not.toContain("every full workspace member")
		expect(pilot).not.toContain("reading up on")

		const normal = installGreeting({ firstName: "Ana", homeChannelId: "C1" })
		expect(normal).toContain("every full workspace member")
	})
})
