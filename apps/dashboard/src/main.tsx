import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./App";

const container = document.getElementById("app");
if (!container) {
  throw new Error("#app mount point is missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
