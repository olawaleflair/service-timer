const DURATION_RE = /^(\d+):([0-5]\d):([0-5]\d)$/;

export interface DurationSegments {
  hours: string;
  minutes: string;
  seconds: string;
}

export interface DurationValidation {
  valid: boolean;
  error: string | null;
}

export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  const match = trimmed.match(DURATION_RE);
  if (!match) return null;
  const [, hh, mm, ss] = match;
  const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatDuration(totalSeconds: number, options: { overtime?: boolean } = {}): string {
  const sign = options.overtime || totalSeconds < 0 ? "-" : "";
  const absolute = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const seconds = absolute % 60;
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatTimer(remainingSeconds: number): string {
  if (remainingSeconds < 0) {
    return formatDuration(Math.abs(remainingSeconds), { overtime: true });
  }
  return formatDuration(remainingSeconds);
}

export function secondsToInput(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}

export function secondsToDurationSegments(seconds: number): DurationSegments {
  const [hours, minutes, secondsPart] = formatDuration(Math.max(0, seconds)).split(":");
  return { hours, minutes, seconds: secondsPart };
}

export function normalizeDurationSegment(value: string): string {
  return value.padStart(2, "0");
}

export function validateDurationSegments(segments: DurationSegments): DurationValidation {
  if (!isDigits(segments.hours) || !isDigits(segments.minutes) || !isDigits(segments.seconds)) {
    return { valid: false, error: "Duration segments must contain numbers only." };
  }
  if (segments.hours === "" || segments.minutes === "" || segments.seconds === "") {
    return { valid: false, error: "Hours, minutes, and seconds are required." };
  }
  const minutes = Number(segments.minutes);
  const seconds = Number(segments.seconds);
  if (minutes > 59) return { valid: false, error: "Minutes must be 59 or less." };
  if (seconds > 59) return { valid: false, error: "Seconds must be 59 or less." };
  return { valid: true, error: null };
}

export function durationSegmentsToSeconds(segments: DurationSegments): number | null {
  const validation = validateDurationSegments(segments);
  if (!validation.valid) return null;
  return Number(segments.hours) * 3600 + Number(segments.minutes) * 60 + Number(segments.seconds);
}

export function parseDurationSegments(hours: string, minutes: string, seconds: string): number | null {
  return durationSegmentsToSeconds({
    hours: normalizeDurationSegment(hours),
    minutes: normalizeDurationSegment(minutes),
    seconds: normalizeDurationSegment(seconds),
  });
}

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isDigits(value: string): boolean {
  return /^\d+$/.test(value);
}
