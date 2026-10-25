// Entry point: apply the saved theme before first paint, then mount the app.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.tsx";
import { applyTheme, view } from "./view.ts";

applyTheme(view.get().theme);

const el = document.getElementById("root");
if (el)
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
