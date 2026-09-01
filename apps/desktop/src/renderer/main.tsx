import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { colors, motion, radii } from "@noudle-agents/design-tokens";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("noudleAgents renderer root was not found");

const style = document.documentElement.style;
Object.entries(colors).forEach(([name, value]) => style.setProperty(`--color-${name}`, value));
style.setProperty("--radius-control", `${radii.control}px`);
style.setProperty("--radius-card", `${radii.card}px`);
style.setProperty("--radius-sheet", `${radii.sheet}px`);
style.setProperty("--motion-fast", `${motion.fast}ms`);
style.setProperty("--motion-standard", `${motion.standard}ms`);
style.setProperty("--motion-sheet", `${motion.sheet}ms`);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
