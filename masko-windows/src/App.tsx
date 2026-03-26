import { createSignal, onMount, For, Show } from "solid-js";
import { appStore } from "./stores/app-store";

function App() {
  const [serverStatus, setServerStatus] = createSignal("Starting...");

  onMount(async () => {
    await appStore.start();
    setServerStatus("Listening on 45832");
  });

  return (
    <div class="min-h-screen bg-bg-light">
      {/* Header */}
      <header
        class="h-10 flex items-center px-4 bg-surface border-b border-border select-none"
        data-tauri-drag-region
      >
        <img src="/src/assets/images/logo.png" alt="Masko" class="h-5 w-5 mr-2" />
        <span class="font-heading font-semibold text-sm text-text-primary">
          Masko Code
        </span>
        <Show when={appStore.hasUnreadNotifications}>
          <div class="w-2 h-2 rounded-full bg-orange-primary ml-1" />
        </Show>
        <span class="ml-auto text-xs text-text-muted font-body">
          {serverStatus()}
        </span>
      </header>

      {/* Dashboard content */}
      <main class="p-6">
        <h1 class="font-heading text-2xl font-bold text-text-primary mb-4">
          Dashboard
        </h1>

        <div class="grid grid-cols-2 gap-4">
          {/* Sessions card */}
          <div class="bg-surface rounded-[--radius-card] border border-border p-4 shadow-sm">
            <h2 class="font-heading text-lg font-semibold mb-2">
              Sessions
              <Show when={appStore.sessions.activeSessions.length > 0}>
                <span class="ml-2 text-xs bg-orange-primary text-white px-1.5 py-0.5 rounded-full">
                  {appStore.sessions.activeSessions.length}
                </span>
              </Show>
            </h2>
            <Show
              when={appStore.sessions.sessions.length > 0}
              fallback={<p class="text-text-muted text-sm">No active sessions</p>}
            >
              <div class="space-y-2">
                <For each={appStore.sessions.sessions}>
                  {(session) => (
                    <div class="flex items-center gap-2 text-sm">
                      <div
                        class="w-2 h-2 rounded-full"
                        classList={{
                          "bg-green-500": session.status === "active" && session.phase === "working",
                          "bg-yellow-500": session.status === "active" && session.phase === "waiting",
                          "bg-gray-400": session.status === "active" && session.phase === "idle",
                          "bg-red-400": session.status === "ended",
                        }}
                      />
                      <span class="font-body text-text-primary">
                        {session.projectName || "Unknown"}
                      </span>
                      <span class="text-text-muted text-xs ml-auto">
                        {session.eventCount} events
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Notifications card */}
          <div class="bg-surface rounded-[--radius-card] border border-border p-4 shadow-sm">
            <h2 class="font-heading text-lg font-semibold mb-2">
              Notifications
              <Show when={appStore.notifications.unreadCount > 0}>
                <span class="ml-2 text-xs bg-orange-primary text-white px-1.5 py-0.5 rounded-full">
                  {appStore.notifications.unreadCount}
                </span>
              </Show>
            </h2>
            <Show
              when={appStore.notifications.notifications.length > 0}
              fallback={<p class="text-text-muted text-sm">No notifications</p>}
            >
              <div class="space-y-2 max-h-48 overflow-y-auto">
                <For each={appStore.notifications.notifications.slice(0, 5)}>
                  {(notif) => (
                    <div class="text-sm border-l-2 pl-2" classList={{
                      "border-orange-primary": notif.priority === "urgent" || notif.priority === "high",
                      "border-blue-400": notif.priority === "normal",
                      "border-gray-300": notif.priority === "low",
                    }}>
                      <div class="font-body font-medium text-text-primary">{notif.title}</div>
                      <div class="text-text-muted text-xs truncate">{notif.body}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Mascots card */}
          <div class="bg-surface rounded-[--radius-card] border border-border p-4 shadow-sm">
            <h2 class="font-heading text-lg font-semibold mb-2">Mascots</h2>
            <Show
              when={appStore.mascots.mascots.length > 0}
              fallback={<p class="text-text-muted text-sm">Loading mascots...</p>}
            >
              <div class="flex flex-wrap gap-2">
                <For each={appStore.mascots.mascots}>
                  {(mascot) => (
                    <button
                      class="px-3 py-1.5 rounded-[--radius-card-sm] text-sm font-body border transition-colors"
                      classList={{
                        "bg-orange-primary text-white border-orange-primary":
                          appStore.mascots.activeMascotId === mascot.id,
                        "bg-surface text-text-primary border-border hover:border-border-hover":
                          appStore.mascots.activeMascotId !== mascot.id,
                      }}
                      onClick={() => appStore.mascots.setActiveMascot(mascot.id)}
                    >
                      {mascot.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Server status card */}
          <div class="bg-surface rounded-[--radius-card] border border-border p-4 shadow-sm">
            <h2 class="font-heading text-lg font-semibold mb-2">Server</h2>
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full bg-green-500" />
              <span class="text-sm text-text-muted font-body">{serverStatus()}</span>
            </div>
            <div class="mt-3 space-y-1 text-xs text-text-muted">
              <div>Events received: {appStore.events.events.length}</div>
              <div>Active sessions: {appStore.sessions.activeSessions.length}</div>
              <div>Pending permissions: {appStore.permissions.pending.length}</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
