export type Screen =
  | "home"
  | "start"
  | "builder"
  | "templatePicker"
  | "paste"
  | "pasteReview"
  | "stageSetup"
  | "live"
  | "templates"
  | "templateEditor"
  | "reports"
  | "reportDetail"
  | "settings";

export type ServiceStatus = "setup" | "running" | "paused" | "ended" | "recoveredPaused";
export type SectionStatus = "pending" | "running" | "paused" | "completed" | "skipped";

export interface Section {
  id: string;
  name: string;
  originalDurationSeconds: number;
  adjustedDurationSeconds: number;
  addedSeconds: number;
  reducedSeconds: number;
  actualElapsedSeconds: number;
  status: SectionStatus;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ActiveService {
  id: string;
  name: string;
  date: string;
  warningThresholdSeconds: number;
  autoMoveToNextSection: boolean;
  sections: Section[];
  currentSectionId: string | null;
  status: ServiceStatus;
  stageDisplayOpenedOnce: boolean;
  stageDisplayHidden: boolean;
  selectedDisplayId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  sections: Pick<Section, "id" | "name" | "originalDurationSeconds" | "adjustedDurationSeconds">[];
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  soundAlerts: boolean;
  autoMoveToNextSection: boolean;
  defaultWarningTimeSeconds: number;
  lastSelectedDisplayId: string | null;
}

export interface DisplayInfo {
  id: string;
  name: string;
  isPrimary: boolean;
  width: number;
  height: number;
  scaleFactor: number;
  connected: boolean;
}

export interface StageDisplayStatus {
  opened: boolean;
  connected: boolean;
  message: string;
}

export interface UpdateStatus {
  checked: boolean;
  checking: boolean;
  available: boolean;
  message: string;
}

export interface ReportSection {
  id: string;
  name: string;
  originalPlannedSeconds: number;
  addedSeconds: number;
  reducedSeconds: number;
  finalAdjustedPlannedSeconds: number;
  actualSeconds: number;
  varianceSeconds: number;
  skipped: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ServiceReport {
  id: string;
  serviceName: string;
  serviceDate: string;
  createdAt: string;
  sections: ReportSection[];
  totalPlannedSeconds: number;
  totalActualSeconds: number;
  overtimeSections: string[];
  insights: string[];
}

export interface AppState {
  screen: Screen;
  settings: Settings;
  templates: Template[];
  reports: ServiceReport[];
  activeService: ActiveService | null;
  stageDisplayStatus: StageDisplayStatus;
  updateStatus: UpdateStatus;
}

export interface StagePayload {
  mode: "timer" | "test" | "hidden" | "blank";
  sectionName: string;
  timerText: string;
  tone: "normal" | "warning" | "overtime";
}

export interface ParsedProgramRow {
  id: string;
  raw: string;
  name: string;
  durationSeconds: number;
  valid: boolean;
  error?: string;
}
