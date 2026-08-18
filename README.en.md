# dsh-session-ref

![CI](https://github.com/lacemou/dsh-session-ref/actions/workflows/ci.yml/badge.svg)

**Cross-session reference (mention) plugin for DeepSeek Harness.**

Paste `@[label](dsh-session:<id>)` into any session — **including one in a
different workspace/folder** — and the host resolves the referenced session
and injects its content snapshot for the model to read. Cross-folder tasks and
conversations can be referenced directly; no more paraphrasing by hand.

Full design notes: [SPEC.md](SPEC.md) (Chinese).

## Features (MVP)

- **Host half**: an `agent/pre-step` listener parses `@[label](dsh-session:…)`
  and bare `dsh-session:<id>` mentions, calls the native
  `sessionReferenceResolver.prepare()` to inject the snapshot (rendered as a
  distinct **Session recall** row), and rewrites the mention into a readable
  `@label`. The `sessionReferenceResolver` service is registered by the plugin
  when the deployment does not mount it (as in rc.6 profiles).
- **Client half**: a **复制引用 / Copy reference** button in the composer tool
  row copies the current session's mention
  (`@[title](dsh-session:<id>)`) to the clipboard in one click.
- Everything cross-session reuses the native
  `@deepseek-ai/dsh-session-reference` pipeline: parallel source reads,
  deduplication, budget bounds (≤3 sources / ≤64 KB), self-reference
  rejection, and the untrusted-context warning.

## Important limitations

1. **Community plugin**: not an official DSH component; maintained by the
   community. Relies on host-internal contracts that may break on upgrades.
2. **Snapshot semantics**: references are capture-time snapshots, not live
   sessions; subsequent source changes do not propagate to the target.
3. **Context budget**: at most 3 sources per message and 64 KB per source
   snapshot; over-budget references are truncated or rejected outright.
4. **Self-reference rejection**: referencing the current session is rejected
   natively to prevent cycles.
5. **Internal dependencies**: depends on host-internal interfaces
   (`agent/pre-step`, `sessionReferenceResolver`) and session-log formats;
   may break after host upgrades.
6. **Capability boundary**: not infinite context (injected snapshots occupy
   target context until compaction) and not automatic collaboration
   (one-way reference; no messaging or task handoff).

## Install

```sh
# Option 1: npm (recommended)
dsh plugin add dsh-session-ref

# Option 2: git checkout (lib/ is committed — no build step)
git clone https://github.com/lacemou/dsh-session-ref
cd dsh-session-ref
dsh plugin --profile web add /path/to/dsh-session-ref

# Option 3: local development
cd dsh-session-ref
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-session-ref
```

Then **restart the web process** (`Ctrl-C`, then `dsh web` again) so the new
bundle is picked up.

> Published as a git/npm bundle, `lib/` is committed — no build step is needed
> on the installing side.

## Usage

1. In session A, click **复制引用 / Copy reference** in the composer tool row.
2. The clipboard now holds `@[titleA](dsh-session:…)`.
3. In session B (which can be in **another workspace**), paste and send.
4. The transcript shows a distinct **Session recall** row (source title plus
   retained/omitted stats), and the model sees the `## Referenced sessions`
   snapshot alongside the readable `@titleA`.

You can also write mentions by hand:
`@[any label](dsh-session:<id>)` or a bare `dsh-session:<id>`.

Self-references (referencing the current session) are rejected natively, as are
messages exceeding 3 distinct sources or the snapshot byte budget — the message
is passed through untouched in those cases.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm run test        # vitest run (19 tests: host injection, URI encoding parity, client copy)
npm run build       # tsc --noEmit + tsdown → lib/index.js (host) + lib/client.js (browser)
```

## Known limitations

- No `@` autocomplete yet (see M2 in the roadmap below; the MVP closes the loop
  via copy-reference → paste).
- Text-only projection: non-text blocks (images, tool results) do not cross
  sessions.
- Reading sessions written by other DSH versions may fail (native limitation);
  on failure the message degrades to its raw form.
- Cross-process references to sessions the current host has never loaded go
  through the persistence path, which some deployments (e.g. headless
  profiles) may not serve; referencing live sessions always works.

## Roadmap

| Milestone | Scope |
|---|---|
| **M2** | **`@` autocomplete in the composer**: typing `@` lists session candidates (from the native `listCandidates`, ranked by workspace affinity); keyboard selection inserts `@[title](dsh-session:…)` — upgrading copy-paste to a one-step mention |
| M3 | Cross-workspace directory browsing + reference granularity (whole session / user nodes / ranges) |
| M4 | Integration with [dsh-crosstalk](https://github.com/Jesse-njx/dsh-crosstalk): reference + handoff |
| M5 | Contribute "copy session ID / copy reference" back to the upstream core UI |

Full design notes: [SPEC.md](SPEC.md) (Chinese).

## License

MIT
