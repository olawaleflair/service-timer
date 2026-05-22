import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  History,
  Home,
  Monitor,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  StepBack,
  StepForward,
  Trash2,
  X,
} from "lucide-react";
import type {
  ActiveService,
  AppState,
  DisplayInfo,
  ParsedProgramRow,
  Screen,
  Section,
  ServiceReport,
  Settings,
  Template,
} from "./types";
import {
  checkForUpdate,
  closeApplication,
  listDisplays,
  onMainCloseRequested,
  onStageStatus,
  openStageDisplay,
  publishStagePayload,
  setMainCloseGuard,
} from "./services/tauri";
import { defaultSettings, loadPersistedData, savePersistedData } from "./services/persistence";
import { DurationInput } from "./components/DurationInput";
import { createId } from "./utils/ids";
import { parseProgramText } from "./utils/parser";
import { cloneSectionsForTemplate, createSection, sectionsFromTemplate } from "./utils/program";
import { generateReport, keepLatestReports } from "./utils/reports";
import { formatDuration, formatTimer, localDateString, parseDuration, secondsToInput } from "./utils/time";
import {
  applySectionTimeAdjustment as adjustSectionTime,
  currentSection,
  elapsedForSection,
  nextSection,
  remainingForSection,
  snapshotRunningService,
  stagePayloadFromService,
  timerTone,
} from "./utils/timer";

interface DraftService {
  id: string;
  name: string;
  warningInput: string;
  autoMoveToNextSection: boolean;
  sections: Section[];
  selectedDisplayId: string | null;
  stageDisplayOpenedOnce: boolean;
  startingSectionId: string | null;
}

interface TimeModalState {
  mode: "add" | "reduce" | null;
  value: string;
  error: string;
}

interface SectionModalState {
  mode: "add" | "edit" | null;
  targetId: string | null;
  name: string;
  duration: string;
  error: string;
}

interface TemplateSaveModalState {
  open: boolean;
  name: string;
  error: string;
  saved: boolean;
}

interface ConfirmModalState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  tone?: "danger" | "normal";
  secondaryTone?: "danger" | "normal";
  error?: string;
  onConfirm: () => void;
  onSecondary?: () => void;
}

type SetupMethod = "blank" | "template" | "paste";

function isUnfinishedActiveService(service: ActiveService | null): service is ActiveService {
  return Boolean(service && service.status !== "ended");
}

function hasReportableServiceActivity(service: ActiveService): boolean {
  return service.sections.some(
    (section) =>
      section.actualElapsedSeconds > 0 ||
      Boolean(section.startedAt) ||
      Boolean(section.endedAt) ||
      section.status === "running" ||
      section.status === "paused" ||
      section.status === "completed" ||
      section.status === "skipped",
  );
}

const initialState: AppState = {
  screen: "home",
  settings: defaultSettings(),
  templates: [],
  reports: [],
  activeService: null,
  stageDisplayStatus: { opened: false, connected: false, message: "Stage display not opened." },
  updateStatus: { checked: false, checking: false, available: false, message: "" },
};

function emptyDraft(settings: Settings): DraftService {
  return {
    id: createId("service"),
    name: "",
    warningInput: secondsToInput(settings.defaultWarningTimeSeconds),
    autoMoveToNextSection: settings.autoMoveToNextSection,
    sections: [],
    selectedDisplayId: settings.lastSelectedDisplayId,
    stageDisplayOpenedOnce: false,
    startingSectionId: null,
  };
}

function primaryDisplay(displays: DisplayInfo[]): DisplayInfo | null {
  return displays.find((display) => display.isPrimary) ?? displays[0] ?? null;
}

function stageDisplay(displays: DisplayInfo[]): DisplayInfo | null {
  return displays.find((display) => display.connected && !display.isPrimary) ?? primaryDisplay(displays);
}

function resolveStageDisplayId(displays: DisplayInfo[], selectedDisplayId: string | null): string | null {
  const selected = selectedDisplayId ? displays.find((display) => display.id === selectedDisplayId) : null;
  const secondScreen = displays.find((display) => display.connected && !display.isPrimary);
  return secondScreen?.id ?? (selected?.connected ? selected.id : stageDisplay(displays)?.id ?? null);
}

function stageSetupMessage(displays: DisplayInfo[], selectedDisplayId: string | null): string {
  if (displays.length <= 1) {
    return "Windows is only detecting one display. Connect the second screen and set Windows display mode to Extend.";
  }
  const selected = selectedDisplayId ? displays.find((display) => display.id === selectedDisplayId) : null;
  if (selected?.connected) return `Stage display will open on ${selected.name}.`;
  return "Choose a display, or start live control to open the stage display on the second screen.";
}

function stageDisplayErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail
    ? `Stage display could not open: ${detail}`
    : "Stage display could not open. Live control can continue without it.";
}

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [draft, setDraft] = useState<DraftService>(() => emptyDraft(defaultSettings()));
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedReport, setSelectedReport] = useState<ServiceReport | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedProgramRow[]>([]);
  const [selectedSetupMethod, setSelectedSetupMethod] = useState<SetupMethod | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [pasteSetupLoaded, setPasteSetupLoaded] = useState(false);
  const [timeModal, setTimeModal] = useState<TimeModalState>({ mode: null, value: "00:05:00", error: "" });
  const [sectionModal, setSectionModal] = useState<SectionModalState>({
    mode: null,
    targetId: null,
    name: "",
    duration: "00:05:00",
    error: "",
  });
  const [templateSaveModal, setTemplateSaveModal] = useState<TemplateSaveModalState>({
    open: false,
    name: "",
    error: "",
    saved: false,
  });
  const [isStartingLive, setIsStartingLive] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const hydrated = useRef(false);
  const stateRef = useRef<AppState>(initialState);
  const displayIdsRef = useRef<Set<string>>(new Set());
  const promptedDisplayIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshDisplays = useCallback(async () => {
    const nextDisplays = await listDisplays();
    const previousIds = displayIdsRef.current;
    const nextIds = new Set(nextDisplays.map((display) => display.id));
    const newlyDetected = nextDisplays.filter((display) => !previousIds.has(display.id) && !display.isPrimary);
    displayIdsRef.current = nextIds;
    setDisplays(nextDisplays);

    const currentState = stateRef.current;
    const activeService = currentState.activeService;
    const selectedId = activeService?.selectedDisplayId ?? currentState.settings.lastSelectedDisplayId;
    const selected = selectedId ? nextDisplays.find((display) => display.id === selectedId) : null;
    const connected = Boolean(selected?.connected);
    const primary = primaryDisplay(nextDisplays);

    if (activeService && selectedId && !connected && primary) {
      await openStageDisplay(primary.id, false);
      setState((current) => ({
        ...current,
        activeService: current.activeService
          ? { ...current.activeService, selectedDisplayId: primary.id }
          : current.activeService,
        stageDisplayStatus: {
          opened: true,
          connected: true,
          message: "Selected display disconnected. Stage display moved to the primary screen.",
        },
      }));
      return;
    }

    if (activeService && nextDisplays.length > 1) {
      const candidate = newlyDetected.find((display) => !promptedDisplayIdsRef.current.has(display.id));
      if (candidate) {
        promptedDisplayIdsRef.current.add(candidate.id);
        setConfirmModal({
          title: "Second display detected",
          message: "A second display is now available. Do you want to move the stage display to it?",
          cancelLabel: "Keep here",
          confirmLabel: "Move stage display",
          tone: "normal",
          onConfirm: () => {
            setConfirmModal(null);
            void moveStageDisplayTo(candidate.id);
          },
        });
      }
    }

    setState((current) => {
      return {
        ...current,
        stageDisplayStatus: {
          ...current.stageDisplayStatus,
          connected,
          message: current.activeService
            ? selectedId && !connected
              ? "Selected display disconnected."
              : current.stageDisplayStatus.message
            : stageSetupMessage(nextDisplays, current.settings.lastSelectedDisplayId),
        },
      };
    });
  }, []);

  useEffect(() => {
    loadPersistedData().then((data) => {
      setState((current) => ({
        ...current,
        settings: data.settings,
        templates: data.templates,
        reports: data.reports,
        activeService: data.activeService,
      }));
      setDraft(emptyDraft(data.settings));
      hydrated.current = true;
    });
    refreshDisplays();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    onStageStatus((status) => {
      setState((current) => ({ ...current, stageDisplayStatus: status }));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    onMainCloseRequested(() => {
      const hasActiveService = isUnfinishedActiveService(stateRef.current.activeService);
      if (hasActiveService) {
        setConfirmModal({
          title: "End service before closing",
          message: "Closing the app will end the running service, stop the timer, and close the stage display.",
          confirmLabel: "End service and close app",
          tone: "danger",
          onConfirm: () => {
            setConfirmModal(null);
            void finalizeActiveService({ closeApp: true });
          },
        });
      }
      return hasActiveService;
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    void setMainCloseGuard(isUnfinishedActiveService(state.activeService));
  }, [state.activeService]);

  useEffect(() => {
    if (!state.activeService) return;
    const interval = window.setInterval(refreshDisplays, 6000);
    return () => window.clearInterval(interval);
  }, [refreshDisplays, state.activeService]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timeout = window.setTimeout(() => {
      savePersistedData({
        settings: state.settings,
        templates: state.templates,
        reports: state.reports,
        activeService: state.activeService,
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [state.settings, state.templates, state.reports, state.activeService]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setState((current) => {
        if (!current.activeService || current.activeService.status === "ended") return current;
        return { ...current, activeService: snapshotRunningService(current.activeService) };
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const active = state.activeService;

  const navigate = (screen: Screen) => setState((current) => ({ ...current, screen }));

  const openFreshStartSetup = () => {
    setDraft(emptyDraft(state.settings));
    setSelectedSetupMethod(null);
    setSelectedTemplateId(null);
    setPasteSetupLoaded(false);
    setParsedRows([]);
    navigate("start");
  };

  const startNewService = () => {
    if (!isUnfinishedActiveService(stateRef.current.activeService)) {
      openFreshStartSetup();
      return;
    }

    setConfirmModal({
      title: "Service currently ongoing",
      message: "A service is currently in progress. Resume the ongoing service or end it before starting a new one.",
      confirmLabel: "Resume service",
      secondaryLabel: "End service and start new",
      cancelLabel: "Cancel",
      tone: "normal",
      secondaryTone: "danger",
      onConfirm: () => {
        setConfirmModal(null);
        navigate("live");
      },
      onSecondary: () => {
        void endActiveServiceAndStartNew();
      },
    });
  };

  const beginBlank = () => {
    if (selectedSetupMethod !== "blank") {
      setDraft(emptyDraft(state.settings));
      setSelectedTemplateId(null);
      setPasteSetupLoaded(false);
    }
    setSelectedSetupMethod("blank");
  };

  const beginFromTemplate = (template: Template) => {
    const sections = sectionsFromTemplate(template);
    setDraft({
      ...emptyDraft(state.settings),
      sections,
      startingSectionId: sections[0]?.id ?? null,
    });
    setSelectedSetupMethod("template");
    setSelectedTemplateId(template.id);
    setPasteSetupLoaded(false);
  };

  const createFromPaste = () => {
    const rows = parseProgramText(pasteText);
    setParsedRows(rows);
    setSelectedSetupMethod("paste");
    setPasteSetupLoaded(false);
  };

  const confirmPasteRows = () => {
    const sections = parsedRows.filter((row) => row.valid).map((row) => createSection(row.name, row.durationSeconds));
    setDraft((current) => ({
      ...current,
      sections,
      startingSectionId: sections[0]?.id ?? null,
    }));
    setSelectedSetupMethod("paste");
    setSelectedTemplateId(null);
    setPasteSetupLoaded(true);
  };

  const openOrTestStage = async (testMode = true) => {
    const currentDisplays = displays.length > 0 ? displays : await listDisplays();
    const targetDisplayId = resolveStageDisplayId(currentDisplays, draft.selectedDisplayId);
    if (!targetDisplayId) {
      setState((current) => ({
        ...current,
        stageDisplayStatus: { opened: false, connected: false, message: "No display was detected." },
      }));
      return;
    }
    try {
      await openStageDisplay(targetDisplayId, testMode);
      await publishStagePayload({
        mode: "test",
        sectionName: "Timer display connected",
        timerText: "",
        tone: "normal",
      });
    } catch (error) {
      console.error("Stage display test failed.", error);
      setState((current) => ({
        ...current,
        stageDisplayStatus: {
          opened: false,
          connected: false,
          message: stageDisplayErrorMessage(error),
        },
      }));
      return;
    }
    setDraft((current) => ({ ...current, selectedDisplayId: targetDisplayId, stageDisplayOpenedOnce: true }));
    setState((current) => ({
      ...current,
      settings: { ...current.settings, lastSelectedDisplayId: targetDisplayId },
    stageDisplayStatus: {
        opened: true,
        connected: true,
        message: currentDisplays.length <= 1
          ? "Windows is only detecting one display. Stage display opened on this screen."
          : "Stage display ready.",
      },
    }));
  };

  const getCurrentDisplays = async () => {
    try {
      return displays.length > 0 ? displays : await listDisplays();
    } catch (error) {
      console.error("Display detection failed.", error);
      return [];
    }
  };

  const openStageWithTimeout = async (displayId: string, testMode = false) => {
    await Promise.race([
      openStageDisplay(displayId, testMode),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Stage display did not respond in time.")), 5000);
      }),
    ]);
  };

  const createActiveService = async () => {
    if (isStartingLive) return;
    const warningSeconds = parseDuration(draft.warningInput);
    if (!draft.name.trim()) return showStageMessage("Service name is required.");
    if (warningSeconds === null || warningSeconds < 0) return showStageMessage("Warning time must use HH:MM:SS.");
    if (draft.sections.length === 0) return showStageMessage("Add at least one section.");
    if (draft.sections.some((section) => !section.name.trim() || section.adjustedDurationSeconds <= 0)) {
      return showStageMessage("Every section needs a name and duration greater than zero.");
    }

    setIsStartingLive(true);
    showStageMessage("Starting live control...");

    const currentDisplays = await getCurrentDisplays();
    const targetDisplayId = resolveStageDisplayId(currentDisplays, draft.selectedDisplayId) ?? draft.selectedDisplayId ?? "primary";
    let stageOpened = false;
    let stageMessage =
      currentDisplays.length <= 1
        ? "Windows is only detecting one display. Stage display opened on this screen."
        : "Stage display ready.";
    try {
      await openStageWithTimeout(targetDisplayId, false);
      stageOpened = true;
    } catch (error) {
      console.error("Stage display failed to open while starting live control.", error);
      stageMessage = `${stageDisplayErrorMessage(error)} Use Reopen stage display from live control when ready.`;
    }

    const startIndex = Math.max(
      0,
      draft.sections.findIndex((section) => section.id === draft.startingSectionId),
    );
    const now = new Date().toISOString();
    const sections = draft.sections.slice(startIndex).map((section) => ({ ...section, status: "pending" as const }));
    const service: ActiveService = {
      id: draft.id,
      name: draft.name.trim(),
      date: localDateString(),
      warningThresholdSeconds: warningSeconds,
      autoMoveToNextSection: draft.autoMoveToNextSection,
      sections,
      currentSectionId: sections[0]?.id ?? null,
      status: "setup",
      stageDisplayOpenedOnce: stageOpened,
      stageDisplayHidden: false,
      selectedDisplayId: targetDisplayId,
      createdAt: now,
      updatedAt: now,
    };

    await publishStagePayload(stagePayloadFromService(service));
    setState((current) => ({
      ...current,
      activeService: service,
      settings: { ...current.settings, lastSelectedDisplayId: targetDisplayId },
      stageDisplayStatus: {
        opened: stageOpened,
        connected: stageOpened,
        message: stageMessage,
      },
      screen: "live",
    }));
    setIsStartingLive(false);
  };

  const showStageMessage = (message: string) => {
    setState((current) => ({ ...current, stageDisplayStatus: { ...current.stageDisplayStatus, message } }));
  };

  const updateActive = (updater: (service: ActiveService) => ActiveService | null) => {
    setState((current) => {
      if (!current.activeService) return current;
      return { ...current, activeService: updater(current.activeService) };
    });
  };

  const moveStageDisplayTo = async (displayId: string) => {
    try {
      await openStageDisplay(displayId, false);
    } catch (error) {
      console.error("Stage display move failed.", error);
      setState((current) => ({
        ...current,
        stageDisplayStatus: {
          opened: false,
          connected: false,
          message: stageDisplayErrorMessage(error),
        },
      }));
      return;
    }
    setState((current) => ({
      ...current,
      settings: { ...current.settings, lastSelectedDisplayId: displayId },
      activeService: current.activeService ? { ...current.activeService, selectedDisplayId: displayId } : null,
      stageDisplayStatus: { opened: true, connected: true, message: "Stage display moved." },
    }));
  };

  const startSection = () => {
    updateActive((service) => {
      const now = new Date().toISOString();
      return {
        ...service,
        status: "running",
        updatedAt: now,
        sections: service.sections.map((section) =>
          section.id === service.currentSectionId
            ? { ...section, status: "running", startedAt: now, endedAt: null }
            : section,
        ),
      };
    });
  };

  const pauseService = () => {
    updateActive((service) => {
      const now = Date.now();
      return {
        ...service,
        status: "paused",
        updatedAt: new Date(now).toISOString(),
        sections: service.sections.map((section) =>
          section.id === service.currentSectionId
            ? { ...section, status: "paused", actualElapsedSeconds: elapsedForSection(section, now), startedAt: null }
            : section,
        ),
      };
    });
  };

  const resumeService = () => startSection();

  const restartCurrent = () => {
    const service = stateRef.current.activeService;
    const section = currentSection(service);
    const hasStarted = section ? section.actualElapsedSeconds > 0 || Boolean(section.startedAt) : false;
    if (!hasStarted) {
      applyRestartCurrent();
      return;
    }
    setConfirmModal({
      title: "Reset current section",
      message: "Reset this section from its planned duration?",
      confirmLabel: "Reset section",
      tone: "danger",
      onConfirm: () => {
        setConfirmModal(null);
        applyRestartCurrent();
      },
    });
  };

  const applyRestartCurrent = () => {
    updateActive((service) => {
      const now = new Date().toISOString();
      const shouldRun = service.status === "running";
      return {
        ...service,
        status: shouldRun ? "running" : "paused",
        updatedAt: now,
        sections: service.sections.map((section) =>
          section.id === service.currentSectionId
            ? {
                ...section,
                actualElapsedSeconds: 0,
                startedAt: shouldRun ? now : null,
                endedAt: null,
                status: shouldRun ? "running" : "paused",
              }
            : section,
        ),
      };
    });
  };

  const moveToNext = () => {
    const service = stateRef.current.activeService;
    if (service && !nextSection(service)) {
      setConfirmModal({
        title: "No upcoming sections",
        message: "There is no next program section. End this service and save the report?",
        confirmLabel: "End and Save",
        tone: "danger",
        onConfirm: () => {
          setConfirmModal(null);
          void finalizeActiveService();
        },
      });
      return;
    }
    setConfirmModal({
      title: "Move to next section",
      message: "Move the live timer to the next program section?",
      confirmLabel: "Next section",
      tone: "danger",
      onConfirm: () => {
        setConfirmModal(null);
        applyMoveToNext();
      },
    });
  };

  const applyMoveToNext = () => {
    updateActive((service) => moveToNextSection(service, false));
  };

  const moveToPrevious = () => {
    const service = stateRef.current.activeService;
    if (!service) return;
    const currentIndex = service.sections.findIndex((section) => section.id === service.currentSectionId);
    if (currentIndex <= 0) return;
    const previous = service.sections[currentIndex - 1];
    if (previous.status === "completed" || previous.status === "skipped" || previous.actualElapsedSeconds > 0 || previous.endedAt) {
      setConfirmModal({
        title: "Go back to previous section?",
        message: "This will reactivate the previous section and may update its timing in the final report.",
        confirmLabel: "Go back",
        tone: "danger",
        onConfirm: () => {
          setConfirmModal(null);
          applyMoveToPrevious();
        },
      });
      return;
    }
    applyMoveToPrevious();
  };

  const applyMoveToPrevious = () => {
    updateActive((service) => {
      const now = Date.now();
      const iso = new Date(now).toISOString();
      const currentIndex = service.sections.findIndex((section) => section.id === service.currentSectionId);
      if (currentIndex <= 0) return service;
      const previous = service.sections[currentIndex - 1];
      const wasRunning = service.status === "running";

      return {
        ...service,
        status: wasRunning ? "running" : "paused",
        currentSectionId: previous.id,
        updatedAt: iso,
        sections: service.sections.map((section) => {
          if (section.id === service.currentSectionId) {
            return {
              ...section,
              status: "pending",
              actualElapsedSeconds: elapsedForSection(section, now),
              startedAt: null,
              endedAt: null,
            };
          }
          if (section.id === previous.id) {
            return {
              ...section,
              status: wasRunning ? "running" : "pending",
              actualElapsedSeconds: 0,
              startedAt: wasRunning ? iso : null,
              endedAt: null,
            };
          }
          return section;
        }),
      };
    });
  };

  const moveToNextSection = (service: ActiveService, endedAtPlannedTime: boolean): ActiveService => {
    const now = Date.now();
    const currentIndex = service.sections.findIndex((section) => section.id === service.currentSectionId);
    const next = service.sections.slice(currentIndex + 1).find((section) => section.status === "pending");
    const wasRunning = service.status === "running";
    const iso = new Date(now).toISOString();

    return {
      ...service,
      status: next ? (wasRunning ? "running" : "paused") : "paused",
      currentSectionId: next?.id ?? service.currentSectionId,
      updatedAt: iso,
      sections: service.sections.map((section) => {
        if (section.id === service.currentSectionId) {
          const elapsed = endedAtPlannedTime ? section.adjustedDurationSeconds : elapsedForSection(section, now);
          return {
            ...section,
            status: elapsed > 0 ? "completed" : "skipped",
            actualElapsedSeconds: elapsed,
            startedAt: null,
            endedAt: iso,
          };
        }
        if (next && section.id === next.id) {
          return { ...section, status: wasRunning ? "running" : "pending", startedAt: wasRunning ? iso : null };
        }
        return section;
      }),
    };
  };

  const applyTimeChange = () => {
    if (!timeModal.mode) return;
    const mode = timeModal.mode;
    const seconds = parseDuration(timeModal.value);
    if (seconds === null || seconds <= 0) {
      setTimeModal((current) => ({ ...current, error: "Enter a duration greater than zero in HH:MM:SS." }));
      return;
    }
    updateCurrentSectionTime(mode, seconds);
    setTimeModal({ mode: null, value: "00:01:00", error: "" });
  };

  const applyQuickTimeChange = (seconds: number) => {
    updateCurrentSectionTime(seconds < 0 ? "reduce" : "add", Math.abs(seconds));
  };

  const updateCurrentSectionTime = (mode: "add" | "reduce", seconds: number) => {
    updateActive((service) => ({
      ...service,
      updatedAt: new Date().toISOString(),
      sections: service.sections.map((section) => {
        if (section.id !== service.currentSectionId) return section;
        return adjustSectionTime(section, mode, seconds);
      }),
    }));
  };

  const toggleStageHidden = () => {
    updateActive((service) => ({ ...service, stageDisplayHidden: !service.stageDisplayHidden }));
  };

  const finalizeActiveService = useCallback(async ({ closeApp = false }: { closeApp?: boolean } = {}) => {
    const current = stateRef.current;
    const service = current.activeService;
    if (!service) {
      if (closeApp) await closeApplication();
      return;
    }

    const snapshot = snapshotRunningService(service);
    const endedAt = new Date().toISOString();
    const report = generateReport({
      ...snapshot,
      status: "ended",
      sections: snapshot.sections.map((section) =>
        section.status === "running" || section.status === "paused"
          ? { ...section, status: "completed", endedAt, startedAt: null }
          : section,
      ),
    });
    const reports = keepLatestReports([report, ...current.reports]);
    const nextState: AppState = {
      ...current,
      activeService: null,
      reports,
      screen: closeApp ? current.screen : "reportDetail",
    };

    stateRef.current = nextState;
    setState(nextState);
    setSelectedReport(report);
    await publishStagePayload({ mode: "blank", sectionName: "", timerText: "00:00:00", tone: "normal" });
    await savePersistedData({
      settings: nextState.settings,
      templates: nextState.templates,
      reports: nextState.reports,
      activeService: null,
    });
    if (closeApp) await closeApplication();
  }, []);

  const endActiveServiceAndStartNew = async () => {
    const current = stateRef.current;
    const service = current.activeService;
    if (!isUnfinishedActiveService(service)) {
      setConfirmModal(null);
      openFreshStartSetup();
      return;
    }

    const snapshot = snapshotRunningService(service);
    const shouldSaveReport = hasReportableServiceActivity(snapshot);
    const endedAt = new Date().toISOString();
    const report = shouldSaveReport
      ? generateReport({
          ...snapshot,
          status: "ended",
          sections: snapshot.sections.map((section) =>
            section.status === "running" || section.status === "paused"
              ? { ...section, status: "completed", endedAt, startedAt: null }
              : section,
          ),
        })
      : null;
    const reports = report ? keepLatestReports([report, ...current.reports]) : current.reports;
    const nextState: AppState = {
      ...current,
      activeService: null,
      reports,
      screen: "start",
    };

    try {
      await publishStagePayload({ mode: "blank", sectionName: "", timerText: "00:00:00", tone: "normal" });
      await savePersistedData({
        settings: nextState.settings,
        templates: nextState.templates,
        reports: nextState.reports,
        activeService: null,
      });
    } catch {
      setConfirmModal((modal) =>
        modal
          ? {
              ...modal,
              error: "Could not save the current service report. Resume the service or try again.",
            }
          : modal,
      );
      return;
    }

    stateRef.current = nextState;
    setState(nextState);
    setSelectedReport(null);
    setConfirmModal(null);
    setDraft(emptyDraft(nextState.settings));
    setSelectedSetupMethod(null);
    setSelectedTemplateId(null);
    setPasteSetupLoaded(false);
    setParsedRows([]);
  };

  const endService = () => {
    if (!active) return;
    setConfirmModal({
      title: "End service and save report",
      message: "This will close the live service and save a planned versus actual report.",
      confirmLabel: "End and Save",
      tone: "danger",
      onConfirm: () => {
        setConfirmModal(null);
        void finalizeActiveService();
      },
    });
  };

  const saveDraftAsTemplate = () => {
    setTemplateSaveModal({ open: true, name: draft.name.trim(), error: "", saved: false });
  };

  const confirmSaveDraftAsTemplate = () => {
    const name = templateSaveModal.name.trim();
    if (!name) {
      setTemplateSaveModal((current) => ({ ...current, error: "Template name is required.", saved: false }));
      return;
    }
    if (draft.sections.length === 0) {
      setTemplateSaveModal((current) => ({ ...current, error: "Add at least one section before saving a template.", saved: false }));
      return;
    }
    if (draft.sections.some((section) => !section.name.trim() || section.adjustedDurationSeconds <= 0)) {
      setTemplateSaveModal((current) => ({ ...current, error: "Every section needs a name and duration greater than zero.", saved: false }));
      return;
    }
    const now = new Date().toISOString();
    const template: Template = {
      id: createId("template"),
      name,
      sections: cloneSectionsForTemplate(draft.sections),
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => ({ ...current, templates: [template, ...current.templates] }));
    setTemplateSaveModal((current) => ({ ...current, error: "", saved: true }));
  };

  const saveTemplate = (template: Template) => {
    setState((current) => {
      const exists = current.templates.some((item) => item.id === template.id);
      return {
        ...current,
        templates: exists
          ? current.templates.map((item) => (item.id === template.id ? template : item))
          : [template, ...current.templates],
        screen: "templates",
      };
    });
    setEditingTemplate(null);
  };

  const deleteTemplate = (templateId: string) => {
    setConfirmModal({
      title: "Delete template",
      message: "Delete this template? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => {
        setConfirmModal(null);
        setState((current) => ({
          ...current,
          templates: current.templates.filter((template) => template.id !== templateId),
        }));
      },
    });
  };

  const checkUpdates = async () => {
    setState((current) => ({ ...current, updateStatus: { ...current.updateStatus, checking: true } }));
    const result = await checkForUpdate();
    setState((current) => ({
      ...current,
      updateStatus: {
        checked: true,
        checking: false,
        available: result.available,
        message: result.message,
      },
    }));
  };

  return (
    <div className={`app-shell theme-${state.settings.theme}`}>
      <Header screen={state.screen} onHome={() => navigate("home")} />
      <main className="main-view">
        {state.screen === "home" && (
          <HomeScreen
            state={state}
            onStart={startNewService}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
            onResume={() => navigate("live")}
            onCheckUpdates={checkUpdates}
          />
        )}
        {state.screen === "start" && (
          <StartScreen
            selectedMethod={selectedSetupMethod}
            templates={state.templates}
            selectedTemplateId={selectedTemplateId}
            draft={draft}
            displays={displays}
            statusMessage={state.stageDisplayStatus.message}
            pasteText={pasteText}
            parsedRows={parsedRows}
            pasteSetupLoaded={pasteSetupLoaded}
            isStartingLive={isStartingLive}
            onBlank={beginBlank}
            onTemplate={() => setSelectedSetupMethod("template")}
            onUseTemplate={beginFromTemplate}
            onPaste={() => setSelectedSetupMethod("paste")}
            onPasteTextChange={(value) => {
              setPasteText(value);
              setPasteSetupLoaded(false);
            }}
            onParsePaste={createFromPaste}
            onParsedRows={setParsedRows}
            onConfirmPaste={confirmPasteRows}
            onDraft={setDraft}
            onRefreshDisplays={refreshDisplays}
            onStageSetup={() => navigate("stageSetup")}
            onSaveTemplate={saveDraftAsTemplate}
            onStart={createActiveService}
            onBack={() => navigate("home")}
          />
        )}
        {state.screen === "builder" && (
          <ProgramBuilder
            draft={draft}
            displays={displays}
            statusMessage={state.stageDisplayStatus.message}
            isStartingLive={isStartingLive}
            onDraft={setDraft}
            onRefreshDisplays={refreshDisplays}
            onStageSetup={() => navigate("stageSetup")}
            onSaveTemplate={saveDraftAsTemplate}
            onStart={createActiveService}
            onBack={() => navigate("start")}
          />
        )}
        {state.screen === "stageSetup" && (
          <StageSetup
            draft={draft}
            displays={displays}
            statusMessage={state.stageDisplayStatus.message}
            onDraft={setDraft}
            onRefreshDisplays={refreshDisplays}
            onTest={() => openOrTestStage(true)}
            onBack={() => navigate("start")}
          />
        )}
        {state.screen === "live" && active && (
          <LiveControlPanel
            service={active}
            displays={displays}
            status={state.stageDisplayStatus}
            timeModal={timeModal}
            sectionModal={sectionModal}
            onTimeModal={setTimeModal}
            onSectionModal={setSectionModal}
            onStart={startSection}
            onPause={pauseService}
            onResume={resumeService}
            onRestart={restartCurrent}
            onPreviousSection={moveToPrevious}
            onNextSection={moveToNext}
            onApplyTime={applyTimeChange}
            onQuickTimeChange={applyQuickTimeChange}
            onToggleStage={toggleStageHidden}
            onReopenStage={() => active.selectedDisplayId && openOrTestLiveStage(active.selectedDisplayId)}
            onChooseDisplay={(displayId) => void moveStageDisplayTo(displayId)}
            onRefreshDisplays={refreshDisplays}
            onEnd={endService}
            updateActive={updateActive}
            moveToNextSection={moveToNextSection}
          />
        )}
        {state.screen === "templates" && (
          <TemplatesScreen
            templates={state.templates}
            onNew={() => {
              const now = new Date().toISOString();
              setEditingTemplate({
                id: createId("template"),
                name: "New Template",
                sections: [createSection("Worship", 1200)],
                createdAt: now,
                updatedAt: now,
              });
              navigate("templateEditor");
            }}
            onEdit={(template) => {
              setEditingTemplate(template);
              navigate("templateEditor");
            }}
            onUse={(template) => {
              beginFromTemplate(template);
              navigate("start");
            }}
            onDelete={deleteTemplate}
            onBack={() => navigate("home")}
          />
        )}
        {state.screen === "templateEditor" && editingTemplate && (
          <TemplateEditor template={editingTemplate} onSave={saveTemplate} onBack={() => navigate("templates")} />
        )}
        {state.screen === "reports" && (
          <ReportsScreen
            reports={state.reports}
            onOpen={(report) => {
              setSelectedReport(report);
              navigate("reportDetail");
            }}
            onBack={() => navigate("home")}
          />
        )}
        {state.screen === "reportDetail" && selectedReport && (
          <ReportDetail report={selectedReport} onBack={() => navigate("reports")} />
        )}
        {state.screen === "settings" && (
          <SettingsScreen
            settings={state.settings}
            onSettings={(settings) => setState((current) => ({ ...current, settings }))}
            onCheckUpdates={checkUpdates}
            updateStatus={state.updateStatus}
            onBack={() => navigate("home")}
          />
        )}
      </main>
      <StagePublisher service={active} />
      {templateSaveModal.open && (
        <Modal
          title={templateSaveModal.saved ? "Template saved" : "Save as template"}
          onClose={() => setTemplateSaveModal({ open: false, name: "", error: "", saved: false })}
        >
          {templateSaveModal.saved ? (
            <>
              <p className="muted">Template saved successfully.</p>
              <div className="button-row end">
                <button className="primary large" onClick={() => setTemplateSaveModal({ open: false, name: "", error: "", saved: false })}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">Save this program as a reusable service template.</p>
              <label>
                Template name
                <input
                  autoFocus
                  value={templateSaveModal.name}
                  onChange={(event) => setTemplateSaveModal((current) => ({ ...current, name: event.target.value, error: "" }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmSaveDraftAsTemplate();
                  }}
                />
              </label>
              {templateSaveModal.error && <p className="error-text">{templateSaveModal.error}</p>}
              <div className="button-row end">
                <button className="ghost large" onClick={() => setTemplateSaveModal({ open: false, name: "", error: "", saved: false })}>
                  Cancel
                </button>
                <button className="primary large" onClick={confirmSaveDraftAsTemplate}>
                  Save template
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {confirmModal && (
        <Modal title={confirmModal.title} onClose={() => setConfirmModal(null)}>
          <p className="muted">{confirmModal.message}</p>
          {confirmModal.error && <p className="error-text">{confirmModal.error}</p>}
          <div className="button-row end">
            <button className="ghost large" onClick={() => setConfirmModal(null)}>
              {confirmModal.cancelLabel ?? "Cancel"}
            </button>
            {confirmModal.secondaryLabel && confirmModal.onSecondary && (
              <button
                className={`${confirmModal.secondaryTone === "danger" ? "danger" : "ghost"} large`}
                onClick={confirmModal.onSecondary}
              >
                {confirmModal.secondaryLabel}
              </button>
            )}
            <button className={`${confirmModal.tone === "danger" ? "danger" : "primary"} large`} onClick={confirmModal.onConfirm}>
              {confirmModal.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );

  async function openOrTestLiveStage(displayId: string) {
    try {
      await openStageDisplay(displayId, false);
    } catch (error) {
      console.error("Stage display reopen failed.", error);
      setState((current) => ({
        ...current,
        stageDisplayStatus: {
          opened: false,
          connected: false,
          message: stageDisplayErrorMessage(error),
        },
      }));
      return;
    }
    setState((current) => ({
      ...current,
      stageDisplayStatus: { opened: true, connected: true, message: "Stage display reopened." },
    }));
  }
}

function Header({ screen, onHome }: { screen: Screen; onHome: () => void }) {
  return (
    <header className="app-header">
      <div className="brand">
        <Clock size={22} />
        <span>Service Timer</span>
      </div>
      {screen !== "home" && (
        <button className="ghost icon-label" onClick={onHome}>
          <Home size={18} /> Home
        </button>
      )}
    </header>
  );
}

function HomeScreen({
  state,
  onStart,
  onTemplates,
  onReports,
  onSettings,
  onResume,
  onCheckUpdates,
}: {
  state: AppState;
  onStart: () => void;
  onTemplates: () => void;
  onReports: () => void;
  onSettings: () => void;
  onResume: () => void;
  onCheckUpdates: () => void;
}) {
  return (
    <section className="home-grid">
      <div className="hero-panel">
        <h1>Service Timer</h1>
        <p>Prepare the program, run each section, and keep the stage timer clear under pressure.</p>
        {state.activeService && (
          <button className="primary large" onClick={onResume}>
            <Play size={20} /> Resume active service
          </button>
        )}
        {state.updateStatus.available && (
          <div className="update-banner">
            <strong>New update available</strong>
            <button className="primary small">Update now</button>
            <button className="ghost small">Later</button>
          </div>
        )}
      </div>
      <div className="home-actions">
        <button className="tile primary-tile" onClick={onStart}>
          <Play /> Start New Service
        </button>
        <button className="tile" onClick={onTemplates}>
          <Copy /> Templates
        </button>
        <button className="tile" onClick={onReports}>
          <History /> Report History
        </button>
        <button className="tile" onClick={onSettings}>
          <SettingsIcon /> Settings
        </button>
      </div>
      <button className="ghost check-update" onClick={onCheckUpdates}>
        {state.updateStatus.checking ? "Checking updates..." : "Check for updates"}
      </button>
      {state.updateStatus.checked && !state.updateStatus.available && <p className="muted">{state.updateStatus.message}</p>}
    </section>
  );
}

function StartScreen({
  selectedMethod,
  templates,
  selectedTemplateId,
  draft,
  displays,
  statusMessage,
  pasteText,
  parsedRows,
  pasteSetupLoaded,
  isStartingLive,
  onBlank,
  onTemplate,
  onUseTemplate,
  onPaste,
  onPasteTextChange,
  onParsePaste,
  onParsedRows,
  onConfirmPaste,
  onDraft,
  onRefreshDisplays,
  onStageSetup,
  onSaveTemplate,
  onStart,
  onBack,
}: {
  selectedMethod: SetupMethod | null;
  templates: Template[];
  selectedTemplateId: string | null;
  draft: DraftService;
  displays: DisplayInfo[];
  statusMessage: string;
  pasteText: string;
  parsedRows: ParsedProgramRow[];
  pasteSetupLoaded: boolean;
  isStartingLive: boolean;
  onBlank: () => void;
  onTemplate: () => void;
  onUseTemplate: (template: Template) => void;
  onPaste: () => void;
  onPasteTextChange: (value: string) => void;
  onParsePaste: () => void;
  onParsedRows: (rows: ParsedProgramRow[]) => void;
  onConfirmPaste: () => void;
  onDraft: (draft: DraftService | ((draft: DraftService) => DraftService)) => void;
  onRefreshDisplays: () => void;
  onStageSetup: () => void;
  onSaveTemplate: () => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const selectedTemplate = selectedTemplateId ? templates.find((template) => template.id === selectedTemplateId) : null;

  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      <h1>Start New Service</h1>
      <div className="choice-grid">
        <button className={`choice ${selectedMethod === "blank" ? "active" : "secondary"}`} onClick={onBlank} aria-pressed={selectedMethod === "blank"}>
          <Plus /> Start with blank program time sheet
        </button>
        <button className={`choice ${selectedMethod === "template" ? "active" : "secondary"}`} onClick={onTemplate} aria-pressed={selectedMethod === "template"}>
          <Copy /> Start from saved template
        </button>
        <button className="choice secondary" disabled aria-disabled="true" onClick={onPaste}>
          <FileText /> Paste program text
          <span className="coming-soon-pill">Coming soon</span>
        </button>
      </div>
      {selectedMethod && (
        <div className="selected-setup-panel">
          {selectedMethod === "blank" && (
            <ProgramBuilder
              draft={draft}
              displays={displays}
              statusMessage={statusMessage}
              isStartingLive={isStartingLive}
              onDraft={onDraft}
              onRefreshDisplays={onRefreshDisplays}
              onStageSetup={onStageSetup}
              onSaveTemplate={onSaveTemplate}
              onStart={onStart}
              showBack={false}
            />
          )}
          {selectedMethod === "template" && (
            <div className="stack">
              <TemplatePicker
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onUse={onUseTemplate}
              />
              {selectedTemplate && <p className="selected-source">Selected template: {selectedTemplate.name}</p>}
              {selectedTemplate && (
                <ProgramBuilder
                  draft={draft}
                  displays={displays}
                  statusMessage={statusMessage}
                  isStartingLive={isStartingLive}
                  onDraft={onDraft}
                  onRefreshDisplays={onRefreshDisplays}
                  onStageSetup={onStageSetup}
                  onSaveTemplate={onSaveTemplate}
                  onStart={onStart}
                  showBack={false}
                />
              )}
            </div>
          )}
          {selectedMethod === "paste" && (
            <div className="stack">
              {!pasteSetupLoaded && (
                <>
                  <PasteScreen value={pasteText} onChange={onPasteTextChange} onParse={onParsePaste} />
                  {parsedRows.length > 0 && (
                    <PasteReview rows={parsedRows} onRows={onParsedRows} onConfirm={onConfirmPaste} />
                  )}
                </>
              )}
              {pasteSetupLoaded && (
                <>
                  <p className="selected-source">Pasted program loaded. Review the service setup below.</p>
                  <ProgramBuilder
                    draft={draft}
                    displays={displays}
                    statusMessage={statusMessage}
                    isStartingLive={isStartingLive}
                    onDraft={onDraft}
                    onRefreshDisplays={onRefreshDisplays}
                    onStageSetup={onStageSetup}
                    onSaveTemplate={onSaveTemplate}
                    onStart={onStart}
                    showBack={false}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TemplatePicker({
  templates,
  selectedTemplateId,
  onUse,
  onBack,
}: {
  templates: Template[];
  selectedTemplateId?: string | null;
  onUse: (t: Template) => void;
  onBack?: () => void;
}) {
  return (
    <section className="stack">
      {onBack && <BackButton onClick={onBack} />}
      <h1>Choose Template</h1>
      {templates.length === 0 ? <EmptyState text="No templates saved yet." /> : null}
      <div className="list">
        {templates.map((template) => (
          <div className={`row ${selectedTemplateId === template.id ? "selected-row" : ""}`} key={template.id}>
            <div>
              <strong>{template.name}</strong>
              <p>{template.sections.length} sections{selectedTemplateId === template.id ? " - selected" : ""}</p>
            </div>
            <button className="primary" onClick={() => onUse(template)}>
              {selectedTemplateId === template.id ? "Selected" : "Use Template"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PasteScreen({
  value,
  onChange,
  onParse,
  onBack,
}: {
  value: string;
  onChange: (value: string) => void;
  onParse: () => void;
  onBack?: () => void;
}) {
  return (
    <section className="stack">
      {onBack && <BackButton onClick={onBack} />}
      <h1>Paste Program Text</h1>
      <textarea
        className="paste-box"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={"Worship, 00:20:00\nOpening Prayer, 00:05:00\nSermon, 00:45:00"}
      />
      <button className="primary large" onClick={onParse}>
        Review Program
      </button>
    </section>
  );
}

function PasteReview({
  rows,
  onRows,
  onConfirm,
  onBack,
}: {
  rows: ParsedProgramRow[];
  onRows: (rows: ParsedProgramRow[]) => void;
  onConfirm: () => void;
  onBack?: () => void;
}) {
  const validCount = rows.filter((row) => row.valid).length;
  const updateRow = (index: number, next: Partial<ParsedProgramRow>) => {
    onRows(
      rows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const merged = { ...row, ...next };
        const valid = Boolean(merged.name.trim()) && merged.durationSeconds > 0;
        return {
          ...merged,
          valid,
          error: valid ? undefined : "Section name and duration are required.",
        };
      }),
    );
  };
  return (
    <section className="stack">
      {onBack && <BackButton onClick={onBack} />}
      <h1>Review Pasted Program</h1>
      <div className="list">
        {rows.map((row, index) => (
          <div className={`paste-review-row ${row.valid ? "" : "invalid"}`} key={row.id}>
            <div className="form-grid">
              <label>
                Section name
                <input value={row.name} placeholder={row.raw || "Section name"} onChange={(event) => updateRow(index, { name: event.target.value })} />
              </label>
              <label>
                Duration
                <DurationInput
                  valueSeconds={row.durationSeconds}
                  ariaLabel={`${row.name || "Pasted row"} duration`}
                  onChange={(seconds) => updateRow(index, { durationSeconds: seconds })}
                />
              </label>
            </div>
            {!row.valid && <p className="error-text">{row.error}</p>}
            <button className="ghost danger-text" onClick={() => onRows(rows.filter((_, rowIndex) => rowIndex !== index))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="primary large" disabled={validCount === 0} onClick={onConfirm}>
        Create Service Time Sheet
      </button>
    </section>
  );
}

function ProgramBuilder({
  draft,
  displays,
  statusMessage,
  isStartingLive = false,
  onDraft,
  onRefreshDisplays,
  onStageSetup,
  onSaveTemplate,
  onStart,
  onBack,
  showBack = true,
}: {
  draft: DraftService;
  displays: DisplayInfo[];
  statusMessage: string;
  isStartingLive?: boolean;
  onDraft: (draft: DraftService | ((draft: DraftService) => DraftService)) => void;
  onRefreshDisplays: () => void;
  onStageSetup: () => void;
  onSaveTemplate: () => void;
  onStart: () => void;
  onBack?: () => void;
  showBack?: boolean;
}) {
  const isValidationMessage =
    statusMessage.startsWith("Service name") ||
    statusMessage.startsWith("Warning time") ||
    statusMessage.startsWith("Add at least") ||
    statusMessage.startsWith("Every section") ||
    statusMessage.startsWith("No display");
  const displayStatusMessage = isValidationMessage ? statusMessage : stageSetupMessage(displays, draft.selectedDisplayId);
  const warningSeconds = parseDuration(draft.warningInput);
  const canStart =
    Boolean(draft.name.trim()) &&
    warningSeconds !== null &&
    warningSeconds >= 0 &&
    draft.sections.length > 0 &&
    draft.sections.every((section) => section.name.trim() && section.adjustedDurationSeconds > 0);
  const startHelp = !draft.name.trim()
    ? "Enter a service name to start live control."
    : warningSeconds === null || warningSeconds < 0
      ? "Use HH:MM:SS for the warning time."
      : draft.sections.length === 0
        ? "Add at least one section to start live control."
        : !draft.sections.every((section) => section.name.trim() && section.adjustedDurationSeconds > 0)
          ? "Every section needs a name and duration greater than zero."
          : "";

  return (
    <section className="builder-layout">
      <div className="stack">
        {showBack && onBack && <BackButton onClick={onBack} />}
        <h1>Service Setup</h1>
        <div className="form-grid">
          <label>
            Service name
            <input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            Warning time
            <input value={draft.warningInput} onChange={(event) => onDraft({ ...draft, warningInput: event.target.value })} />
          </label>
          <label>
            Starting section
            <select
              value={draft.startingSectionId ?? draft.sections[0]?.id ?? ""}
              onChange={(event) => onDraft({ ...draft, startingSectionId: event.target.value })}
              disabled={draft.sections.length === 0}
            >
              {draft.sections.length === 0 && <option value="">Add a section first</option>}
              {draft.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={draft.autoMoveToNextSection}
              onChange={(event) => onDraft({ ...draft, autoMoveToNextSection: event.target.checked })}
            />
            Auto move to next section
          </label>
        </div>
        <ProgramEditor sections={draft.sections} onSections={(sections) => onDraft({ ...draft, sections })} protectCurrent={false} />
      </div>
      <aside className="side-panel">
        <h2>Stage Display</h2>
        <DisplaySelect
          displays={displays}
          value={draft.selectedDisplayId}
          onChange={(displayId) => onDraft({ ...draft, selectedDisplayId: displayId })}
          className="display-select-spaced"
        />
        <button className="ghost icon-label" onClick={onRefreshDisplays}>
          <Monitor size={18} /> Refresh displays
        </button>
        <button className="primary icon-label" onClick={onStageSetup}>
          <Monitor size={18} /> Open stage setup
        </button>
        <button className="ghost icon-label" onClick={onSaveTemplate}>
          <Save size={18} /> Save as template
        </button>
        <button className="primary large" onClick={onStart} disabled={isStartingLive}>
          {isStartingLive ? "Starting..." : "Start Live Control"}
        </button>
        {(startHelp || displayStatusMessage) && (
          <p className="action-warning">{canStart ? displayStatusMessage : startHelp}</p>
        )}
      </aside>
    </section>
  );
}

function StageSetup({
  draft,
  displays,
  statusMessage,
  onDraft,
  onRefreshDisplays,
  onTest,
  onBack,
}: {
  draft: DraftService;
  displays: DisplayInfo[];
  statusMessage: string;
  onDraft: (draft: DraftService) => void;
  onRefreshDisplays: () => void;
  onTest: () => void;
  onBack: () => void;
}) {
  return (
    <section className="stack narrow">
      <BackButton onClick={onBack} />
      <h1>Stage Display Setup</h1>
      <DisplaySelect
        displays={displays}
        value={draft.selectedDisplayId}
        onChange={(displayId) => onDraft({ ...draft, selectedDisplayId: displayId })}
      />
      <p className="status-line">{statusMessage}</p>
      <div className="button-row">
        <button className="ghost icon-label" onClick={onRefreshDisplays}>
          <Monitor size={18} /> Refresh displays
        </button>
        <button className="primary icon-label" onClick={onTest}>
          <CheckCircle2 size={18} /> Test selected display
        </button>
      </div>
    </section>
  );
}

function LiveControlPanel({
  service,
  displays,
  status,
  timeModal,
  sectionModal,
  onTimeModal,
  onSectionModal,
  onStart,
  onPause,
  onResume,
  onRestart,
  onPreviousSection,
  onNextSection,
  onApplyTime,
  onQuickTimeChange,
  onToggleStage,
  onReopenStage,
  onChooseDisplay,
  onRefreshDisplays,
  onEnd,
  updateActive,
  moveToNextSection,
}: {
  service: ActiveService;
  displays: DisplayInfo[];
  status: { opened: boolean; connected: boolean; message: string };
  timeModal: TimeModalState;
  sectionModal: SectionModalState;
  onTimeModal: (state: TimeModalState) => void;
  onSectionModal: (state: SectionModalState) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onApplyTime: () => void;
  onQuickTimeChange: (seconds: number) => void;
  onToggleStage: () => void;
  onReopenStage: () => void;
  onChooseDisplay: (displayId: string) => void;
  onRefreshDisplays: () => void;
  onEnd: () => void;
  updateActive: (updater: (service: ActiveService) => ActiveService | null) => void;
  moveToNextSection: (service: ActiveService, endedAtPlannedTime: boolean) => ActiveService;
}) {
  const [now, setNow] = useState(Date.now());
  const section = currentSection(service);
  const next = nextSection(service);
  const remaining = section ? remainingForSection(section, now) : 0;
  const elapsed = section ? elapsedForSection(section, now) : 0;
  const progress = section?.adjustedDurationSeconds
    ? Math.min(1, Math.max(0, elapsed / section.adjustedDurationSeconds))
    : 0;
  const tone = section ? timerTone(remaining, service.warningThresholdSeconds) : "normal";
  const currentIndex = service.sections.findIndex((item) => item.id === service.currentSectionId);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!service.autoMoveToNextSection || service.status !== "running" || !section || remaining >= 0) return;
    updateActive((current) => moveToNextSection(current, true));
  }, [moveToNextSection, remaining, section, service.autoMoveToNextSection, service.status, updateActive]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key === " ") {
        event.preventDefault();
        service.status === "running" ? onPause() : onResume();
      }
      if (event.key === "ArrowRight") onNextSection();
      if (event.key === "ArrowLeft") onPreviousSection();
      if (event.key.toLowerCase() === "r") onRestart();
      if (event.key === "+" || event.key === "=") onQuickTimeChange(60);
      if (event.key === "-" || event.key === "_") onQuickTimeChange(-60);
      if (event.key.toLowerCase() === "h") onToggleStage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNextSection, onPause, onPreviousSection, onQuickTimeChange, onRestart, onResume, onToggleStage, service.status]);

  const saveSectionModal = () => {
    const seconds = parseDuration(sectionModal.duration);
    if (!sectionModal.name.trim() || seconds === null || seconds <= 0) {
      onSectionModal({ ...sectionModal, error: "Name and HH:MM:SS duration are required." });
      return;
    }
    updateActive((current) => ({
      ...current,
      sections:
        sectionModal.mode === "add"
          ? [...current.sections, createSection(sectionModal.name.trim(), seconds)]
          : current.sections.map((item) =>
              item.id === sectionModal.targetId
                ? {
                    ...item,
                    name: sectionModal.name.trim(),
                    originalDurationSeconds: seconds,
                    adjustedDurationSeconds: seconds,
                  }
                : item,
            ),
    }));
    onSectionModal({ mode: null, targetId: null, name: "", duration: "00:05:00", error: "" });
  };

  return (
    <section className="live-grid">
      <div className="program-column live-scroll-col">
        <div className="upcoming-panel program-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live program</p>
              <h2>Program sections</h2>
            </div>
            <button
              className="ghost icon-label"
              onClick={() => onSectionModal({ mode: "add", targetId: null, name: "", duration: "00:05:00", error: "" })}
            >
              <Plus size={18} /> Add
            </button>
          </div>
          <ProgramSectionsList
            service={service}
            onEdit={(item) =>
              onSectionModal({
                mode: "edit",
                targetId: item.id,
                name: item.name,
                duration: secondsToInput(item.adjustedDurationSeconds),
                error: "",
              })
            }
            updateActive={updateActive}
          />
        </div>
      </div>
      <aside className="live-side live-sticky-col">
        <MiniPreview service={service} now={now} />
        <div className="control-board">
          <div className="control-board-heading">
            <div>
              <p className="eyebrow">Current section</p>
              <h2>{section?.name ?? "No section selected"}</h2>
            </div>
            <span className={`status-pill ${tone}`}>
              {service.status === "running" ? "Running" : service.status === "setup" ? "Ready" : "Paused"}
            </span>
          </div>
          <div className={`control-timer-card ${tone}`}>
            <div className="progress-ring" style={{ "--progress": progress } as CSSProperties}>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className="progress-ring-track" cx="60" cy="60" r="52" />
                <circle className="progress-ring-value" cx="60" cy="60" r="52" />
              </svg>
            </div>
            <div>
              <div className={`control-timer ${tone}`}>{formatTimer(remaining)}</div>
              <div className="session-progress">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="next-preview">{next ? `Next session: ${next.name}` : "Last scheduled section"}</p>
            </div>
          </div>
          <div className="live-controls-wrap">
            <div className="live-transport-row">
              <button className="ghost ctrl-icon" onClick={() => onQuickTimeChange(-60)} aria-label="Subtract 1 minute">
                <span className="ctrl-badge">−1</span>
              </button>
              <button className="ghost ctrl-icon" onClick={onPreviousSection} disabled={currentIndex <= 0} aria-label="Previous section">
                <StepBack size={20} />
              </button>
              {service.status === "running" ? (
                <button className="ghost ctrl-icon ctrl-play" onClick={onPause} aria-label="Pause">
                  <Pause size={22} />
                </button>
              ) : section?.status === "pending" || service.status === "setup" ? (
                <button className="primary ctrl-icon ctrl-play" onClick={onStart} aria-label="Start">
                  <Play size={22} />
                </button>
              ) : (
                <button className="primary ctrl-icon ctrl-play" onClick={onResume} aria-label="Resume">
                  <Play size={22} />
                </button>
              )}
              <button className="ghost ctrl-icon" onClick={onNextSection} aria-label="Next section">
                <StepForward size={20} />
              </button>
              <button className="ghost ctrl-icon" onClick={() => onQuickTimeChange(60)} aria-label="Add 1 minute">
                <span className="ctrl-badge">+1</span>
              </button>
            </div>
            <div className="live-action-row">
              <button className="ghost icon-label live-action-btn" onClick={onRestart}>
                <RotateCcw size={16} /> Reset
              </button>
              <button className="ghost icon-label live-action-btn" onClick={onToggleStage}>
                {service.stageDisplayHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                {service.stageDisplayHidden ? "Show display" : "Hide display"}
              </button>
            </div>
          </div>
        </div>
        <div className="side-panel inline">
          <h2>Stage Status</h2>
          <p className="status-line">{status.message}</p>
          <DisplaySelect displays={displays} value={service.selectedDisplayId} onChange={onChooseDisplay} />
          <button className="ghost icon-label" onClick={onRefreshDisplays}>
            <Monitor size={18} /> Refresh displays
          </button>
          <button className="primary icon-label" onClick={onReopenStage}>
            <Monitor size={18} /> Reopen stage display
          </button>
        </div>
        <button className="danger large" onClick={onEnd}>
          End service
        </button>
      </aside>
      {timeModal.mode && (
        <Modal title="Adjust time" onClose={() => onTimeModal({ ...timeModal, mode: null })}>
          <label>
            Select action
            <select value={timeModal.mode} onChange={(event) => onTimeModal({ ...timeModal, mode: event.target.value as "add" | "reduce", error: "" })}>
              <option value="add">Increase time</option>
              <option value="reduce">Decrease time</option>
            </select>
          </label>
          <label>
            Duration
            <input
              value={timeModal.value}
              placeholder="00:01:00"
              onChange={(event) => onTimeModal({ ...timeModal, value: event.target.value, error: "" })}
            />
          </label>
          <p className="muted">This affects the current section only.</p>
          {timeModal.error && <p className="error-text">{timeModal.error}</p>}
          <div className="button-row end">
            <button className="ghost large" onClick={() => onTimeModal({ ...timeModal, mode: null })}>
              Cancel
            </button>
            <button className="primary large" onClick={onApplyTime}>
              Apply adjustment
            </button>
          </div>
        </Modal>
      )}
      {sectionModal.mode && (
        <Modal title={sectionModal.mode === "add" ? "Add Upcoming Section" : "Edit Upcoming Section"} onClose={() => onSectionModal({ ...sectionModal, mode: null })}>
          <label>
            Section name
            <input value={sectionModal.name} onChange={(event) => onSectionModal({ ...sectionModal, name: event.target.value, error: "" })} />
          </label>
          <label>
            Duration
            <DurationInput
              valueSeconds={parseDuration(sectionModal.duration) ?? 300}
              ariaLabel="Section duration"
              onChange={(seconds) => onSectionModal({ ...sectionModal, duration: secondsToInput(seconds), error: "" })}
            />
          </label>
          {sectionModal.error && <p className="error-text">{sectionModal.error}</p>}
          <button className="primary large" onClick={saveSectionModal}>
            Save
          </button>
        </Modal>
      )}
    </section>
  );
}

function ProgramSectionsList({
  service,
  onEdit,
  updateActive,
}: {
  service: ActiveService;
  onEdit: (section: Section) => void;
  updateActive: (updater: (service: ActiveService) => ActiveService | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const currentIndex = service.sections.findIndex((section) => section.id === service.currentSectionId);
  const activeSection = currentSection(service);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = service.sections.filter((section) => {
    if (section.id === service.currentSectionId) return false;
    if (!normalizedQuery) return true;
    return section.name.toLowerCase().includes(normalizedQuery);
  });

  useEffect(() => {
    if (!autoScroll || !activeSection) return;
    const nextVisible = service.sections
      .slice(currentIndex + 1)
      .find((section) => section.status === "pending" && (!normalizedQuery || section.name.toLowerCase().includes(normalizedQuery)));
    const target = nextVisible ? rowRefs.current.get(nextVisible.id) : null;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeSection, autoScroll, currentIndex, normalizedQuery, service.sections]);

  const move = (sectionId: string, direction: -1 | 1) => {
    updateActive((current) => {
      const index = current.sections.findIndex((section) => section.id === sectionId);
      const target = index + direction;
      if (index <= currentIndex || target <= currentIndex || target < 0 || target >= current.sections.length) return current;
      const nextSections = [...current.sections];
      [nextSections[index], nextSections[target]] = [nextSections[target], nextSections[index]];
      return { ...current, sections: nextSections };
    });
  };
  const remove = (sectionId: string) => {
    updateActive((current) => {
      const section = current.sections.find((item) => item.id === sectionId);
      if (!section || section.status === "completed" || section.status === "skipped" || section.id === current.currentSectionId) return current;
      return { ...current, sections: current.sections.filter((item) => item.id !== sectionId) };
    });
  };
  const duplicate = (section: Section) => {
    updateActive((current) => ({
      ...current,
      sections: [...current.sections, createSection(section.name, section.adjustedDurationSeconds)],
    }));
  };
  const renderRow = (section: Section, index: number, sticky = false) => {
    const isActive = section.id === service.currentSectionId;
    const isCompleted = section.status === "completed" || section.status === "skipped";
    const isUpcoming = index > currentIndex && section.status === "pending";
    const stateLabel = isActive ? "Active" : isCompleted ? "Completed" : "Upcoming";
    return (
      <div
        className={`row program-row ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""} ${sticky ? "sticky-current" : ""}`}
        key={section.id}
        ref={(node) => {
          if (!node) rowRefs.current.delete(section.id);
          else rowRefs.current.set(section.id, node);
        }}
      >
        <div className="program-row-num">{index + 1}</div>
        <div className="program-row-body">
          <div className="program-title-line">
            <strong>{section.name}</strong>
            <span className="section-state">{stateLabel}</span>
          </div>
          <p>{formatDuration(section.adjustedDurationSeconds)}</p>
        </div>
        <div className="row-actions">
          {isUpcoming && (
            <>
              <button className="icon-button" onClick={() => move(section.id, -1)} aria-label="Move up">
                <ArrowUp size={16} />
              </button>
              <button className="icon-button" onClick={() => move(section.id, 1)} aria-label="Move down">
                <ArrowDown size={16} />
              </button>
              <button className="ghost small" onClick={() => onEdit(section)}>
                Edit
              </button>
            </>
          )}
          <button className="icon-button" onClick={() => duplicate(section)} aria-label="Duplicate section">
            <Copy size={16} />
          </button>
          {isUpcoming && (
            <button className="icon-button danger-text" onClick={() => remove(section.id)} aria-label="Delete section">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="program-list-wrap">
      <div className="program-tools">
        <input
          className="program-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sections"
          aria-label="Search sections"
        />
        <label className="auto-scroll-toggle">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          Auto-scroll
        </label>
      </div>
      {activeSection ? <div className="program-current">{renderRow(activeSection, currentIndex, true)}</div> : null}
      <div className="list compact program-list" aria-label="Program sections">
        {visibleSections.map((section) => renderRow(section, service.sections.findIndex((item) => item.id === section.id)))}
        {visibleSections.length === 0 && <p className="empty-inline">No matching sections.</p>}
      </div>
    </div>
  );
}

function MiniPreview({ service, now }: { service: ActiveService; now: number }) {
  const payload = stagePayloadFromService(service, now);
  return (
    <div className="mini-preview">
      <p className="mini-preview-label">Stage preview</p>
      <div className="mini-stage">
        <div className="mini-stage-inner">
          {payload.mode === "hidden" ? (
            <span className="mini-stage-hidden">Stage output hidden</span>
          ) : payload.mode === "test" ? (
            <span className="mini-stage-test">Timer display connected</span>
          ) : (
            <>
              <div className="mini-stage-name">{payload.sectionName}</div>
              <div className={`mini-stage-timer ${payload.tone}`}>{payload.timerText}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplatesScreen({
  templates,
  onNew,
  onEdit,
  onUse,
  onDelete,
  onBack,
}: {
  templates: Template[];
  onNew: () => void;
  onEdit: (template: Template) => void;
  onUse: (template: Template) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      <div className="section-heading">
        <h1>Templates</h1>
        <button className="primary icon-label" onClick={onNew}>
          <Plus size={18} /> Create template
        </button>
      </div>
      {templates.length === 0 ? <EmptyState text="No templates saved yet." /> : null}
      <div className="list">
        {templates.map((template) => (
          <div className="row" key={template.id}>
            <div>
              <strong>{template.name}</strong>
              <p>{template.sections.length} sections</p>
            </div>
            <div className="row-actions">
              <button className="primary small" onClick={() => onUse(template)}>
                Use
              </button>
              <button className="ghost small" onClick={() => onEdit(template)}>
                Edit
              </button>
              <button className="icon-button danger-text" onClick={() => onDelete(template.id)} aria-label="Delete template">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TemplateEditor({ template, onSave, onBack }: { template: Template; onSave: (template: Template) => void; onBack: () => void }) {
  const [name, setName] = useState(template.name);
  const [sections, setSections] = useState<Section[]>(
    template.sections.map((section) => createSection(section.name, section.adjustedDurationSeconds)),
  );
  const [error, setError] = useState("");
  const save = () => {
    if (!name.trim()) return setError("Template name is required.");
    if (sections.length === 0) return setError("Add at least one section.");
    onSave({
      ...template,
      name: name.trim(),
      sections: cloneSectionsForTemplate(sections),
      updatedAt: new Date().toISOString(),
    });
  };
  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      <h1>Template Editor</h1>
      <label>
        Template name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <ProgramEditor sections={sections} onSections={setSections} protectCurrent={false} />
      {error && <p className="error-text">{error}</p>}
      <button className="primary large" onClick={save}>
        Save Template
      </button>
    </section>
  );
}

function ReportsScreen({ reports, onOpen, onBack }: { reports: ServiceReport[]; onOpen: (report: ServiceReport) => void; onBack: () => void }) {
  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      <h1>Report History</h1>
      {reports.length === 0 ? <EmptyState text="No reports saved yet." /> : null}
      <div className="list">
        {reports.map((report) => (
          <button className="row row-button" key={report.id} onClick={() => onOpen(report)}>
            <div>
              <strong>{report.serviceName}</strong>
              <p>{report.serviceDate}</p>
            </div>
            <div className="report-total">{formatDuration(report.totalActualSeconds)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReportDetail({ report, onBack }: { report: ServiceReport; onBack: () => void }) {
  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      <h1>{report.serviceName}</h1>
      <p className="muted">{report.serviceDate}</p>
      <div className="summary-grid">
        <Stat label="Planned" value={formatDuration(report.totalPlannedSeconds)} />
        <Stat label="Actual" value={formatDuration(report.totalActualSeconds)} />
        <Stat label="Difference" value={formatTimer(report.totalPlannedSeconds - report.totalActualSeconds)} />
      </div>
      <div className="insights">
        {report.insights.map((insight) => (
          <p key={insight}>{insight}</p>
        ))}
      </div>
      <div className="report-table">
        <div className="report-row head">
          <span>Section</span>
          <span>Planned</span>
          <span>Added</span>
          <span>Reduced</span>
          <span>Actual</span>
          <span>Variance</span>
        </div>
        {report.sections.map((section) => (
          <div className="report-row" key={section.id}>
            <span>{section.name}</span>
            <span>{formatDuration(section.finalAdjustedPlannedSeconds)}</span>
            <span>{formatDuration(section.addedSeconds)}</span>
            <span>{formatDuration(section.reducedSeconds)}</span>
            <span>{formatDuration(section.actualSeconds)}</span>
            <span className={section.varianceSeconds > 0 ? "danger-text" : "success-text"}>
              {section.varianceSeconds > 0 ? "+" : ""}
              {formatDuration(Math.abs(section.varianceSeconds))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsScreen({
  settings,
  onSettings,
  onCheckUpdates,
  updateStatus,
  onBack,
}: {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onCheckUpdates: () => void;
  updateStatus: { checking: boolean; checked: boolean; message: string };
  onBack: () => void;
}) {
  return (
    <section className="stack narrow">
      <BackButton onClick={onBack} />
      <h1>Settings</h1>
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={settings.theme === "light"}
          onChange={(event) => onSettings({ ...settings, theme: event.target.checked ? "light" : "dark" })}
        />
        Light mode
      </label>
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={settings.soundAlerts}
          onChange={(event) => onSettings({ ...settings, soundAlerts: event.target.checked })}
        />
        Default sound alert
      </label>
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={settings.autoMoveToNextSection}
          onChange={(event) => onSettings({ ...settings, autoMoveToNextSection: event.target.checked })}
        />
        Auto move to next section
      </label>
      <label>
        Default warning time
        <input
          value={secondsToInput(settings.defaultWarningTimeSeconds)}
          onChange={(event) => {
            const seconds = parseDuration(event.target.value);
            if (seconds !== null) onSettings({ ...settings, defaultWarningTimeSeconds: seconds });
          }}
        />
      </label>
      <button className="primary icon-label" onClick={onCheckUpdates}>
        <CheckCircle2 size={18} /> {updateStatus.checking ? "Checking..." : "Check for updates"}
      </button>
      {updateStatus.checked && <p className="muted">{updateStatus.message}</p>}
    </section>
  );
}

function ProgramEditor({
  sections,
  onSections,
}: {
  sections: Section[];
  onSections: (sections: Section[]) => void;
  protectCurrent: boolean;
}) {
  const update = (index: number, next: Partial<Section>) => {
    onSections(sections.map((section, sectionIndex) => (sectionIndex === index ? { ...section, ...next } : section)));
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    onSections(next);
  };
  return (
    <div className="program-editor">
      <div className="section-heading">
        <h2>Program Sections</h2>
        <button className="ghost icon-label" onClick={() => onSections([...sections, createSection()])}>
          <Plus size={18} /> Add section
        </button>
      </div>
      <div className="list compact">
        {sections.length === 0 && <EmptyState text="No program sections yet. Add the first section when you are ready." />}
        {sections.map((section, index) => (
          <div className="editor-row" key={section.id}>
            <input value={section.name} onChange={(event) => update(index, { name: event.target.value })} />
            <DurationInput
              valueSeconds={section.adjustedDurationSeconds}
              ariaLabel={`${section.name || "Section"} duration`}
              onChange={(seconds) => update(index, { originalDurationSeconds: seconds, adjustedDurationSeconds: seconds })}
            />
            <button className="icon-button" onClick={() => move(index, -1)} aria-label="Move up">
              <ArrowUp size={16} />
            </button>
            <button className="icon-button" onClick={() => move(index, 1)} aria-label="Move down">
              <ArrowDown size={16} />
            </button>
            <button className="icon-button" onClick={() => onSections([...sections, { ...section, id: createId("section") }])} aria-label="Duplicate">
              <Copy size={16} />
            </button>
            <button className="icon-button danger-text" onClick={() => onSections(sections.filter((item) => item.id !== section.id))} aria-label="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DisplaySelect({
  displays,
  value,
  onChange,
  className,
}: {
  displays: DisplayInfo[];
  value: string | null;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={className}>
      Stage display screen
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose display</option>
        {displays.map((display) => (
          <option key={display.id} value={display.id}>
            {display.name} {display.isPrimary ? "(Primary)" : ""} - {display.width}x{display.height}
          </option>
        ))}
      </select>
    </label>
  );
}

function StagePublisher({ service }: { service: ActiveService | null }) {
  const lastPayload = useRef("");
  useEffect(() => {
    const publish = () => {
      const payload = stagePayloadFromService(service);
      const serialized = JSON.stringify(payload);
      if (serialized !== lastPayload.current) {
        lastPayload.current = serialized;
        publishStagePayload(payload);
      }
    };
    publish();
    const interval = window.setInterval(publish, 1000);
    return () => window.clearInterval(interval);
  }, [service]);
  return null;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-button modal-close" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="stack small-stack">{children}</div>
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="ghost icon-label back-button" onClick={onClick}>
      <ArrowLeft size={18} /> Back
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
