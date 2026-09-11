import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress WebView2's default context menu (Back / Refresh / Save as / Print /
// Inspect). xterm handles its own right-click-to-paste and calls
// preventDefault, so terminal behavior is unaffected.
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
