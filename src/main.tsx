import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StageWindow from "./StageWindow";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const isStage = new URLSearchParams(window.location.search).has("stage");

root.render(
  <React.StrictMode>{isStage ? <StageWindow /> : <App />}</React.StrictMode>,
);
