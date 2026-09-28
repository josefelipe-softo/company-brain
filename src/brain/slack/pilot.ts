/**
 * BRAIN_PILOT_MODE=on installs the bot quietly, for trying it in a real
 * workspace before a company-wide rollout:
 *
 * - no member wave: nobody else is added to #company-brain, provisioned or
 *   DMed, now or on later team_join/user_change events
 * - no beachhead: the bot does not join the two busiest public channels
 *   five minutes after install (the admin can still click "Add me to my
 *   public channels")
 * - no company research card or digest in #company-brain at install
 * - proactivity defaults to "own channel only": outside #company-brain the
 *   bot answers only DMs and @mentions until an admin changes it
 */
export function pilotMode(env: Pick<Env, "BRAIN_PILOT_MODE">): boolean {
	return (env.BRAIN_PILOT_MODE ?? "").trim().toLowerCase() === "on"
}
