/* @refresh reload */
import { render } from "solid-js/web";
import MascotOverlay from "./components/overlay/MascotOverlay";
import { initTelegramStore } from "./stores/telegram-store";

const root = document.getElementById("root");
initTelegramStore().catch(() => {});
render(() => <MascotOverlay />, root!);
