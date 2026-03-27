import { createSignal, onMount, Show } from "solid-js";
import { installHooks, uninstallHooks, isHooksRegistered, getServerStatus } from "../../services/ipc";

export default function SettingsPanel() {
  const [hooksInstalled, setHooksInstalled] = createSignal(false);
  const [serverPort, setServerPort] = createSignal(45832);
  const [loading, setLoading] = createSignal("");

  onMount(async () => {
    try {
      setHooksInstalled(await isHooksRegistered());
      const status = await getServerStatus();
      setServerPort(status.port);
    } catch (e) {
      console.error("[masko] Settings load error:", e);
    }
  });

  async function handleInstallHooks() {
    setLoading("install");
    try {
      await installHooks();
      setHooksInstalled(true);
    } catch (e) {
      console.error("[masko] Hook install failed:", e);
    }
    setLoading("");
  }

  async function handleUninstallHooks() {
    setLoading("uninstall");
    try {
      await uninstallHooks();
      setHooksInstalled(false);
    } catch (e) {
      console.error("[masko] Hook uninstall failed:", e);
    }
    setLoading("");
  }

  return (
    <div class="space-y-6">
      {/* Server status */}
      <Section title="Server">
        <div class="flex items-center gap-3">
          <div class="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span class="text-sm font-body text-text-primary">
            Running on port {serverPort()}
          </span>
        </div>
      </Section>

      {/* Hook management */}
      <Section title="Claude Code Hooks">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-body text-text-primary">
              {hooksInstalled() ? "Hooks installed" : "Hooks not installed"}
            </p>
            <p class="text-xs text-text-muted mt-0.5">
              Hooks connect Claude Code events to Masko's overlay and dashboard.
            </p>
          </div>
          <Show
            when={hooksInstalled()}
            fallback={
              <button
                class="px-3 py-1.5 text-sm font-body font-medium rounded-[--radius-card-sm] bg-orange-primary text-white hover:bg-orange-hover transition-colors disabled:opacity-50"
                onClick={handleInstallHooks}
                disabled={loading() === "install"}
              >
                {loading() === "install" ? "Installing..." : "Install"}
              </button>
            }
          >
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-[--radius-card-sm] border border-border text-text-muted hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50"
              onClick={handleUninstallHooks}
              disabled={loading() === "uninstall"}
            >
              {loading() === "uninstall" ? "Removing..." : "Uninstall"}
            </button>
          </Show>
        </div>
      </Section>

      {/* About */}
      <Section title="About">
        <div class="space-y-1 text-sm text-text-muted font-body">
          <p><span class="text-text-primary font-medium">Masko Code</span> v0.1.0</p>
          <p>Your AI coding assistant companion for Windows.</p>
          <p class="text-xs mt-2">
            <a href="https://masko.ai" class="text-orange-primary hover:underline" target="_blank">
              masko.ai
            </a>
          </p>
        </div>
      </Section>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div class="bg-surface rounded-[--radius-card] border border-border p-4">
      <h3 class="font-heading font-semibold text-sm text-text-primary mb-3">{props.title}</h3>
      {props.children}
    </div>
  );
}
