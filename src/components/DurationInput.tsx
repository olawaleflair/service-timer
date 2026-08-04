import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DurationSegments } from "../utils/time";
import {
  durationSegmentsToSeconds,
  normalizeDurationSegment,
  secondsToDurationSegments,
  validateDurationSegments,
} from "../utils/time";

type SegmentName = keyof DurationSegments;

interface DurationInputProps {
  valueSeconds: number;
  onChange: (seconds: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

const segmentOrder: SegmentName[] = ["hours", "minutes", "seconds"];

export function DurationInput({ valueSeconds, onChange, ariaLabel = "Duration", disabled = false }: DurationInputProps) {
  const [segments, setSegments] = useState<DurationSegments>(() => secondsToDurationSegments(valueSeconds));
  const [error, setError] = useState<string | null>(null);
  const refs = {
    hours: useRef<HTMLInputElement>(null),
    minutes: useRef<HTMLInputElement>(null),
    seconds: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    setSegments(secondsToDurationSegments(valueSeconds));
    setError(null);
  }, [valueSeconds]);

  const commit = () => {
    const normalized = {
      hours: normalizeDurationSegment(segments.hours),
      minutes: normalizeDurationSegment(segments.minutes),
      seconds: normalizeDurationSegment(segments.seconds),
    };
    const validation = validateDurationSegments(normalized);
    if (!validation.valid) {
      setError(validation.error);
      setSegments(secondsToDurationSegments(valueSeconds));
      return;
    }
    const seconds = durationSegmentsToSeconds(normalized);
    if (seconds === null || seconds <= 0) {
      setError("Duration must be greater than zero.");
      setSegments(secondsToDurationSegments(valueSeconds));
      return;
    }
    setError(null);
    setSegments(normalized);
    onChange(seconds);
  };

  const cancel = () => {
    setSegments(secondsToDurationSegments(valueSeconds));
    setError(null);
  };

  const updateSegment = (segment: SegmentName, value: string) => {
    const digitsOnly = value.replace(/\D/g, "");
    setSegments((current) => ({ ...current, [segment]: digitsOnly.slice(0, segment === "hours" ? 3 : 2) }));
    setError(null);
  };

  const focusSegment = (segment: SegmentName) => {
    const input = refs[segment].current;
    input?.focus();
    input?.select();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, segment: SegmentName) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const currentIndex = segmentOrder.indexOf(segment);
      const nextIndex = event.key === "ArrowLeft" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < segmentOrder.length) {
        event.preventDefault();
        focusSegment(segmentOrder[nextIndex]);
      }
    }
  };

  return (
    <div className={`duration-input-wrap ${error ? "has-error" : ""}`}>
      <div className="duration-input" aria-label={ariaLabel}>
        <SegmentInput
          ref={refs.hours}
          value={segments.hours}
          label="Hours"
          disabled={disabled}
          onChange={(value) => updateSegment("hours", value)}
          onBlur={commit}
          onKeyDown={(event) => onKeyDown(event, "hours")}
        />
        <span>:</span>
        <SegmentInput
          ref={refs.minutes}
          value={segments.minutes}
          label="Minutes"
          disabled={disabled}
          onChange={(value) => updateSegment("minutes", value)}
          onBlur={commit}
          onKeyDown={(event) => onKeyDown(event, "minutes")}
        />
        <span>:</span>
        <SegmentInput
          ref={refs.seconds}
          value={segments.seconds}
          label="Seconds"
          disabled={disabled}
          onChange={(value) => updateSegment("seconds", value)}
          onBlur={commit}
          onKeyDown={(event) => onKeyDown(event, "seconds")}
        />
      </div>
      {error && <span className="duration-error">{error}</span>}
    </div>
  );
}

interface SegmentInputProps {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

const SegmentInput = forwardRef<HTMLInputElement, SegmentInputProps>(
  ({ value, label, disabled, onChange, onBlur, onKeyDown }, ref) => (
    <input
      ref={ref}
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      aria-label={label}
      disabled={disabled}
      onFocus={(event) => event.currentTarget.select()}
      onBeforeInput={(event) => {
        const data = event.data ?? "";
        if (data && /\D/.test(data)) event.preventDefault();
      }}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  ),
);
