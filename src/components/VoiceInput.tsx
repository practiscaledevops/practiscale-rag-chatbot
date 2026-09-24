"use client";

// Voice dictation button. Records in the browser with MediaRecorder, POSTs the
// audio to /api/voice (which forwards to the Brain for transcription), and hands
// the transcript back through `onText`. If MediaRecorder / getUserMedia are
// unavailable the button hides itself. The mic stream is always released on stop
// / unmount so it never stays on.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import {
  AUTO_STOP_MS,
  MIN_RECORDING_MS,
  fileNameForMime,
  formatElapsed,
  overUploadLimit,
  pickRecorderMimeType,
} from "@/lib/voice-shared";

type Phase = "idle" | "recording" | "transcribing";

export interface VoiceInputProps {
  /** Called with the transcript once transcription succeeds. */
  onText: (text: string) => void;
  /** POST target that returns `{ text }` (defaults to this app's /api/voice). */
  endpoint?: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

const PERMISSION_MESSAGE =
  "Microphone access was blocked — allow it in your browser's site settings.";

export function VoiceInput({
  onText,
  endpoint = "/api/voice",
  size = "md",
  className,
  disabled,
}: VoiceInputProps) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a stop should NOT upload (unmount, or a cancelled recording).
  const abortUploadRef = useRef(false);

  // Feature-detect after mount — SSR has no navigator / MediaRecorder. Rendering
  // nothing until confirmed matches the server output, so there's no hydration
  // mismatch; the button appears once support is known.
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const upload = useCallback(
    async (blob: Blob) => {
      setPhase("transcribing");
      try {
        const fd = new FormData();
        fd.append("file", blob, fileNameForMime(mimeRef.current));
        const res = await fetch(endpoint, { method: "POST", body: fd });
        const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) {
          throw new Error(typeof json.error === "string" ? json.error : "Transcription failed.");
        }
        const text = (json.text ?? "").trim();
        if (text) onText(text);
        else setError("No speech detected in the recording.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed.");
      } finally {
        setPhase("idle");
      }
    },
    [endpoint, onText]
  );

  // MediaRecorder.onstop: assemble the blob, release the mic, then decide whether
  // to upload (skip too-short / oversized / cancelled recordings).
  const handleStop = useCallback(() => {
    clearTimers();
    releaseStream();
    const durationMs = Date.now() - startedAtRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const blob = new Blob(chunks, { type: mimeRef.current || "audio/webm" });

    if (abortUploadRef.current) {
      abortUploadRef.current = false;
      setPhase("idle");
      return;
    }
    if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
      setPhase("idle");
      return;
    }
    if (overUploadLimit(blob.size)) {
      setError("Recording too long — keep dictation under a few minutes.");
      setPhase("idle");
      return;
    }
    void upload(blob);
  }, [clearTimers, releaseStream, upload]);

  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // fires onstop → handleStop
    } else {
      releaseStream();
      setPhase("idle");
    }
  }, [clearTimers, releaseStream]);

  const start = useCallback(async () => {
    setError(null);
    setNote(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setError(PERMISSION_MESSAGE);
      else if (name === "NotFoundError" || name === "DevicesNotFoundError")
        setError("No microphone was found.");
      else setError(e instanceof Error ? e.message : "Couldn't start recording.");
      return;
    }
    streamRef.current = stream;
    try {
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      mimeRef.current = recorder.mimeType || mimeType || "audio/webm";
      chunksRef.current = [];
      abortUploadRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");
      tickRef.current = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 200);
      autoStopRef.current = setTimeout(() => {
        setNote("Reached the 5-minute limit — transcribing what you recorded.");
        stopRecording();
      }, AUTO_STOP_MS);
    } catch (e) {
      releaseStream();
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Couldn't start recording.");
    }
  }, [handleStop, releaseStream, stopRecording]);

  const toggle = useCallback(() => {
    if (phase === "recording") stopRecording();
    else if (phase === "idle") void start();
  }, [phase, start, stopRecording]);

  // Release the mic and drop any pending upload if we unmount mid-recording.
  useEffect(() => {
    return () => {
      abortUploadRef.current = true;
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [clearTimers]);

  if (!supported) return null;

  const recording = phase === "recording";
  const transcribing = phase === "transcribing";
  // 16px on the 32px button, 14px on the compact 28px one.
  const iconSize = size === "sm" ? 14 : 16;

  return (
    <div className={cn("relative flex items-center", className)}>
      {(error || note || recording) && (
        <span
          role={error ? "alert" : "status"}
          className={cn(
            "absolute bottom-full right-0 mb-1.5 w-max max-w-[15rem] rounded-lg border px-2 py-1 text-xs shadow-soft",
            error
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-border bg-surface text-muted-foreground"
          )}
        >
          {error ? (
            error
          ) : recording ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
              {formatElapsed(elapsed)}
            </span>
          ) : (
            note
          )}
        </span>
      )}
      <IconButton
        type="button"
        size={size}
        aria-label={recording ? "Stop recording" : "Dictate"}
        aria-pressed={recording}
        title={recording ? "Stop recording" : "Dictate"}
        onClick={toggle}
        disabled={disabled || transcribing}
        className={cn(
          "shrink-0",
          recording &&
            "animate-pulse bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger"
        )}
      >
        {transcribing ? (
          <Loader2 size={iconSize} className="animate-spin" />
        ) : recording ? (
          <Square size={iconSize - 3} className="fill-current" />
        ) : (
          <Mic size={iconSize} />
        )}
      </IconButton>
    </div>
  );
}
