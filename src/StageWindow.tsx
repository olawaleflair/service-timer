import { useEffect, useState } from "react";
import type { StagePayload } from "./types";
import { getStagePayload, onStagePayload } from "./services/tauri";

const blankPayload: StagePayload = {
  mode: "blank",
  sectionName: "",
  timerText: "00:00:00",
  tone: "normal",
};

export default function StageWindow() {
  const [payload, setPayload] = useState<StagePayload>(blankPayload);

  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;
    const syncLatestPayload = () => {
      getStagePayload().then((value) => {
        if (mounted && value) setPayload(value);
      });
    };
    onStagePayload((value) => setPayload(value)).then((unlisten) => {
      cleanup = unlisten;
      syncLatestPayload();
    });
    syncLatestPayload();
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, []);

  if (payload.mode === "test") {
    return (
      <main className="stage-window">
        <div className="stage-test">Timer display connected</div>
      </main>
    );
  }

  if (payload.mode === "hidden") {
    return (
      <main className="stage-window">
        <div className="stage-hidden">Stage output hidden</div>
      </main>
    );
  }

  return (
    <main className="stage-window">
      <section className="stage-content" aria-live="polite">
        <h1>{payload.sectionName}</h1>
        <div className={`stage-timer ${payload.tone}`} key={payload.timerText}>
          {payload.timerText}
        </div>
      </section>
    </main>
  );
}
