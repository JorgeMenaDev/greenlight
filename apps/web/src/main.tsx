import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Greenlight: #root container not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
