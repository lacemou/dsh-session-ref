import { SessionReferenceResolver, parseSessionReferenceText } from "@deepseek-ai/dsh-session-reference";
//#region src/index.ts
/**
* dsh-session-ref — host half.
*
* An `agent/pre-step` listener (prepend: true) that finds
* `@[label](dsh-session:...)` mentions and bare `dsh-session:<id>` URIs in the
* incoming prompt, hands the rewritten content and the structured references to
* the native `sessionReferenceResolver.prepare()`, and returns an enter
* decision that places each aggregated snapshot (`session-reference` recall
* context) directly before its rewritten direct message.
*
* Everything cross-session is native: parallel source reads, dedup, budget
* bounds, self-reference rejection, and the untrusted-context warning come from
* the harness core. This half is only the parse-and-inject shell. On any
* prepare failure the message passes through untouched (the mention stays
* visible to the model) and the error is logged — a user turn is never blocked.
*
* The `sessionReferenceResolver` service is optional in DSH deployments: the
* package ships in the dependency tree, but rc.6 profiles do not mount the
* service. This plugin therefore registers it on the root context when absent
* (idempotent; if a future host already provides it, the existing instance
* wins), then reads it from the root so the pre-step listener never depends on
* the plugin fiber's inject timing.
*/
/**
* Rewrite every text block of one message: parse mention-bearing blocks with
* the native parser (readable `@label` text + structured references), keep
* non-text blocks untouched. A malformed explicit mention makes the native
* parser throw for that block — treat the block as ordinary text.
*/
function rewriteContent(content) {
	const references = [];
	const blocks = [];
	for (const block of content) {
		if (block.type !== "text") {
			blocks.push(block);
			continue;
		}
		try {
			const parsed = parseSessionReferenceText(block.text);
			references.push(...parsed.references);
			blocks.push({
				...block,
				text: parsed.text
			});
		} catch {
			blocks.push(block);
		}
	}
	return {
		content: blocks,
		references
	};
}
/** Resolve the sessionReferenceResolver service from the root store. */
function readResolver(root) {
	if (root.get !== void 0) return root.get("sessionReferenceResolver", false);
	return root.sessionReferenceResolver;
}
/**
* Register the pre-step listener and, when absent, the native resolver service.
*
* Hosts before rc.8 do not mount `sessionReferenceResolver`; this plugin
* registers it (its bundle patch disables the native `session-reference` entry
* on rc.8+ so this registration is the single owner). Detection uses the
* cordis store API (`get(name, false)` — no inject requirement, any provider
* regardless of fiber state) and the registration itself is race-tolerant: if
* a concurrent provider (e.g. a host that re-enables the native entry) wins,
* we fall back to whatever is registered and continue.
*/
function apply(ctx, config = {}) {
	const root = ctx.root ?? ctx;
	if (readResolver(root) === void 0) try {
		new SessionReferenceResolver(root, {
			maxReferences: config.maxReferences,
			candidateLimit: config.candidateLimit,
			maxReferenceBytes: config.maxReferenceBytes
		});
	} catch (error) {
		console.warn("[session-ref] sessionReferenceResolver registration raced; using existing service", error);
	}
	ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal.aborted) return decision;
		let anyReference = false;
		for (const message of messages) for (const block of message.content) {
			if (block.type !== "text") continue;
			try {
				if (parseSessionReferenceText(block.text).references.length > 0) anyReference = true;
			} catch {}
		}
		if (!anyReference) return decision;
		const resolver = readResolver(root);
		if (resolver === void 0) {
			console.error("[session-ref] sessionReferenceResolver unavailable; skipping injection");
			return decision;
		}
		const out = [];
		for (const message of decision.messages) {
			const { content, references } = rewriteContent(message.content);
			if (references.length === 0) {
				out.push(message);
				continue;
			}
			let prepared;
			try {
				prepared = await resolver.prepare(agent, content, references, signal);
			} catch (error) {
				console.error("[session-ref] prepare failed:", error);
				out.push(message);
				continue;
			}
			if (prepared.additionalContext !== void 0) out.push(prepared.additionalContext);
			out.push({
				...message,
				content: prepared.content
			});
		}
		return {
			kind: "enter",
			messages: out
		};
	}, { prepend: true });
}
//#endregion
export { apply };
