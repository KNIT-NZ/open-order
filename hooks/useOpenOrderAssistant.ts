// hooks/useOpenOrderAssistant.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCanonicalCitationHref, formatAiDebugSnapshot } from "../lib/open-order/format";
import {
  EMPTY_AI_DIAGNOSTICS,
  type AiAuthority,
  type AiDiagnostics,
  type AiDiagnosticsPayload,
  type AiPlan,
} from "../lib/open-order/types";

export function useOpenOrderAssistant() {
  const [question, setQuestion] = useState("");
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [authorities, setAuthorities] = useState<AiAuthority[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AiDiagnostics>(EMPTY_AI_DIAGNOSTICS);

  useEffect(() => {
    if (!copiedToken) return;
    const timeout = window.setTimeout(() => setCopiedToken(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedToken]);

  async function ask(requestedCorpus: string | null) {
    const trimmed = question.trim();
    if (!trimmed) return;

    setError(null);
    setStageLabel("Starting AI analysis");
    setPlan(null);
    setAuthorities([]);
    setAnswerText("");
    setIsLoading(true);

    setDiagnostics({
      ...EMPTY_AI_DIAGNOSTICS,
      question: trimmed,
      requestedCorpus: requestedCorpus || null,
      stageLabel: "Starting AI analysis",
      startedAt: new Date().toISOString(),
    });

    try {
      const res = await fetch("/api/ai/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          corpus: requestedCorpus || null,
        }),
      });

      if (!res.ok || !res.body) {
        setError("AI request failed.");
        setIsLoading(false);
        setDiagnostics((current) => ({
          ...current,
          error: "AI request failed.",
          stageLabel: null,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          const lines = rawEvent.split("\n");
          let eventName = "message";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trim());
            }
          }

          if (dataLines.length === 0) continue;

          const rawData = dataLines.join("\n");
          let data: unknown;

          try {
            data = JSON.parse(rawData);
          } catch {
            continue;
          }

          if (eventName === "stage") {
            const payload = data as { label?: string };
            if (payload.label) {
              setStageLabel(payload.label);
              setDiagnostics((current) => ({
                ...current,
                stageLabel: payload.label ?? current.stageLabel,
              }));
            }
          } else if (eventName === "plan") {
            const nextPlan = data as AiPlan;
            setPlan(nextPlan);
            setDiagnostics((current) => ({
              ...current,
              plan: nextPlan,
            }));
          } else if (eventName === "authorities") {
            const payload = data as { authorities?: AiAuthority[] };
            const nextAuthorities =
              (payload.authorities ?? []).map((authority) => ({
                ...authority,
                canonicalHref: buildCanonicalCitationHref(
                  authority.citationLabel,
                  authority.documentCorpus,
                  authority.sectionKey,
                ),
              })) ?? [];

            setAuthorities(nextAuthorities);
            setDiagnostics((current) => ({
              ...current,
              authorities: nextAuthorities,
            }));
          } else if (eventName === "diagnostics") {
            const payload = data as AiDiagnosticsPayload;
            setDiagnostics((current) => ({
              ...current,
              effectiveCorpus:
                typeof payload.effectiveCorpus === "string" ||
                payload.effectiveCorpus === null
                  ? payload.effectiveCorpus
                  : current.effectiveCorpus,
              inferredConcepts: payload.inferredConcepts ?? current.inferredConcepts,
              expandedQueries: payload.expandedQueries ?? current.expandedQueries,
              retrievals: payload.retrievals ?? current.retrievals,
              finalAuthoritySelection:
                payload.finalAuthoritySelection ??
                current.finalAuthoritySelection,
            }));
          } else if (eventName === "answer_delta") {
            const payload = data as { text?: string };
            if (payload.text) {
              setAnswerText((current) => current + payload.text);
              setDiagnostics((current) => ({
                ...current,
                answerText: current.answerText + payload.text,
              }));
            }
          } else if (eventName === "done") {
            const payload = data as {
              answerText?: string;
              authorities?: AiAuthority[];
              corpus?: string | null;
              latencyMs?: number;
            };

            const finalAuthorities =
              (payload.authorities ?? authorities).map((authority) => ({
                ...authority,
                canonicalHref: buildCanonicalCitationHref(
                  authority.citationLabel,
                  authority.documentCorpus,
                  authority.sectionKey,
                ),
              })) ?? [];

            if (typeof payload.answerText === "string") {
              setAnswerText(payload.answerText);
            }

            setAuthorities(finalAuthorities);
            setStageLabel("Complete");
            setIsLoading(false);

            setDiagnostics((current) => ({
              ...current,
              effectiveCorpus:
                typeof payload.corpus === "string" || payload.corpus === null
                  ? payload.corpus
                  : current.effectiveCorpus,
              latencyMs:
                typeof payload.latencyMs === "number"
                  ? payload.latencyMs
                  : current.latencyMs,
              authorities: finalAuthorities,
              answerText:
                typeof payload.answerText === "string"
                  ? payload.answerText
                  : current.answerText,
              stageLabel: "Complete",
            }));
          } else if (eventName === "error") {
            const payload = data as { message?: string };
            const message = payload.message ?? "AI request failed.";
            setError(message);
            setStageLabel(null);
            setIsLoading(false);
            setDiagnostics((current) => ({
              ...current,
              error: message,
              stageLabel: null,
            }));
          }
        }
      }
    } catch {
      setError("AI request failed.");
      setStageLabel(null);
      setIsLoading(false);
      setDiagnostics((current) => ({
        ...current,
        error: "AI request failed.",
        stageLabel: null,
      }));
    }
  }

  const debugSnapshot = useMemo(
    () => formatAiDebugSnapshot(diagnostics),
    [diagnostics],
  );

  const hasDebugSnapshot = useMemo(() => {
    return Boolean(
      diagnostics.question ||
        diagnostics.plan ||
        diagnostics.answerText ||
        diagnostics.authorities.length > 0 ||
        diagnostics.inferredConcepts.length > 0 ||
        diagnostics.expandedQueries.length > 0 ||
        diagnostics.retrievals.length > 0 ||
        diagnostics.finalAuthoritySelection.length > 0 ||
        diagnostics.error,
    );
  }, [diagnostics]);

  return {
    question,
    setQuestion,
    stageLabel,
    plan,
    authorities,
    answerText,
    error,
    isLoading,
    diagnostics,
    copiedToken,
    setCopiedToken,
    debugSnapshot,
    hasDebugSnapshot,
    ask,
  };
}