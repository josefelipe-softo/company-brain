# Knowledge-base MCP servers and Slack audiences

A personal MCP connection tells a server **who** is asking. When the reply is
posted in a Slack channel, everyone in that channel reads it too. A server that
enforces its own permissions, such as a company wiki, also needs to know
**where** the reply will appear, so it can return only what every reader of
that channel may see.

## Audience headers

List the server's hostname in `AUDIENCE_MCP_HOSTS` (comma separated). On every
request to that server, the brain then sends:

| Header | Value |
|---|---|
| `X-Brain-Surface` | `dm`, `public_channel` or `private_channel` |
| `X-Slack-Channel` | the channel the reply is posted to |
| `X-Slack-User` | the Slack user who asked, who owns the connection |

- **Where the values come from.** They are taken from the Slack event the turn
  is handling, in `assembleTurnTools`. They are never read from model output or
  tool arguments.
- **Extra headers can't override them.** Audience headers set on the connection
  are dropped for these servers, so a connection can't claim `dm` on its own.
- **No Slack context, no headers.** A turn without Slack context (automations,
  admin tools) sends none. The server should then fail closed and return
  nothing.
- **Other servers are unaffected.** MCP servers not listed in
  `AUDIENCE_MCP_HOSTS` never receive Slack ids.

Connections to these servers are also **never leased**. A borrower would read
with the lender's permissions and post the result where the lender never
agreed to. Custom MCP connections are already personal-only.

## Automatic knowledge-base lookup

Supermemory is recalled automatically before every Slack turn. A custom MCP
server, by default, is only a tool the model may choose to call, so whether an
answer uses the company wiki would depend on the model.

For audience-bound servers, the harness makes the first lookup deterministic.
Before the model runs, it calls the server's search tool with the user's
request, using the same connection and the same audience headers as a regular
tool call. The hits go into the turn's context; the model can still call the
server's tools to read a note in full.

- The server's permissions apply as usual, so the lookup never shows more than
  the tool itself would. A refusal ("nothing can be shown here") is passed to
  the model too, so it says so instead of searching elsewhere.
- It is fail-soft: a server that fails or takes more than 5 seconds is skipped
  and the turn goes on.
- `AUDIENCE_MCP_RECALL_TOOL` (default `buscar_notas`) and
  `AUDIENCE_MCP_RECALL_ARG` (default `consulta`) name the search tool and its
  query argument. Set the tool to `off` to disable the lookup.

## Keeping supermemory read-only

Set `BRAIN_MEMORY_WRITES=off` when another system is the source of truth and
Slack content must not be copied into supermemory. Reads and forgetting keep
working. The following all stop:

- turn writeback;
- channel observation;
- the public-channel history import (the rollout stops after joining channels);
- interaction-style notes;
- the entity cache;
- container settings updates.

The `save_memory` guidance is also removed from the prompt.
