window.__ModuleLoader__.load({
	id: "dsh-session-ref",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/CopyReferenceButton.tsx
		/**
		* Composer tool-row button that copies a session-reference mention for the
		* CURRENT session into the clipboard: `@[label](dsh-session:<payload>)`.
		* Pasting that mention into any other session (including one in another
		* workspace) makes the host half resolve and inject the referenced snapshot.
		*
		* The base64url payload is produced here without any harness import (the
		* client bundle purity gate only allows loader module-table value imports) and
		* matches the native `encodeSessionReferenceUri` byte-for-byte:
		* `dsh-session:<base64url(JSON.stringify(sessionId))>`.
		*/
		/** Canonical base64url payload, matching the native URI encoder. */
		function encodeSessionReferenceUri(sessionId) {
			const json = JSON.stringify(sessionId);
			const bytes = new TextEncoder().encode(json);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return `dsh-session:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
		}
		/** Render a host-neutral Markdown mention (label → sessionId fallback). */
		function formatSessionReferenceMention(sessionId, label) {
			return `@[${(label === "" ? sessionId : label).replace(/([\\\]])/g, "\\$1")}](${encodeSessionReferenceUri(sessionId)})`;
		}
		const styles = { button: {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			border: "1px solid rgba(127, 127, 127, .35)",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			padding: "4px 10px",
			cursor: "pointer",
			fontSize: 12,
			whiteSpace: "nowrap"
		} };
		/** Tool-row button: click → copy mention → brief "copied" feedback. */
		function CopyReferenceButton({ copy }) {
			const [copied, setCopied] = (0, react.useState)(false);
			const timer = (0, react.useRef)(void 0);
			const onClick = () => {
				copy().then((ok) => {
					window.clearTimeout(timer.current);
					if (ok) {
						setCopied(true);
						timer.current = window.setTimeout(() => setCopied(false), 1500);
					}
				});
			};
			return (0, react.createElement)("button", {
				type: "button",
				style: styles.button,
				onClick,
				title: "复制本会话的跨会话引用（粘贴到其他会话即可引用本对话）",
				"aria-label": "复制会话引用"
			}, copied ? "已复制 ✓" : "复制引用");
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "sessions"];
		/** Build the click-time copy action for one session. */
		function copyInject(ctx, sessionId) {
			const copy = async () => {
				const label = (ctx.get("sessions")?.list.getSnapshot())?.byId[sessionId]?.displayTitle ?? String(sessionId);
				const mention = formatSessionReferenceMention(String(sessionId), label);
				try {
					await navigator.clipboard.writeText(mention);
					return true;
				} catch {
					try {
						const textarea = document.createElement("textarea");
						textarea.value = mention;
						textarea.style.position = "fixed";
						textarea.style.opacity = "0";
						document.body.appendChild(textarea);
						textarea.select();
						const ok = document.execCommand("copy");
						textarea.remove();
						return ok;
					} catch {
						console.error("[session-ref] copy failed:", mention);
						return false;
					}
				}
			};
			return { copy };
		}
		/** Client plugin body: composer tool-row trigger. */
		function apply(ctx) {
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "session-ref-copy",
				inject: (sessionId) => copyInject(ctx, sessionId)
			}, CopyReferenceButton));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map