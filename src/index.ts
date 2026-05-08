import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRecap(pi: ExtensionAPI) {
  pi.on("session_start", (_e, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.notify("pi-recap loaded", "info");
  });
}
