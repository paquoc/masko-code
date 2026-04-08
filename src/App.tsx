import { createSignal, onMount, onCleanup, Show, type JSX } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appStore } from "./stores/app-store";
import { updateStore } from "./stores/update-store";
import SessionList from "./components/dashboard/SessionList";
import NotificationCenter from "./components/dashboard/NotificationCenter";
import MascotGallery from "./components/dashboard/MascotGallery";
import ActivityFeed from "./components/dashboard/ActivityFeed";
import SettingsPanel from "./components/dashboard/SettingsPanel";
import { initTelegramStore } from "./stores/telegram-store";

type Tab = "sessions" | "notifications" | "mascots" | "activity" | "settings";

const TAB_META: Record<Tab, { label: string; icon: string }> = {
  sessions: { label: "Sessions", icon: "⚡" },
  notifications: { label: "Notifications", icon: "🔔" },
  mascots: { label: "Mascots", icon: "🎭" },
  activity: { label: "Activity", icon: "📋" },
  settings: { label: "Settings", icon: "⚙️" },
};

function App() {
  const [activeTab, setActiveTab] = createSignal<Tab>("sessions");

  let unlisten: UnlistenFn | undefined;

  onMount(async () => {
    await initTelegramStore();
    appStore.start();
    // Auto-update on launch — check, download, and install silently
    updateStore.checkForUpdates({ autoInstall: true });
    // Listen for tray navigation events
    unlisten = await listen<string>("navigate", (e) => {
      if (e.payload === "settings") setActiveTab("settings");
    });
  });

  onCleanup(() => unlisten?.());

  const tabContent: Record<Tab, () => JSX.Element> = {
    sessions: () => <SessionList />,
    notifications: () => <NotificationCenter />,
    mascots: () => <MascotGallery />,
    activity: () => <ActivityFeed />,
    settings: () => <SettingsPanel />,
  };

  return (
    <div class="h-screen flex flex-col bg-bg-light">
      {/* Title bar */}
      <header
        class="h-10 flex items-center px-4 bg-surface border-b border-border select-none shrink-0"
        data-tauri-drag-region
      >
        <img src="/logo.png" alt="Masko" class="h-5 w-5 mr-2" />
        <span class="font-heading font-semibold text-sm text-text-primary">
          Masko Code
        </span>
        <Show when={appStore.hasUnreadNotifications}>
          <div class="w-2 h-2 rounded-full bg-orange-primary ml-1" />
        </Show>
      </header>

      {/* Main layout: sidebar + content */}
      <div class="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav class="w-48 bg-surface border-r border-border flex flex-col py-2 shrink-0">
          {(Object.keys(TAB_META) as Tab[]).map((tab) => (
            <SidebarItem
              tab={tab}
              active={activeTab() === tab}
              onClick={() => setActiveTab(tab)}
              badge={tabBadge(tab)}
            />
          ))}
        </nav>

        {/* Content */}
        <main class="flex-1 overflow-y-auto p-6">
          {/* Update banner */}
          <Show when={updateStore.hasUpdate && activeTab() !== "settings"}>
            <div class="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-card-sm bg-orange-subtle border border-orange-primary/20">
              <span class="text-sm font-body text-text-primary">
                Update <span class="font-medium text-orange-primary">v{updateStore.version}</span> available
              </span>
              <button
                class="ml-auto px-3 py-1 text-xs font-body font-medium rounded-card-sm bg-orange-primary text-white hover:bg-orange-hover transition-colors"
                onClick={() => setActiveTab("settings")}
              >
                Update
              </button>
            </div>
          </Show>
          <h2 class="font-heading text-xl font-bold text-text-primary mb-4">
            {TAB_META[activeTab()].label}
          </h2>
          {tabContent[activeTab()]()}
        </main>
      </div>
    </div>
  );
}

function tabBadge(tab: Tab): number {
  switch (tab) {
    case "sessions": return appStore.sessions.activeSessions.length;
    case "notifications": return appStore.notifications.unreadCount;
    case "settings": return updateStore.hasUpdate ? 1 : 0;
    default: return 0;
  }
}

function SidebarItem(props: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  badge: number;
}) {
  const meta = TAB_META[props.tab];
  return (
    <button
      class="flex items-center gap-2.5 px-4 py-2 text-sm font-body text-left transition-colors w-full"
      classList={{
        "bg-orange-subtle text-orange-primary font-medium": props.active,
        "text-text-muted hover:bg-orange-subtle/50 hover:text-text-primary": !props.active,
      }}
      onClick={props.onClick}
    >
      <span class="text-base w-5 text-center">{meta.icon}</span>
      <span class="flex-1">{meta.label}</span>
      <Show when={props.badge > 0}>
        <span class="text-[10px] bg-orange-primary text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {props.badge}
        </span>
      </Show>
    </button>
  );
}

export default App;
