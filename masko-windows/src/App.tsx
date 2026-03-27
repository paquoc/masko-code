import { createSignal, onMount, Show, type JSX } from "solid-js";
import { appStore } from "./stores/app-store";
import SessionList from "./components/dashboard/SessionList";
import NotificationCenter from "./components/dashboard/NotificationCenter";
import MascotGallery from "./components/dashboard/MascotGallery";
import ActivityFeed from "./components/dashboard/ActivityFeed";
import SettingsPanel from "./components/dashboard/SettingsPanel";

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

  onMount(async () => {
    await appStore.start();
  });

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
        <img src="/src/assets/images/logo.png" alt="Masko" class="h-5 w-5 mr-2" />
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
    case "activity": return 0;
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
