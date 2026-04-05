/* @refresh reload */
import { render } from "solid-js/web";
import MascotOverlay from "./components/overlay/MascotOverlay";

const root = document.getElementById("root");
render(() => <MascotOverlay />, root!);
