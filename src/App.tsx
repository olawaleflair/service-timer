import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Hand,
  History,
  Home,
  Monitor,
  MoreHorizontal,
  Music2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  StepForward,
  Trash2,
  TriangleAlert,
  UserRound,
  MessageCircle,
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
  closeStageDisplay,
  closeApplication,
  focusMainWindow,
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
import { reorderUpcomingSections } from "./utils/queue";
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
  serviceDate: string;
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
    name: "Sunday Service",
    serviceDate: localDateString(),
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

function resolveStageDisplayId(displays: DisplayInfo[], selectedDisplayId: string | null): string | null {
  const selected = selectedDisplayId ? displays.find((display) => display.id === selectedDisplayId) : null;
  return selected?.connected ? selected.id : primaryDisplay(displays)?.id ?? null;
}

function stageSetupMessage(displays: DisplayInfo[], selectedDisplayId: string | null): string {
  if (displays.length <= 1) {
    return "Only one display detected. Stage display will open in a separate window on this screen.";
  }
  const selected = selectedDisplayId ? displays.find((display) => display.id === selectedDisplayId) : null;
  if (selected?.connected) return `Stage display will open on ${selected.name}.`;
  return "Choose a display, or start live control to open the stage display on the primary screen.";
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

  const discardActiveServiceAndStartOver = () => {
    const service = stateRef.current.activeService;
    if (!isUnfinishedActiveService(service)) {
      openFreshStartSetup();
      return;
    }

    setConfirmModal({
      title: "Discard active service?",
      message: "This will end the current service and start a new blank programme. Any live timing will be saved only if activity has begun.",
      confirmLabel: "End service and start new",
      cancelLabel: "Keep service",
      tone: "danger",
      onConfirm: () => {
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

  const beginTemplateSelection = () => {
    setSelectedSetupMethod("template");
    if (!selectedTemplateId && state.templates[0]) beginFromTemplate(state.templates[0]);
  };

  const beginFromTemplate = (template: Template) => {
    const sections = sectionsFromTemplate(template);
    setDraft({
      ...emptyDraft(state.settings),
      name: template.name,
      sections,
      startingSectionId: sections[0]?.id ?? null,
    });
    setSelectedSetupMethod("template");
    setSelectedTemplateId(template.id);
    setPasteSetupLoaded(false);
  };

  const selectTemplate = (templateId: string) => {
    const template = state.templates.find((item) => item.id === templateId);
    if (template) {
      beginFromTemplate(template);
      return;
    }
    setSelectedTemplateId(null);
    setSelectedSetupMethod("template");
    setDraft((current) => ({ ...current, name: "Sunday Service", sections: [], startingSectionId: null }));
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
          ? "Stage display opened in a separate window on this screen."
          : "Stage display ready.",
      },
    }));
  };

  const createActiveService = async () => {
    const warningSeconds = parseDuration(draft.warningInput);
    if (!draft.name.trim()) return showStageMessage("Service name is required.");
    if (warningSeconds === null || warningSeconds < 0) return showStageMessage("Warning time must use HH:MM:SS.");
    if (draft.sections.length === 0) return showStageMessage("Add at least one section.");
    if (draft.sections.some((section) => !section.name.trim() || section.adjustedDurationSeconds <= 0)) {
      return showStageMessage("Every section needs a name and duration greater than zero.");
    }

    const currentDisplays = displays.length > 0 ? displays : await listDisplays();
    const targetDisplayId = resolveStageDisplayId(currentDisplays, draft.selectedDisplayId);
    if (!targetDisplayId) return showStageMessage("No display was detected.");
    let stageOpened = false;
    let stageMessage =
      currentDisplays.length <= 1
        ? "Stage display opened in a separate window on this screen."
        : "Stage display ready.";
    try {
      await openStageDisplay(targetDisplayId, false);
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
      date: draft.serviceDate || localDateString(),
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
    try {
      await focusMainWindow();
    } catch (error) {
      console.warn("Could not bring live control to the front after opening stage display.", error);
    }
  };

  const showStageMessage = (message: string) => {
    setState((current) => ({ ...current, stageDisplayStatus: { ...current.stageDisplayStatus, message } }));
  };

  const closeStageDisplaySafely = async () => {
    try {
      await closeStageDisplay();
    } catch (error) {
      console.error("Stage display close failed.", error);
    }
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
    if (!closeApp) await closeStageDisplaySafely();
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
      await closeStageDisplaySafely();
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
    <div className="app-shell">
      {!(["home", "start", "builder", "stageSetup", "live", "templates", "templateEditor", "reports", "reportDetail", "settings"] as Screen[]).includes(state.screen) && (
        <Header screen={state.screen} onHome={() => navigate("home")} />
      )}
      <main className={`main-view screen-${state.screen}`}>
        {state.screen === "home" && (
          <HomeScreen
            state={state}
            onStart={startNewService}
            onDiscardActive={discardActiveServiceAndStartOver}
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
            onResume={() => navigate("live")}
          />
        )}
        {state.screen === "start" && (
          <StartScreen
            selectedMethod={selectedSetupMethod}
            templates={state.templates}
            selectedTemplateId={selectedTemplateId}
            draft={draft}
            onBlank={beginBlank}
            onTemplate={beginTemplateSelection}
            onUseTemplate={selectTemplate}
            onDraft={setDraft}
            onContinue={() => navigate("builder")}
            onSettings={() => navigate("settings")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onBack={() => navigate("home")}
          />
        )}
        {state.screen === "builder" && (
          <PrepareScreen
            draft={draft}
            displays={displays}
            statusMessage={state.stageDisplayStatus.message}
            onDraft={setDraft}
            onRefreshDisplays={refreshDisplays}
            onStageSetup={() => navigate("stageSetup")}
            onTestStage={() => void openOrTestStage(true)}
            onSaveTemplate={saveDraftAsTemplate}
            onStart={createActiveService}
            onSettings={() => navigate("settings")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onBack={() => navigate("home")}
          />
        )}
        {state.screen === "stageSetup" && (
          <NavigationShell
            active={null}
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
            <StageSetup
              draft={draft}
              displays={displays}
              statusMessage={state.stageDisplayStatus.message}
              onDraft={setDraft}
              onRefreshDisplays={refreshDisplays}
              onTest={() => openOrTestStage(true)}
              onBack={() => navigate("builder")}
            />
          </NavigationShell>
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
            onSettings={() => navigate("settings")}
            updateActive={updateActive}
            moveToNextSection={moveToNextSection}
          />
        )}
        {state.screen === "templates" && (
          <NavigationShell
            active="templates"
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
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
            />
          </NavigationShell>
        )}
        {state.screen === "templateEditor" && editingTemplate && (
          <NavigationShell
            active="templates"
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
            <TemplateEditor template={editingTemplate} onSave={saveTemplate} onBack={() => navigate("templates")} />
          </NavigationShell>
        )}
        {state.screen === "reports" && (
          <NavigationShell
            active="reports"
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
            <ReportsScreen
              reports={state.reports}
              onOpen={(report) => {
                setSelectedReport(report);
                navigate("reportDetail");
              }}
            />
          </NavigationShell>
        )}
        {state.screen === "reportDetail" && selectedReport && (
          <NavigationShell
            active="reports"
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
            <ReportDetail report={selectedReport} onBack={() => navigate("reports")} />
          </NavigationShell>
        )}
        {state.screen === "settings" && (
          <NavigationShell
            active="settings"
            onHome={() => navigate("home")}
            onTemplates={() => navigate("templates")}
            onReports={() => navigate("reports")}
            onSettings={() => navigate("settings")}
          >
            <SettingsScreen
              settings={state.settings}
              onSettings={(settings) => setState((current) => ({ ...current, settings }))}
              onCheckUpdates={checkUpdates}
              updateStatus={state.updateStatus}
            />
          </NavigationShell>
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
    <header className={`app-header app-header-${screen}`}>
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

function WorkspaceRail({
  active,
  onHome,
  onSettings,
  onTemplates,
  onReports,
}: {
  active: "home" | "templates" | "reports" | "settings" | null;
  onHome: () => void;
  onSettings: () => void;
  onTemplates: () => void;
  onReports: () => void;
}) {
  return (
    <aside className="workspace-rail home-rail" aria-label="Service workspace navigation">
      <button className="rail-brand" onClick={onHome} aria-label="Go to Home">
        <span className="rail-mark">CT</span>
        <span className="rail-wordmark home-rail-wordmark">Church Timer Pro</span>
      </button>
      <div className="rail-nav">
        <button className={`rail-item rail-button ${active === "home" ? "active" : ""}`} onClick={onHome}>
          <Home size={18} />
          <span>Home</span>
        </button>
        <button className={`rail-item rail-button ${active === "templates" ? "active" : ""}`} onClick={onTemplates}>
          <FileText size={18} />
          <span>Templates</span>
        </button>
        <button className={`rail-item rail-button ${active === "reports" ? "active" : ""}`} onClick={onReports}>
          <History size={18} />
          <span>Reports</span>
        </button>
        <button className={`rail-item rail-button ${active === "settings" ? "active" : ""}`} onClick={onSettings}>
          <SettingsIcon size={18} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function NavigationShell({
  active,
  onHome,
  onTemplates,
  onReports,
  onSettings,
  children,
}: {
  active: "home" | "templates" | "reports" | "settings" | null;
  onHome: () => void;
  onTemplates: () => void;
  onReports: () => void;
  onSettings: () => void;
  children: ReactNode;
}) {
  return (
    <section className="workspace-screen navigation-screen">
      <WorkspaceRail
        active={active}
        onHome={onHome}
        onTemplates={onTemplates}
        onReports={onReports}
        onSettings={onSettings}
      />
      <div className="workspace-content navigation-content">{children}</div>
    </section>
  );
}

type HomeServiceRow = {
  id: string;
  name: string;
  date: string;
  totalSeconds: number;
  sectionCount: number;
  status: "in-progress" | "draft" | "completed";
  sortValue: number;
};

function formatHomeDate(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function homeGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function buildHomeServiceRows(state: AppState): HomeServiceRow[] {
  const rows: HomeServiceRow[] = [];

  if (state.activeService) {
    rows.push({
      id: `active-${state.activeService.id}`,
      name: state.activeService.name,
      date: state.activeService.date,
      totalSeconds: state.activeService.sections.reduce((total, section) => total + section.adjustedDurationSeconds, 0),
      sectionCount: state.activeService.sections.length,
      status: "in-progress",
      sortValue: new Date(state.activeService.updatedAt).getTime(),
    });
  }

  rows.push(
    ...state.reports.map((report) => ({
      id: `report-${report.id}`,
      name: report.serviceName,
      date: report.serviceDate,
      totalSeconds: report.totalPlannedSeconds,
      sectionCount: report.sections.length,
      status: "completed" as const,
      sortValue: new Date(report.createdAt).getTime(),
    })),
    ...state.templates.map((template) => ({
      id: `template-${template.id}`,
      name: template.name,
      date: template.updatedAt,
      totalSeconds: template.sections.reduce((total, section) => total + section.adjustedDurationSeconds, 0),
      sectionCount: template.sections.length,
      status: "draft" as const,
      sortValue: new Date(template.updatedAt).getTime(),
    })),
  );

  return rows.filter((row) => row.name.trim()).sort((a, b) => b.sortValue - a.sortValue);
}

function HomeScreen({
  state,
  onStart,
  onDiscardActive,
  onHome,
  onTemplates,
  onReports,
  onSettings,
  onResume,
}: {
  state: AppState;
  onStart: () => void;
  onDiscardActive: () => void;
  onHome: () => void;
  onTemplates: () => void;
  onReports: () => void;
  onSettings: () => void;
  onResume: () => void;
}) {
  const allRows = buildHomeServiceRows(state);
  const rows = allRows.slice(0, 3);
  const activeSection = currentSection(state.activeService);
  const activeRemaining = activeSection ? remainingForSection(activeSection) : 0;
  const activeTotal = state.activeService?.sections.reduce((total, section) => total + section.adjustedDurationSeconds, 0) ?? 0;

  return (
    <section className="workspace-screen home-screen">
      <WorkspaceRail
        active="home"
        onHome={onHome}
        onSettings={onSettings}
        onTemplates={onTemplates}
        onReports={onReports}
      />
      <div className="home-content">
        <div className="home-main-column">
          <div className="home-heading">
            <p className="home-greeting">{homeGreeting()}</p>
            <h1>Your services</h1>
          </div>
          <div className="home-primary-actions">
            <button className="home-create-button" onClick={onStart}>
              <Plus size={25} /> Create a service
            </button>
            <button className="home-template-button" onClick={onTemplates}>
              <FileText size={25} /> Open template
            </button>
          </div>

          <section className="home-recent-section" aria-labelledby="recent-services-heading">
            <div className="home-section-rule" />
            <div className="home-section-heading">
              <h2 id="recent-services-heading">Recent services</h2>
            </div>
            {rows.length > 0 ? (
              <>
                <div className="home-service-table" role="table" aria-label="Recent services">
                  <div className="home-service-table-head" role="row">
                    <span role="columnheader">Service</span>
                    <span role="columnheader">Total time</span>
                    <span role="columnheader">Sections</span>
                    <span role="columnheader">Status</span>
                    <span aria-hidden="true" />
                  </div>
                  {rows.map((row) => (
                    <div className="home-service-row" role="row" key={row.id}>
                      <div className="home-service-name" role="cell">
                        <span className={`home-service-icon home-service-icon--${row.status}`} aria-hidden="true">
                          {row.status === "completed" ? <CheckCircle2 size={20} /> : row.status === "draft" ? <FileText size={20} /> : <CalendarDays size={20} />}
                        </span>
                        <span>
                          <strong>{row.name}</strong>
                          <small>{formatHomeDate(row.date)}</small>
                        </span>
                      </div>
                      <span role="cell">{formatDuration(row.totalSeconds)}</span>
                      <span role="cell">{row.sectionCount}</span>
                      <span className={`home-service-status home-service-status--${row.status}`} role="cell">
                        <span className="home-status-dot" aria-hidden="true" /> {row.status === "in-progress" ? "In progress" : row.status === "draft" ? "Draft" : "Completed"}
                      </span>
                      <span className="home-row-more" aria-hidden="true"><MoreHorizontal size={22} /></span>
                    </div>
                  ))}
                </div>
                <button className="home-view-all" onClick={onReports}>
                  View all services ({allRows.length}) <ChevronRight size={20} />
                </button>
              </>
            ) : (
              <div className="home-empty-services">
                <CalendarDays size={25} />
                <p>No recent services yet. Create a service or open a template to begin.</p>
              </div>
            )}
          </section>

          <section className="home-how-it-works" aria-labelledby="how-it-works-heading">
            <h2 id="how-it-works-heading">How it works</h2>
            <div className="home-steps">
              <div className="home-step">
                <span className="home-step-number">1</span>
                <FileText size={31} strokeWidth={1.5} />
                <div><strong>Create</strong><p>Start a new service<br />or use a template.</p></div>
              </div>
              <div className="home-step">
                <span className="home-step-number">2</span>
                <ClipboardList size={31} strokeWidth={1.5} />
                <div><strong>Prepare</strong><p>Add sections, set times,<br />and organize the order.</p></div>
              </div>
              <div className="home-step">
                <span className="home-step-number">3</span>
                <Play size={31} strokeWidth={1.5} />
                <div><strong>Run</strong><p>Go live and follow<br />your service.</p></div>
              </div>
            </div>
          </section>
        </div>

        <aside className="home-resume-panel" aria-labelledby="resume-service-heading">
          <h2 id="resume-service-heading">Resume live service</h2>
          <div className="home-panel-rule" />
          {state.activeService ? (
            <div className="home-active-service">
              <p className="home-panel-label">In progress</p>
              <h3>{state.activeService.name}</h3>
              <p className="home-panel-date">{formatHomeDate(state.activeService.date)}</p>
              <div className="home-panel-rule" />
              <p className="home-panel-label">Current section</p>
              <div className="home-current-section"><Music2 size={21} /><strong>{activeSection?.name ?? "Ready to start"}</strong></div>
              <div className="home-panel-rule" />
              <p className="home-panel-label">Time remaining</p>
              <strong className="home-remaining-time">{formatTimer(activeRemaining)}</strong>
              <span className="home-total-time">of {formatDuration(activeTotal)}</span>
              <button className="home-resume-button" onClick={onResume}><Play size={21} fill="currentColor" /> Resume Live Console</button>
              <div className="home-or-divider"><span>OR</span></div>
              <button className="home-discard-button" onClick={onDiscardActive}><Trash2 size={19} /> Discard and start over</button>
            </div>
          ) : (
            <div className="home-empty-resume">
              <span className="home-empty-resume-icon"><CalendarDays size={22} /></span>
              <div>
                <strong>No live service to resume</strong>
                <p>Start a service and open the Live Console to see it here.</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function formatDraftDate(value: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

function formatPrepareDate(value: string): string {
  return formatDraftDate(value, { weekday: "long", day: "numeric", month: "long" });
}

function formatPreviewDuration(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPreviewTotal(totalSeconds: number): { primary: string; secondary: string } {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return {
    primary: `${minutes}:${String(Math.max(0, totalSeconds) % 60).padStart(2, "0")}`,
    secondary: hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m`,
  };
}

function formatWarningThreshold(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function StartScreen({
  selectedMethod,
  templates,
  selectedTemplateId,
  draft,
  onBlank,
  onTemplate,
  onUseTemplate,
  onDraft,
  onContinue,
  onSettings,
  onTemplates,
  onReports,
  onBack,
}: {
  selectedMethod: SetupMethod | null;
  templates: Template[];
  selectedTemplateId: string | null;
  draft: DraftService;
  onBlank: () => void;
  onTemplate: () => void;
  onUseTemplate: (templateId: string) => void;
  onDraft: (draft: DraftService | ((draft: DraftService) => DraftService)) => void;
  onContinue: () => void;
  onSettings: () => void;
  onTemplates: () => void;
  onReports: () => void;
  onBack: () => void;
}) {
  const selectedTemplate = selectedTemplateId ? templates.find((template) => template.id === selectedTemplateId) ?? null : null;
  const canContinue = selectedMethod === "blank" || Boolean(selectedMethod === "template" && selectedTemplate);
  const activateCard = (handler: () => void) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };

  return (
    <section className="workspace-screen create-service-screen">
      <WorkspaceRail
        active={null}
        onHome={onBack}
        onSettings={onSettings}
        onTemplates={onTemplates}
        onReports={onReports}
      />
      <div className="create-service-content">
        <div className="create-service-main">
          <button className="create-service-back" onClick={onBack}>
            <ArrowLeft size={21} /> Your services
          </button>
          <div className="create-service-heading">
            <h1>Create a new service</h1>
            <p>Give this service a name, then choose how to build your programme.</p>
          </div>
          <div className="create-service-fields">
            <label>
              Service name
              <input
                value={draft.name}
                placeholder="Sunday Service"
                onChange={(event) => onDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              Service date
              <input
                type="date"
                value={draft.serviceDate}
                onChange={(event) => onDraft({ ...draft, serviceDate: event.target.value })}
              />
            </label>
          </div>
          <div className="source-choice-section">
            <h2>Choose a starting point</h2>
            <div className="source-card-list" role="radiogroup" aria-label="Choose a starting point">
              <div
                className={`source-card ${selectedMethod === "blank" ? "selected" : ""}`}
                role="radio"
                aria-checked={selectedMethod === "blank"}
                tabIndex={0}
                onClick={onBlank}
                onKeyDown={activateCard(onBlank)}
              >
                <span className="source-card-icon" aria-hidden="true"><FileText size={30} /></span>
                <span className="source-card-copy">
                  <strong>Blank programme</strong>
                  <span>Start with an empty programme and build it from scratch in Service Setup.</span>
                </span>
                <span className="source-card-radio" aria-hidden="true" />
              </div>
              <div
                className={`source-card ${selectedMethod === "template" ? "selected" : ""}`}
                role="radio"
                aria-checked={selectedMethod === "template"}
                tabIndex={0}
                onClick={onTemplate}
                onKeyDown={activateCard(onTemplate)}
              >
                <span className="source-card-icon" aria-hidden="true"><Copy size={30} /></span>
                <span className="source-card-copy">
                  <strong>Saved template</strong>
                  <span>Start with a template and customise it in Service Setup.</span>
                  {selectedMethod === "template" && (
                    <select
                      value={selectedTemplateId ?? ""}
                      aria-label="Choose a saved template"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onUseTemplate(event.target.value)}
                    >
                      <option value="">Choose a saved template</option>
                      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  )}
                </span>
                <span className="source-card-radio" aria-hidden="true" />
              </div>
              <div className="source-card disabled" role="radio" aria-checked={false} aria-disabled="true">
                <span className="source-card-icon" aria-hidden="true"><ClipboardList size={30} /></span>
                <span className="source-card-copy">
                  <strong>Paste programme</strong>
                  <span>Paste an existing programme from another service or document.</span>
                  <span className="coming-soon-pill">Coming soon</span>
                </span>
                <span className="source-card-radio" aria-hidden="true" />
              </div>
            </div>
          </div>
          <div className="create-service-actions">
            <button className="create-cancel-button" onClick={onBack}>Cancel</button>
            <button className="create-continue-button" onClick={onContinue} disabled={!canContinue}>
              Continue to service setup
            </button>
          </div>
        </div>
        <ProgrammePreview draft={draft} selectedMethod={selectedMethod} selectedTemplate={selectedTemplate} />
      </div>
    </section>
  );
}

function ProgrammePreview({
  draft,
  selectedMethod,
  selectedTemplate,
}: {
  draft: DraftService;
  selectedMethod: SetupMethod | null;
  selectedTemplate: Template | null;
}) {
  const totalSeconds = draft.sections.reduce((total, section) => total + section.adjustedDurationSeconds, 0);
  const total = formatPreviewTotal(totalSeconds);
  const visibleSections = draft.sections.slice(0, 8);
  const remainingSections = Math.max(0, draft.sections.length - visibleSections.length);
  const sourceLabel = selectedMethod === "template" ? "Template" : selectedMethod === "blank" ? "Blank programme" : "Programme";
  const title = selectedTemplate?.name ?? (draft.name.trim() || "Sunday Service");

  return (
    <aside className="programme-preview" aria-label="Programme preview">
      <h2>Programme preview</h2>
      <div className="preview-source">
        <span className="preview-source-icon" aria-hidden="true"><FileText size={29} /></span>
        <span>
          <small>{sourceLabel}</small>
          <strong>{title}</strong>
        </span>
      </div>
      <div className="preview-meta">
        <span><CalendarDays size={19} /> {formatDraftDate(draft.serviceDate, { day: "numeric", month: "short", year: "numeric" })}</span>
        <span><ClipboardList size={19} /> {draft.sections.length} sections</span>
        <span><Clock size={19} /> {total.primary}<small> planned</small></span>
      </div>
      <div className="preview-list-heading"><span>#</span><span>Section</span><span>Time</span></div>
      <div className="preview-list">
        {visibleSections.length > 0 ? visibleSections.map((section, index) => (
          <div className="preview-row" key={section.id}>
            <span className="preview-index">{index + 1}</span>
            <strong>{section.name || "Untitled section"}</strong>
            <span>{formatPreviewDuration(section.adjustedDurationSeconds)}</span>
          </div>
        )) : (
          <div className="preview-empty">Your sections will appear here as you build the programme.</div>
        )}
      </div>
      {remainingSections > 0 && <div className="preview-more">{remainingSections} more sections <ChevronRight size={16} /></div>}
      <div className="preview-total"><span>Planned total</span><strong>{total.secondary}</strong></div>
      {draft.sections.length > 0 && (
        <div className="preview-note"><TriangleAlert size={22} /><span>This programme includes timed items. Adjustments may affect the total planned time.</span></div>
      )}
    </aside>
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

function PrepareScreen({
  draft,
  displays,
  statusMessage,
  onDraft,
  onRefreshDisplays,
  onStageSetup,
  onTestStage,
  onSaveTemplate,
  onStart,
  onSettings,
  onTemplates,
  onReports,
  onBack,
}: {
  draft: DraftService;
  displays: DisplayInfo[];
  statusMessage: string;
  onDraft: (draft: DraftService | ((draft: DraftService) => DraftService)) => void;
  onRefreshDisplays: () => void;
  onStageSetup: () => void;
  onTestStage: () => void;
  onSaveTemplate: () => void;
  onStart: () => void;
  onSettings: () => void;
  onTemplates: () => void;
  onReports: () => void;
  onBack: () => void;
}) {
  return (
    <section className="workspace-screen setup-screen prepare-screen">
      <WorkspaceRail
        active={null}
        onHome={onBack}
        onSettings={onSettings}
        onTemplates={onTemplates}
        onReports={onReports}
      />
      <div className="workspace-content prepare-content">
        <div className="workspace-heading prepare-heading">
          <div>
            <h1>Prepare {draft.name.trim() || "Sunday Service"}</h1>
            <p className="workspace-date">{formatPrepareDate(draft.serviceDate)}</p>
          </div>
        </div>
        <ProgramBuilder
          draft={draft}
          displays={displays}
          statusMessage={statusMessage}
          onDraft={onDraft}
          onRefreshDisplays={onRefreshDisplays}
          onStageSetup={onStageSetup}
          onTestStage={onTestStage}
          onSaveTemplate={onSaveTemplate}
          onStart={onStart}
          showBack={false}
        />
      </div>
    </section>
  );
}

function ProgramBuilder({
  draft,
  displays,
  statusMessage,
  onDraft,
  onRefreshDisplays,
  onStageSetup,
  onTestStage,
  onSaveTemplate,
  onStart,
  onBack,
  showBack = true,
}: {
  draft: DraftService;
  displays: DisplayInfo[];
  statusMessage: string;
  onDraft: (draft: DraftService | ((draft: DraftService) => DraftService)) => void;
  onRefreshDisplays: () => void;
  onStageSetup: () => void;
  onTestStage: () => void;
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
  const totalSeconds = draft.sections.reduce((total, section) => total + section.adjustedDurationSeconds, 0);
  const selectedDisplay = displays.find((display) => display.id === draft.selectedDisplayId) ?? null;
  const selectedDisplayName = selectedDisplay?.name ?? "Choose a display";
  const selectedDisplayDetails = selectedDisplay
    ? `${selectedDisplay.width} × ${selectedDisplay.height} (16:9)`
    : "Select a connected stage display";

  return (
    <section className="builder-layout">
      <div className="builder-main stack" data-programme-scroll-container>
        {showBack && onBack && <BackButton onClick={onBack} />}
        <div className="programme-heading">
          <div>
            <p className="eyebrow">Programme</p>
            <h2>Programme sections</h2>
          </div>
          <span className="programme-count">{draft.sections.length} {draft.sections.length === 1 ? "section" : "sections"}</span>
        </div>
        <ProgramEditor
          sections={draft.sections}
          onSections={(sections) => onDraft({ ...draft, sections })}
          protectCurrent={false}
        />
      </div>
      <aside className="setup-inspector">
        <div className="total-time-block">
          <span>Total service time</span>
          <strong>{formatPreviewDuration(totalSeconds)}</strong>
          <small>{formatPreviewTotal(totalSeconds).secondary}</small>
        </div>
        <div className="inspector-divider" />
        <div className="warning-rules-panel">
          <p className="eyebrow">Warning rules</p>
          <div className="warning-rule warning-threshold-rule">
            <TriangleAlert size={20} aria-hidden="true" />
            <div className="warning-rule-content">
              <label className="warning-threshold-label">
                <span>Warning threshold</span>
                <input
                  value={draft.warningInput}
                  placeholder="00:02:00"
                  aria-label="Warning threshold"
                  onChange={(event) => onDraft({ ...draft, warningInput: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                />
              </label>
              <span className="warning-rule-copy">Yellow when remaining time is <strong>{formatWarningThreshold(warningSeconds ?? 0)}</strong> or less</span>
            </div>
          </div>
          <div className="warning-rule warning-rule-danger">
            <TriangleAlert size={20} aria-hidden="true" />
            <span>Red when time reaches <strong>0:00</strong> or goes overtime.</span>
          </div>
        </div>
        <div className="inspector-divider" />
        <div className="inspector-heading">
          <p className="eyebrow">Stage display</p>
        </div>
        <label className="display-select-card">
          <Monitor size={27} aria-hidden="true" />
          <span className="display-select-copy">
            <strong>{selectedDisplayName}</strong>
            <small>{selectedDisplayDetails}</small>
          </span>
          <select
            value={draft.selectedDisplayId ?? ""}
            aria-label="Stage display screen"
            onChange={(event) => onDraft({ ...draft, selectedDisplayId: event.target.value })}
          >
            <option value="">Choose display</option>
            {displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.name} {display.isPrimary ? "(Primary)" : ""} - {display.width}x{display.height}
              </option>
            ))}
          </select>
          <ChevronDown size={18} aria-hidden="true" />
        </label>
        <button className="ghost large inspector-test-display icon-label" onClick={onTestStage}>
          <Monitor size={19} /> Test stage display
        </button>
        <div className="inspector-actions inspector-display-actions">
          <button className="ghost icon-label" onClick={onRefreshDisplays}>
            <Monitor size={16} /> Refresh displays
          </button>
          <button className="ghost icon-label" onClick={onStageSetup}>
            <SettingsIcon size={16} /> Configure
          </button>
        </div>
        <div className="inspector-divider" />
        <div className="inspector-options inspector-options-open">
          <p className="eyebrow">Service options</p>
          <div className="inspector-rules">
            <label className="toggle-line inspector-toggle">
              <input
                type="checkbox"
                checked={draft.autoMoveToNextSection}
                onChange={(event) => onDraft({ ...draft, autoMoveToNextSection: event.target.checked })}
              />
              Auto move to next section
            </label>
            <button className="ghost icon-label" onClick={onSaveTemplate}>
              <Save size={17} /> Save template
            </button>
          </div>
        </div>
        <button className="primary start-service-button" onClick={onStart} disabled={!canStart}>
          <Play size={19} fill="currentColor" aria-hidden="true" /> Start service
        </button>
        <p className="start-service-hint">You’ll be taken to the Live Console</p>
        {displayStatusMessage && <p className="action-warning">{displayStatusMessage}</p>}
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
  onSettings,
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
  onSettings: () => void;
  updateActive: (updater: (service: ActiveService) => ActiveService | null) => void;
  moveToNextSection: (service: ActiveService, endedAtPlannedTime: boolean) => ActiveService;
}) {
  const [now, setNow] = useState(Date.now());
  const [stageToolsOpen, setStageToolsOpen] = useState(false);
  const section = currentSection(service);
  const remaining = section ? remainingForSection(section, now) : 0;
  const tone = section ? timerTone(remaining, service.warningThresholdSeconds) : "normal";
  const currentIndex = service.sections.findIndex((item) => item.id === service.currentSectionId);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!service.autoMoveToNextSection || service.status !== "running" || !section || remaining > 0) return;
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
    <section className="live-console">
      <div className="live-console-header">
        <div className="live-console-brand">
          <span className="live-window-lights" aria-hidden="true">
            <span className="window-light red" />
            <span className="window-light amber" />
            <span className="window-light green" />
          </span>
          <strong>Church Timer Pro</strong>
          <span className="header-divider" aria-hidden="true" />
          <span>The Live Console</span>
        </div>
        <div className="live-console-header-actions">
          <span className={`connection-status ${status.connected ? "connected" : ""}`}>
            <span className={`connection-dot ${status.connected ? "connected" : ""}`} aria-hidden="true" />
            {status.connected ? "Display Connected" : "Display Offline"}
          </span>
          <button
            className="header-stage-button"
            onClick={() => setStageToolsOpen(true)}
            aria-expanded={stageToolsOpen}
            aria-controls="stage-display-tools-drawer"
          >
            <Monitor size={17} /> Stage tools
          </button>
          <button className="header-end-service-button" onClick={onEnd}>
            End service
          </button>
          <button className="header-settings-button" onClick={onSettings} aria-label="Open settings">
            <SettingsIcon size={17} />
          </button>
        </div>
      </div>
      <div className="live-console-body">
        <aside className="live-timer-column">
          <p className="eyebrow">Current section</p>
          <h1>{section?.name ?? "No section selected"}</h1>
          <div className={`timer-ring ${tone}`}>
            <div className="timer-ring-inner">
              <strong>{formatConsoleTimer(remaining)}</strong>
              <span>Remaining</span>
            </div>
          </div>
          <span className={`live-state-pill ${service.status === "running" ? "live" : "paused"}`}>
            <span className="live-state-dot" aria-hidden="true" />
            {service.status === "running" ? "Live" : service.status === "setup" ? "Ready" : "Paused"}
          </span>
          <div className="six-controls" aria-label="Timer controls">
            <div className="control-row">
              <button className="console-control" onClick={service.status === "paused" ? onResume : onStart} disabled={service.status === "running"}>
                <Play size={20} /> Start
              </button>
              <button className="console-control" onClick={onPause} disabled={service.status !== "running"}>
                <Pause size={20} /> Pause
              </button>
              <button className="console-control" onClick={onNextSection}>
                <StepForward size={20} /> Next
              </button>
            </div>
            <div className="control-row">
              <button className="console-control" onClick={() => onQuickTimeChange(60)}><Plus size={20} /> +1 minute</button>
              <button className="console-control" onClick={() => onQuickTimeChange(-60)}><Minus size={20} /> −1 minute</button>
              <button className="console-control" onClick={onRestart}><RotateCcw size={20} /> Reset</button>
            </div>
          </div>
        </aside>
        <main className="queue-panel">
          <div className="queue-heading">
            <h2>Programme queue</h2>
            <div className="queue-columns"><span>Planned<br /><small>(dur / start)</small></span><span>Actual<br /><small>(dur / start)</small></span></div>
          </div>
          <ProgramSectionsList
            service={service}
            onEdit={(item) => onSectionModal({ mode: "edit", targetId: item.id, name: item.name, duration: secondsToInput(item.adjustedDurationSeconds), error: "" })}
            updateActive={updateActive}
          />
          <button className="add-live-section" onClick={() => onSectionModal({ mode: "add", targetId: null, name: "", duration: "00:05:00", error: "" })}>
            <Plus size={17} /> Add section
          </button>
          <div className="queue-summary">
            <Stat label="Elapsed" value={formatDuration(service.sections.reduce((total, item) => total + elapsedForSection(item, now), 0))} />
            <Stat label="Behind schedule" value={formatDuration(Math.max(0, service.sections.reduce((total, item) => total + elapsedForSection(item, now), 0) - service.sections.slice(0, Math.max(0, currentIndex + 1)).reduce((total, item) => total + item.adjustedDurationSeconds, 0)))} />
            <Stat label="Total service" value={formatDuration(service.sections.reduce((total, item) => total + item.adjustedDurationSeconds, 0))} />
          </div>
        </main>
      </div>
      {stageToolsOpen && (
        <div className="stage-tools-layer">
          <button className="stage-tools-scrim" aria-label="Close display tools" onClick={() => setStageToolsOpen(false)} />
          <aside id="stage-display-tools-drawer" className="stage-side-panel stage-tools-drawer" aria-label="Stage display tools">
            <div className="stage-side-heading">
              <div>
                <p className="eyebrow">Live Console</p>
                <h2>Stage display tools</h2>
              </div>
              <button className="icon-button" onClick={() => setStageToolsOpen(false)} aria-label="Close display tools">
                <X size={17} />
              </button>
            </div>
            <MiniPreview service={service} now={now} />
            <p className="status-line">{status.message}</p>
            <DisplaySelect displays={displays} value={service.selectedDisplayId} onChange={onChooseDisplay} />
            <button className="ghost icon-label" onClick={onRefreshDisplays}><Monitor size={17} /> Refresh displays</button>
            <button className="ghost icon-label" onClick={onReopenStage}><Monitor size={17} /> Reopen stage display</button>
            <button className="ghost icon-label" onClick={onToggleStage}>
              {service.stageDisplayHidden ? <Eye size={17} /> : <EyeOff size={17} />}
              {service.stageDisplayHidden ? "Show stage output" : "Hide stage output"}
            </button>
            <button className="ghost icon-label" onClick={onSettings}><SettingsIcon size={17} /> Settings</button>
            <button className="danger end-service-button" onClick={onEnd}>End service</button>
          </aside>
        </div>
      )}
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

function formatConsoleTimer(totalSeconds: number) {
  const sign = totalSeconds < 0 ? "+" : "";
  const absolute = Math.floor(Math.abs(totalSeconds));
  if (absolute >= 3600) return `${sign}${formatDuration(absolute)}`;
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${sign}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const queueListRef = useRef<HTMLDivElement>(null);
  const queueDragRef = useRef<{ sectionId: string; pointerId: number } | null>(null);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "end" | null>(null);

  const move = (sectionId: string, direction: -1 | 1) => {
    updateActive((current) => {
      const currentIndex = current.sections.findIndex((section) => section.id === current.currentSectionId);
      const index = current.sections.findIndex((section) => section.id === sectionId);
      const target = index + direction;
      const candidate = current.sections[index];
      if (!candidate || candidate.status !== "pending" || index <= currentIndex || target <= currentIndex || target < 0 || target >= current.sections.length) return current;
      const nextSections = [...current.sections];
      [nextSections[index], nextSections[target]] = [nextSections[target], nextSections[index]];
      return { ...current, sections: nextSections };
    });
  };
  const reorderUpcoming = (sectionId: string, targetSectionId: string | "end") => {
    updateActive((current) => ({
      ...current,
      sections: reorderUpcomingSections(current.sections, current.currentSectionId, sectionId, targetSectionId),
    }));
  };
  const findDropTarget = (clientX: number, clientY: number): string | "end" | null => {
    const list = queueListRef.current;
    if (!list) return null;
    const listBounds = list.getBoundingClientRect();
    if (clientX < listBounds.left || clientX > listBounds.right || clientY < listBounds.top || clientY > listBounds.bottom) return null;
    const upcomingRows = Array.from(list.querySelectorAll<HTMLElement>('[data-queue-upcoming="true"]'));
    if (upcomingRows.length === 0) return null;
    for (const row of upcomingRows) {
      const bounds = row.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) return row.dataset.queueSectionId ?? null;
    }
    return "end";
  };
  const startQueueDrag = (event: ReactPointerEvent<HTMLButtonElement>, sectionId: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    queueDragRef.current = { sectionId, pointerId: event.pointerId };
    setDraggedSectionId(sectionId);
    setDropTarget(sectionId);
  };
  const moveQueueDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!queueDragRef.current || queueDragRef.current.pointerId !== event.pointerId) return;
    setDropTarget(findDropTarget(event.clientX, event.clientY));
  };
  const finishQueueDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = queueDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = findDropTarget(event.clientX, event.clientY);
    if (target) reorderUpcoming(drag.sectionId, target);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    queueDragRef.current = null;
    setDraggedSectionId(null);
    setDropTarget(null);
  };
  const cancelQueueDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!queueDragRef.current || queueDragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    queueDragRef.current = null;
    setDraggedSectionId(null);
    setDropTarget(null);
  };
  const remove = (sectionId: string) => {
    updateActive((current) => {
      const section = current.sections.find((item) => item.id === sectionId);
      if (!section || section.status === "completed" || section.status === "skipped" || section.id === current.currentSectionId) return current;
      return { ...current, sections: current.sections.filter((item) => item.id !== sectionId) };
    });
  };
  const duplicate = (section: Section) => {
    updateActive((current) => {
      const currentIndex = current.sections.findIndex((item) => item.id === current.currentSectionId);
      const index = current.sections.findIndex((item) => item.id === section.id);
      if (index <= currentIndex || section.status !== "pending") return current;
      const clone = createSection(section.name, section.adjustedDurationSeconds);
      return { ...current, sections: [...current.sections.slice(0, index + 1), clone, ...current.sections.slice(index + 1)] };
    });
  };
  const completedSections = service.sections.filter((item) => item.status === "completed" || item.status === "skipped");
  const liveSections = service.sections.filter((item) => item.id === service.currentSectionId);
  const upcomingSections = service.sections.filter((item) => item.id !== service.currentSectionId && item.status === "pending");
  const renderRow = (section: Section, index: number) => {
    const isActive = section.id === service.currentSectionId;
    const isCompleted = section.status === "completed" || section.status === "skipped";
    const isUpcoming = !isActive && !isCompleted && section.status === "pending";
    const actualSeconds = elapsedForSection(section, Date.now());
    const plannedOffset = service.sections
      .slice(0, index)
      .reduce((total, item) => total + item.adjustedDurationSeconds, 0);
    return (
      <div
        className={`queue-row ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""} ${draggedSectionId === section.id ? "is-dragged" : ""} ${dropTarget === section.id ? "is-drop-target" : ""}`}
        key={section.id}
        data-queue-section-id={section.id}
        data-queue-upcoming={isUpcoming ? "true" : undefined}
        aria-label={`${section.name}, ${isActive ? "live" : isCompleted ? "completed" : "upcoming"}`}
      >
        <div className="queue-row-icon queue-row-drag-cell">
          {isUpcoming ? (
            <button
              type="button"
              className="queue-drag-handle"
              onPointerDown={(event) => startQueueDrag(event, section.id)}
              onPointerMove={moveQueueDrag}
              onPointerUp={finishQueueDrag}
              onPointerCancel={cancelQueueDrag}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(section.id, event.key === "ArrowUp" ? -1 : 1);
                }
              }}
              aria-label={`Rearrange ${section.name}. Use the arrow keys to move it.`}
              title="Drag to rearrange upcoming sections"
            >
              <GripVertical size={22} aria-hidden="true" />
            </button>
          ) : (
            <span className="queue-drag-handle queue-drag-handle-locked" aria-hidden="true">
              <GripVertical size={22} />
            </span>
          )}
        </div>
        <div className="queue-row-icon"><SectionIcon name={section.name} /></div>
        <div className="queue-row-title"><strong>{section.name}</strong><span>{isActive ? "Live" : isCompleted ? "Completed" : "Upcoming"}</span></div>
        <div className="queue-row-time planned"><strong>{formatDuration(section.adjustedDurationSeconds)}</strong><small>{plannedOffset === 0 ? "Start" : `+${formatDuration(plannedOffset)}`}</small></div>
        <div className="queue-row-time actual"><strong>{actualSeconds > 0 ? formatDuration(actualSeconds) : "—"}</strong><small>{formatQueueTime(section.startedAt)}</small></div>
        <div className="queue-row-actions">
          {isCompleted ? <CheckCircle2 size={19} aria-label="Completed" /> : isActive ? <span className="queue-live-marker" aria-label="Live"><span className="queue-live-dot" /> LIVE</span> : (
            <details className="queue-actions-menu">
              <summary className="icon-button" aria-label={`Actions for ${section.name}`}><MoreHorizontal size={17} /></summary>
              <div className="queue-actions-popover">
                <button className="icon-button" onClick={() => move(section.id, -1)} disabled={!isUpcoming || upcomingSections[0]?.id === section.id} aria-label={`Move ${section.name} up`}><ArrowUp size={14} /></button>
                <button className="icon-button" onClick={() => move(section.id, 1)} disabled={!isUpcoming || upcomingSections[upcomingSections.length - 1]?.id === section.id} aria-label={`Move ${section.name} down`}><ArrowDown size={14} /></button>
                <button className="icon-button" onClick={() => duplicate(section)} disabled={!isUpcoming} aria-label={`Duplicate ${section.name}`}><Copy size={14} /></button>
                {isUpcoming && <button className="icon-button" onClick={() => onEdit(section)} aria-label={`Edit ${section.name}`}><MoreHorizontal size={16} /></button>}
                {isUpcoming && <button className="icon-button danger-text" onClick={() => remove(section.id)} aria-label={`Delete ${section.name}`}><Trash2 size={14} /></button>}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className={`queue-list ${draggedSectionId ? "is-dragging" : ""} ${dropTarget === "end" ? "has-end-drop-target" : ""}`} ref={queueListRef}>
      {completedSections.length > 0 && <div className="queue-group-label">Completed</div>}
      {completedSections.map((section) => renderRow(section, service.sections.indexOf(section)))}
      {liveSections.length > 0 && <div className="queue-group-label">Live</div>}
      {liveSections.map((section) => renderRow(section, service.sections.indexOf(section)))}
      {upcomingSections.length > 0 && <div className="queue-group-label">Upcoming</div>}
      {upcomingSections.map((section) => renderRow(section, service.sections.indexOf(section)))}
      {dropTarget === "end" && <div className="queue-drop-end" aria-hidden="true" />}
      {service.sections.length === 0 && <EmptyState text="No programme sections yet." />}
    </div>
  );
}

function formatQueueTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SectionIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  if (normalized.includes("prayer") || normalized.includes("reading")) return <BookOpen size={19} />;
  if (normalized.includes("sermon") || normalized.includes("message")) return <UserRound size={19} />;
  if (normalized.includes("offering")) return <Hand size={19} />;
  if (normalized.includes("announcement") || normalized.includes("welcome")) return <MessageCircle size={19} />;
  return <Music2 size={19} />;
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
}: {
  templates: Template[];
  onNew: () => void;
  onEdit: (template: Template) => void;
  onUse: (template: Template) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="stack">
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

function ReportsScreen({ reports, onOpen }: { reports: ServiceReport[]; onOpen: (report: ServiceReport) => void }) {
  return (
    <section className="stack">
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
}: {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onCheckUpdates: () => void;
  updateStatus: { checking: boolean; checked: boolean; message: string };
}) {
  return (
    <section className="stack narrow">
      <h1>Settings</h1>
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
        <DurationInput
          valueSeconds={settings.defaultWarningTimeSeconds}
          ariaLabel="Default warning time"
          onChange={(seconds) => onSettings({ ...settings, defaultWarningTimeSeconds: seconds })}
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const pointerDragRef = useRef<{ index: number; pointerId: number } | null>(null);
  const programEditorRef = useRef<HTMLDivElement>(null);
  const pendingScrollToEndRef = useRef(false);

  useEffect(() => {
    if (!pendingScrollToEndRef.current) return;
    pendingScrollToEndRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = programEditorRef.current?.closest<HTMLElement>("[data-programme-scroll-container]");
      if (!scrollContainer) return;
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sections.length]);

  const update = (index: number, next: Partial<Section>) => {
    onSections(sections.map((section, sectionIndex) => (sectionIndex === index ? { ...section, ...next } : section)));
  };
  const reorder = (fromIndex: number, targetIndex: number) => {
    if (fromIndex < 0 || fromIndex >= sections.length || targetIndex < 0 || targetIndex > sections.length || fromIndex === targetIndex || fromIndex + 1 === targetIndex) return;
    const next = [...sections];
    const [moved] = next.splice(fromIndex, 1);
    const insertionIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
    next.splice(insertionIndex, 0, moved);
    onSections(next);
  };
  const dropPositionAtPoint = (clientX: number, clientY: number) => {
    const list = document.querySelector<HTMLElement>("[data-program-editor-list]");
    if (!list) return null;
    const listRect = list.getBoundingClientRect();
    if (clientX < listRect.left || clientX > listRect.right || clientY < listRect.top || clientY > listRect.bottom) return null;

    const rows = [...list.querySelectorAll<HTMLElement>("[data-editor-row-index]")];
    for (const row of rows) {
      const rowRect = row.getBoundingClientRect();
      const index = Number(row.dataset.editorRowIndex);
      if (!Number.isInteger(index)) continue;
      if (clientY < rowRect.top + rowRect.height / 2) return index;
    }
    return sections.length;
  };
  const finishPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!cancelled) {
      const targetIndex = dropPositionAtPoint(event.clientX, event.clientY);
      if (targetIndex !== null) reorder(drag.index, targetIndex);
    }
    pointerDragRef.current = null;
    setDraggedIndex(null);
    setDropTargetIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="program-editor" ref={programEditorRef}>
      <div className="program-editor-actions">
        <span className="table-heading">Section</span>
        <span className="table-heading">Planned</span>
        <span className="table-heading">Warning</span>
      </div>
      <div className="list compact" data-program-editor-list>
        {sections.length === 0 && <EmptyState text="No program sections yet. Add the first section when you are ready." />}
        {sections.map((section, index) => (
          <div
            key={section.id}
            className="editor-row-group"
          >
            <div
              className={`editor-row ${draggedIndex === index ? "is-dragging" : ""} ${dropTargetIndex === index ? "is-drop-target-before" : ""} ${index === sections.length - 1 && dropTargetIndex === sections.length ? "is-drop-target-after" : ""}`}
              data-editor-row-index={index}
            >
              <button
                type="button"
                className="drag-handle"
                aria-label={`Drag ${section.name || "section"} to reorder`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pointerDragRef.current = { index, pointerId: event.pointerId };
                  setDraggedIndex(index);
                  setDropTargetIndex(index);
                }}
                onPointerMove={(event) => {
                  if (pointerDragRef.current?.pointerId !== event.pointerId) return;
                  setDropTargetIndex(dropPositionAtPoint(event.clientX, event.clientY));
                }}
                onPointerUp={(event) => finishPointerDrag(event)}
                onPointerCancel={(event) => finishPointerDrag(event, true)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  reorder(index, event.key === "ArrowUp" ? index - 1 : index + 2);
                }}
              >
                <GripVertical size={17} aria-hidden="true" />
              </button>
              <span className="editor-index">{index + 1}</span>
              <input
                value={section.name}
                onChange={(event) => update(index, { name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
                aria-label={`${section.name || "Section"} name`}
              />
              <div className="editor-duration-cell">
                <Clock size={15} aria-hidden="true" />
                <DurationInput
                  valueSeconds={section.adjustedDurationSeconds}
                  ariaLabel={`${section.name || "Section"} duration`}
                  onChange={(seconds) => update(index, { originalDurationSeconds: seconds, adjustedDurationSeconds: seconds })}
                />
              </div>
              <div className="editor-row-actions">
                <button className="icon-button" onClick={() => onSections([...sections.slice(0, index + 1), { ...section, id: createId("section") }, ...sections.slice(index + 1)])} aria-label={`Duplicate ${section.name || "section"}`}>
                  <Copy size={15} />
                </button>
                <button className="icon-button danger-text" onClick={() => onSections(sections.filter((item) => item.id !== section.id))} aria-label={`Delete ${section.name || "section"}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        className="ghost icon-label add-prepare-section"
        onClick={() => {
          pendingScrollToEndRef.current = true;
          onSections([...sections, createSection()]);
        }}
      >
        <Plus size={17} /> Add section
      </button>
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
