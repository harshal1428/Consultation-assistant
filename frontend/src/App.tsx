import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { SimulationWorkspace } from "./components/SimulationWorkspace";
import { ConsultationPanel } from "./components/ConsultationPanel";
import { ConsultationHistoryPanel } from "./components/ConsultationHistoryPanel";
import { ParameterPanel } from "./components/ParameterPanel";
import { ChangeHistory } from "./components/ChangeHistory";
import { SessionTimeline } from "./components/SessionTimeline";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { StatusMessage } from "./components/StatusMessage";
import { speechService } from "./services/speech";
import { parseCommandAPI, checkBackendHealth } from "./services/api";
import type {
  Command,
  ConsultationPhase,
  ContextItem,
  Instruction,
  ParamKey,
  WorkspaceMode,
} from "./scene/transformations/types";
import {
  applyAllCommands,
  createManualCommand,
  isManualFor,
} from "./scene/transformations/logic";
import {
  appendEvent,
  appendProposal,
  applicableInstructions,
  allInstructionsApplicable,
  buildConsultationReport,
  buildProposal,
  buildTranscriptEntry,
  createScenario,
  createSession,
  deleteScenario,
  deriveProposalStatus,
  endSession,
  makeId,
  refreshProposalStatus,
  renameScenario,
  resolveProposal,
  scenarioById,
  stateToCommands,
  updateProposal,
  updateTranscriptEntry,
} from "./scene/session";
import type { InputSource } from "./scene/session";
import { isTerminalProposal } from "./scene/session";
import { descriptorFor } from "./lib/params";
import { formatParameter, formatTarget, formatUnit } from "./lib/format";
import {
  clearArchivedConsultations,
  deleteArchivedConsultation,
  listArchivedConsultations,
  saveArchivedConsultation,
} from "./lib/historyStore";
import type { ArchivedConsultation } from "./lib/historyStore";
import { useFacePersonalization } from "./hooks/useFacePersonalization";
import { useLiveSimulation } from "./hooks/useLiveSimulation";
import { LiveSimulationPanel } from "./components/LiveSimulationPanel";
import { evaluateLiveInstruction, makeLiveEvent } from "./scene/live/logic";
import type { LiveEvent, LiveEventSource } from "./scene/live/types";
import { MultiViewPhotoManager } from "./components/MultiViewPhotoManager";
import { ReconstructionPanel } from "./components/ReconstructionPanel";
import { useMultiViewPhotos } from "./hooks/useMultiViewPhotos";
import type { FaceMorph } from "./scene/geometry/faceMorph";
import type { PersonalizedHeadModel } from "./scene/geometry/personalizedHead";
import { buildPersonalizedHead } from "./scene/geometry/personalizedHeadBuilder";
import { buildPatientSkinTexture } from "./services/patientSkinTexture";
import type {
  ReconstructionPreview,
  ReconstructionResult,
} from "./services/multiViewReconstruction";
import "./App.css";

/** Number of prior applied instructions sent as conversational context. */
const CONTEXT_LIMIT = 4;

type DialogKind = "new" | "reset";

function toContextItem(cmd: Command): ContextItem {
  return {
    target: cmd.target,
    parameter: cmd.parameter,
    operation: cmd.operation,
    value: cmd.value,
    unit: cmd.unit,
  };
}

function makeVoiceCommands(instructions: Instruction[], seq: number): Command[] {
  const now = Date.now();
  return instructions.map((instruction, i) => ({
    ...instruction,
    id: `voice-${now}-${seq}-${i}`,
    source: "voice",
    createdAt: now,
  }));
}

function App() {
  const [session, setSession] = useState(() => createSession());
  const [history, setHistory] = useState<Command[]>([]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [notice, setNotice] = useState("");

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [apiError, setApiError] = useState("");

  const [voiceConfirmation, setVoiceConfirmation] = useState(false);
  const [language, setLanguage] = useState("en-US");
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>("consultation");
  const [archived, setArchived] = useState<ArchivedConsultation[]>([]);

  const personalization = useFacePersonalization();

  // Multi-view photo reconstruction workflow state.
  // A single photo controller is owned here so the manager and the
  // reconstruction panel always work on the very same collection.
  const photos = useMultiViewPhotos();
  const [showPhotoManager, setShowPhotoManager] = useState(false);
  const [showReconstructionPanel, setShowReconstructionPanel] = useState(false);
  const [reconstructedMorph, setReconstructedMorph] = useState<FaceMorph | null>(null);
  /** The reconstructed baseline that is actually rendered by the viewer. */
  const [personalizedModel, setPersonalizedModel] = useState<PersonalizedHeadModel | null>(null);
  /**
   * Photo-derived skin texture for the reconstructed head. Kept alongside the
   * model: the mesh is the geometry, the texture is the patient's own skin
   * detail projected through the fitted camera poses.
   */
  const [personalizedTexture, setPersonalizedTexture] = useState<HTMLCanvasElement | null>(null);
  /** Guards async texture builds against a superseded apply / photo change. */
  const skinTextureRequest = useRef(0);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  /**
   * The photo-collection version the applied reconstruction was built from.
   * When the photos change afterwards the reconstruction is outdated and has
   * to be repeated; the applied model itself is kept so a running consultation
   * is never silently modified.
   */
  const [reconstructionPhotoVersion, setReconstructionPhotoVersion] = useState<number | null>(null);

  const seqRef = useRef(0);
  const reqRef = useRef(0);
  const appliedRef = useRef<Set<string>>(new Set());

  // Latest-value refs so async continuations and handlers never read stale data.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const historyRef = useRef(history);
  historyRef.current = history;
  const activeProposalIdRef = useRef(activeProposalId);
  activeProposalIdRef.current = activeProposalId;

  // Live Simulation (Objective 3/4): append-only change log plus a token used
  // to discard stale async parses once a consultation is reset or replaced.
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const liveTokenRef = useRef(0);

  const modelState = useMemo(() => applyAllCommands(history), [history]);
  const sessionActive = session.status === "active";

  const activeProposal = useMemo(
    () => session.proposals.find((p) => p.id === activeProposalId) ?? null,
    [session, activeProposalId],
  );
  const pendingCommands = activeProposal?.instructions ?? [];

  const currentProposal = useCallback(() => {
    const id = activeProposalIdRef.current;
    return id ? sessionRef.current.proposals.find((p) => p.id === id) ?? null : null;
  }, []);

  const phase: ConsultationPhase =
    speechError || apiError
      ? "error"
      : isListening
        ? "listening"
        : isProcessing
          ? "processing"
          : pendingCommands.length > 0
            ? "review"
            : transcript
              ? "transcribed"
              : "ready";

  // Backend reachability probe for the header status indicator.
  useEffect(() => {
    let active = true;
    const probe = async () => {
      const ok = await checkBackendHealth();
      if (active) setBackendOnline(ok);
    };
    void probe();
    const timer = window.setInterval(probe, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshArchived = useCallback(async () => {
    try {
      setArchived(await listArchivedConsultations());
    } catch {
      setArchived([]);
    }
  }, []);

  useEffect(() => {
    void refreshArchived();
  }, [refreshArchived]);

  const parseText = useCallback(async (text: string, source: InputSource) => {
    const sid = sessionRef.current.id;
    if (sessionRef.current.status !== "active") return;

    const token = ++reqRef.current;
    const entry = buildTranscriptEntry({ source, text });
    const proposal = buildProposal({
      transcriptId: entry.id,
      originalText: text,
      source,
    });

    // A new utterance supersedes any proposal still awaiting review.
    setSession((prev) => {
      const currentId = activeProposalIdRef.current;
      const previous = currentId
        ? prev.proposals.find((p) => p.id === currentId) ?? null
        : null;
      const base =
        previous && !isTerminalProposal(previous.status)
          ? resolveProposal(prev, previous.id, "cancelled")
          : prev;
      return appendProposal(base, entry, proposal);
    });
    setActiveProposalId(proposal.id);
    setEditingIndex(null);
    setIsProcessing(true);
    setApiError("");

    try {
      const context = historyRef.current.slice(-CONTEXT_LIMIT).map(toContextItem);
      const parsed = await parseCommandAPI(text, context);
      if (
        sessionRef.current.id !== sid ||
        reqRef.current !== token ||
        sessionRef.current.status !== "active"
      ) {
        return;
      }
      seqRef.current += 1;
      const instructions = makeVoiceCommands(parsed.instructions, seqRef.current);
      setSession((prev) =>
        updateProposal(prev, proposal.id, {
          instructions,
          status: deriveProposalStatus(instructions),
        }),
      );
      setSession((prev) =>
        updateTranscriptEntry(prev, entry.id, {
          status: "parsed",
          proposalId: proposal.id,
          outcome: "pending",
        }),
      );
    } catch (err) {
      if (sessionRef.current.id !== sid || reqRef.current !== token) return;
      const message = err instanceof Error ? err.message : "Failed to parse command.";
      setApiError(message);
      setSession((prev) =>
        updateProposal(prev, proposal.id, { status: "failed", error: message }),
      );
      setSession((prev) =>
        updateTranscriptEntry(prev, entry.id, {
          status: "error",
          proposalId: proposal.id,
          outcome: "failed",
          error: message,
        }),
      );
    } finally {
      if (sessionRef.current.id === sid && reqRef.current === token) {
        setIsProcessing(false);
      }
    }
  }, []);

  /**
   * Continuous Live Simulation handler (Objectives 3 + 4).
   *
   * Parses one finalized utterance, then decides per instruction whether it may
   * auto-apply. Every instruction — applied or not — is recorded in the live
   * change log with its status, before/after values and rejection reason. A
   * stale response (consultation reset while the parse was in flight) is
   * discarded instead of resurrecting a cleared state.
   */
  const runLiveInstruction = useCallback(async (text: string, source: LiveEventSource) => {
    const trimmed = text.trim();
    if (!trimmed || sessionRef.current.status !== "active") return;

    const token = liveTokenRef.current;
    const at = Date.now();
    setIsProcessing(true);
    setApiError("");

    try {
      const context = historyRef.current.slice(-CONTEXT_LIMIT).map(toContextItem);
      const parsed = await parseCommandAPI(trimmed, context);
      if (liveTokenRef.current !== token || sessionRef.current.status !== "active") return;

      seqRef.current += 1;
      const instructions = makeVoiceCommands(parsed.instructions, seqRef.current);

      let state = applyAllCommands(historyRef.current);
      const accepted: Command[] = [];
      const captured: LiveEvent[] = [];

      for (const instruction of instructions) {
        const evaluation = evaluateLiveInstruction(instruction, state, {
          id: instruction.id,
          at,
        });
        captured.push(
          makeLiveEvent({ instruction, evaluation, utterance: trimmed, source, at }),
        );
        if (evaluation.status === "applied" && evaluation.command) {
          accepted.push(evaluation.command);
          state = applyAllCommands([...historyRef.current, ...accepted]);
        }
      }

      if (accepted.length > 0) setHistory((prev) => [...prev, ...accepted]);
      setLiveEvents((prev) => [...prev, ...captured]);
      setSession((prev) =>
        appendEvent(prev, {
          type: "live_command",
          label: source === "typed" ? "Live typed instruction" : "Live voice instruction",
          detail: `“${trimmed}” — ${accepted.length} of ${instructions.length} applied`,
          commandIds: accepted.map((c) => c.id),
        }),
      );
    } catch (err) {
      if (liveTokenRef.current !== token) return;
      const message = err instanceof Error ? err.message : "Failed to parse command.";
      // Surfaced as a logged live event, not by hijacking the panel with a
      // consultation-level API error.
      setLiveEvents((prev) => [
        ...prev,
        {
          id: makeId("live"),
          at,
          source,
          utterance: trimmed,
          target: null,
          parameter: null,
          paramKey: null,
          requestedValue: null,
          requestedUnit: null,
          normalizedValue: null,
          normalizedUnit: null,
          status: "not_applied",
          before: null,
          after: null,
          reason: message,
          confidence: null,
        },
      ]);
    } finally {
      if (liveTokenRef.current === token) setIsProcessing(false);
    }
  }, []);

  const live = useLiveSimulation({
    lang: language,
    onUtterance: (text) => void runLiveInstruction(text, "live_voice"),
    onError: () => {
      /* Surfaced through `live.error`; kept for callers that want a side effect. */
    },
  });

  // Live voice belongs to Live Simulation mode only. Leaving that mode releases
  // the microphone without ending or deleting the consultation.
  useEffect(() => {
    if (mode !== "live") live.stop();
  }, [mode, live.stop]);

  const handleToggleListening = () => {
    if (!sessionActive) return;
    if (isListening) {
      speechService.stopListening();
      setIsListening(false);
      return;
    }
    setIsListening(true);
    setTranscript("");
    setSpeechError("");
    setApiError("");

    speechService.startListening({
      lang: language,
      onTranscript: (text) => {
        setTranscript(text);
        void parseText(text, "voice");
      },
      onError: (error) => setSpeechError(error),
      onEnd: () => setIsListening(false),
    });
  };

  const handleSubmitText = (text: string) => {
    if (!sessionActive) return;
    setTranscript(text);
    setSpeechError("");
    void parseText(text, "typed");
  };

  const announceCommand = (command: Command) => {
    if (!voiceConfirmation || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const unit = formatUnit(command.unit);
    const utterance = new SpeechSynthesisUtterance(
      `${formatTarget(command.target)} ${command.parameter ?? "parameter"} updated by ${command.value}${unit === "°" ? " degrees" : " millimetres"}.`,
    );
    window.speechSynthesis.speak(utterance);
  };

  const applyAccepted = useCallback((accepted: Command[]) => {
    setHistory((prev) => [...prev, ...accepted]);
    accepted.forEach(announceCommand);
  }, [voiceConfirmation]);

  const handleConfirm = (mode: "all" | "valid") => {
    const proposal = currentProposal();
    if (!proposal) return;
    // Guard against a double submit applying the same change set twice.
    if (appliedRef.current.has(proposal.id)) return;

    const applicable = applicableInstructions(proposal.instructions);
    if (applicable.length === 0) return;

    const appliesAll = allInstructionsApplicable(proposal.instructions);
    if (mode === "all" && !appliesAll) return;

    appliedRef.current.add(proposal.id);
    applyAccepted(applicable);
    setSession((prev) =>
      resolveProposal(prev, proposal.id, "confirmed", {
        appliedCommandCount: applicable.length,
        appliedAll: appliesAll,
      }),
    );
    setActiveProposalId(null);
    setEditingIndex(null);
    setTranscript("");
  };

  const handleRejectAll = () => {
    const proposal = currentProposal();
    if (!proposal) return;
    setSession((prev) => resolveProposal(prev, proposal.id, "rejected"));
    setActiveProposalId(null);
    setEditingIndex(null);
    setTranscript("");
  };

  const handlePatch = (index: number, patch: Partial<Command>) => {
    const id = activeProposalIdRef.current;
    if (!id) return;
    setSession((prev) => {
      const proposal = prev.proposals.find((p) => p.id === id);
      if (!proposal) return prev;
      const instructions = proposal.instructions.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      );
      return refreshProposalStatus(
        updateProposal(prev, id, { instructions }),
        id,
      );
    });
  };

  const handleRemove = (index: number) => {
    const id = activeProposalIdRef.current;
    if (!id) return;
    setSession((prev) => {
      const proposal = prev.proposals.find((p) => p.id === id);
      if (!proposal) return prev;
      const instructions = proposal.instructions.filter((_, i) => i !== index);
      return refreshProposalStatus(
        updateProposal(prev, id, { instructions }),
        id,
      );
    });
    setEditingIndex((prev) => (prev === index ? null : prev));
  };

  const handleUndo = (index: number) => {
    const command = historyRef.current[index];
    if (!command) return;
    setHistory((prev) => prev.filter((_, i) => i !== index));
    setSession((prev) =>
      appendEvent(prev, {
        type: "undo",
        label: "Change undone",
        detail: `${formatTarget(command.target)} · ${formatParameter(command.parameter)}`,
        commandIds: [command.id],
      }),
    );
  };

  const stopListeningIfActive = () => {
    if (isListening) {
      speechService.stopListening();
      setIsListening(false);
    }
  };

  const hasWork =
    history.length > 0 || session.scenarios.length > 0 || session.transcript.length > 0;

  const doNewConsultation = () => {
    stopListeningIfActive();
    live.stop();
    reqRef.current += 1; // Invalidate any in-flight parse.
    liveTokenRef.current += 1; // Invalidate any in-flight live parse.
    appliedRef.current = new Set();
    setSession(createSession());
    setHistory([]);
    setLiveEvents([]);
    setActiveProposalId(null);
    setEditingIndex(null);
    setSelectedScenarioId(null);
    setTranscript("");
    setSpeechError("");
    setApiError("");
    live.clearError();
    setIsProcessing(false); // A superseded parse no longer owns the busy flag.
    setDialog(null);
  };

  const handleNewConsultation = () => {
    if (hasWork) setDialog("new");
    else doNewConsultation();
  };

  const doResetSimulation = () => {
    reqRef.current += 1; // Invalidate any in-flight parse so it cannot resurrect.
    liveTokenRef.current += 1; // Same guard for a live parse in flight.
    setHistory([]);
    setEditingIndex(null);
    setTranscript("");
    setSession((prev) => {
      // A reset invalidates any proposal still awaiting review, exactly like
      // ending the consultation: cancel it so no stale "ready" proposal remains.
      const id = activeProposalIdRef.current;
      const proposal = id ? prev.proposals.find((p) => p.id === id) ?? null : null;
      const base =
        proposal && !isTerminalProposal(proposal.status)
          ? resolveProposal(prev, proposal.id, "cancelled")
          : prev;
      return appendEvent(base, {
        type: "reset",
        label: "Simulation reset",
        detail: "Working state cleared to baseline.",
      });
    });
    setActiveProposalId(null);
    setIsProcessing(false); // A superseded parse no longer owns the busy flag.
    setDialog(null);
  };

  const handleResetSimulation = () => {
    if (history.length > 0) setDialog("reset");
    else doResetSimulation();
  };

  const handleEndConsultation = () => {
    stopListeningIfActive();
    live.stop();
    setSession((prev) => {
      const id = activeProposalIdRef.current;
      const proposal = id ? prev.proposals.find((p) => p.id === id) ?? null : null;
      const base =
        proposal && !isTerminalProposal(proposal.status)
          ? resolveProposal(prev, proposal.id, "cancelled")
          : prev;
      return endSession(base);
    });
    setActiveProposalId(null);
    setEditingIndex(null);
  };

  const handleManualChange = (key: ParamKey, value: number) => {
    const others = historyRef.current.filter((c) => !isManualFor(c, key));
    const base = applyAllCommands(others)[key];
    if (value === base) {
      setHistory(others);
      return;
    }
    const existing = historyRef.current.find((c) => isManualFor(c, key));
    let command: Command;
    if (existing) {
      command = {
        ...createManualCommand(key, value),
        id: existing.id,
        createdAt: existing.createdAt,
      };
      setHistory(historyRef.current.map((c) => (c === existing ? command : c)));
    } else {
      command = createManualCommand(key, value);
      setHistory([...historyRef.current, command]);
    }
    setSession((prev) =>
      appendEvent(prev, {
        type: "manual_edit",
        label: "Manual adjustment",
        detail: `${descriptorFor(key).label} set to ${value > 0 ? "+" : ""}${value}`,
        commandIds: [command.id],
      }),
    );
  };

  const handleParamReset = (key: ParamKey) => handleManualChange(key, 0);

  const handleSaveScenario = (name: string) => {
    const result = createScenario(sessionRef.current, {
      name,
      state: modelState,
      commandIds: historyRef.current.map((c) => c.id),
    });
    setSession(result.session);
    setSelectedScenarioId(result.scenario.id);
    setNotice(`Scenario “${result.scenario.name}” saved.`);
  };

  const handleRenameScenario = (id: string, name: string) => {
    setSession((prev) => renameScenario(prev, id, name));
  };

  const handleDeleteScenario = (id: string) => {
    setSession((prev) => deleteScenario(prev, id));
    setSelectedScenarioId((prev) => (prev === id ? null : prev));
  };

  const handleLoadScenario = (id: string) => {
    const scenario = scenarioById(sessionRef.current, id);
    if (!scenario) return;
    setHistory(stateToCommands(scenario.state));
    setSelectedScenarioId(id);
    setSession((prev) =>
      appendEvent(prev, {
        type: "scenario_loaded",
        label: "Scenario loaded",
        detail: scenario.name,
        scenarioId: id,
      }),
    );
    setNotice(`Loaded scenario “${scenario.name}”.`);
  };

  const handleSaveReport = () => {
    try {
      const markdown = buildConsultationReport({
        session: sessionRef.current,
        history: historyRef.current,
        modelState,
        finalScenarioId: selectedScenarioId,
      });
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `VoiceSurg_Consultation_${sessionRef.current.id}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Consultation summary downloaded.");
    } catch {
      setNotice("Could not generate the consultation summary.");
    }
  };

  const handleArchiveConsultation = async () => {
    const current = sessionRef.current;
    let summary = "";
    try {
      summary = buildConsultationReport({
        session: current,
        history: historyRef.current,
        modelState,
        finalScenarioId: selectedScenarioId,
      });
    } catch {
      summary = "";
    }
    const record: ArchivedConsultation = {
      id: `archive-${Date.now()}`,
      label: `Consultation ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      savedAt: Date.now(),
      startedAt: current.startedAt,
      status: current.status,
      changeCount: historyRef.current.length,
      scenarioCount: current.scenarios.length,
      modelState,
      summary,
      personalization: personalization.personalization,
      liveEvents,
    };
    await saveArchivedConsultation(record);
    await refreshArchived();
    setSession((prev) =>
      appendEvent(prev, {
        type: "consultation_archived",
        label: "Consultation archived",
        detail: "Saved to this browser.",
      }),
    );
    setNotice("Consultation archived on this device.");
  };

  const handleRestoreArchived = (id: string) => {
    const record = archived.find((entry) => entry.id === id);
    if (!record) return;
    setHistory(stateToCommands(record.modelState));
    setLiveEvents(record.liveEvents ?? []);
    if (record.personalization) {
      personalization.applyPersonalization(record.personalization);
    }
    setSelectedScenarioId(null);
    setSession((prev) =>
      appendEvent(prev, {
        type: "consultation_restored",
        label: "Consultation restored",
        detail: record.label,
      }),
    );
    setNotice(`Restored ${record.label}.`);
  };

  const handleDeleteArchived = async (id: string) => {
    await deleteArchivedConsultation(id);
    await refreshArchived();
  };

  const handleClearArchived = async () => {
    await clearArchivedConsultations();
    await refreshArchived();
  };

  // Multi-view photo workflow handlers
  const handleOpenPhotoManager = useCallback(() => {
    setShowPhotoManager(true);
  }, []);

  const handleClosePhotoManager = useCallback(() => {
    setShowPhotoManager(false);
  }, []);

  const handleAcceptPhotos = useCallback(() => {
    setShowPhotoManager(false);
    setShowReconstructionPanel(true);
  }, []);

  const handleBackToPhotos = useCallback(() => {
    setShowReconstructionPanel(false);
    setShowPhotoManager(true);
  }, []);

  const handleApplyReconstruction = useCallback(
    (result: ReconstructionResult, _preview: ReconstructionPreview) => {
      if (!result.success || !result.canonicalModel || !result.canonicalShape) {
        setNotice("The reconstruction could not be applied because no valid 3D shape was produced.");
        return;
      }
      try {
        const model = buildPersonalizedHead(result.canonicalModel, result.canonicalShape);
        setPersonalizedModel(model);
        setPersonalizedTexture(null);
        setReconstructedMorph(result.faceMorph);
        setReconstructionPhotoVersion(photos.version);
        setShowReconstructionPanel(false);
        setNotice("3D face reconstructed and applied to simulation.");

        // Project the photographs onto the reconstructed mesh so the rendered
        // face carries the patient's own skin, eyes, brows and hair. This is
        // asynchronous (images have to be decoded), bounded by the same photo
        // version that produced the geometry, and never blocks the apply.
        const request = skinTextureRequest.current + 1;
        skinTextureRequest.current = request;
        const appliedVersion = photos.version;
        const photoSnapshot = new Map(photos.photos);
        const fit = result.fit;
        if (fit) {
          void (async () => {
            try {
              const texture = await buildPatientSkinTexture({
                photos: photoSnapshot,
                fit,
                model,
              });
              if (skinTextureRequest.current !== request) return;
              if (photosRef.current.version !== appliedVersion) return;
              setPersonalizedTexture(texture.canvas);
              setNotice(
                "3D face reconstructed, and the patient's photographs were projected onto the simulation mesh.",
              );
            } catch (error) {
              if (skinTextureRequest.current !== request) return;
              console.warn("[face] Patient skin texture could not be generated.", error);
              setNotice(
                "3D face reconstructed and applied. The photo skin texture could not be generated, " +
                  "so the reconstructed mesh is shown with the neutral skin material.",
              );
            }
          })();
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The reconstructed shape could not be applied.";
        setNotice(message);
      }
    },
    [photos],
  );

  const handleCancelReconstruction = useCallback(() => {
    setShowReconstructionPanel(false);
    setShowPhotoManager(false);
  }, []);

  /**
   * True when the photo set changed after the last reconstruction was applied.
   * The reconstruction then no longer describes the current photos and has to
   * be repeated before it can be applied again.
   */
  const reconstructionOutdated =
    reconstructionPhotoVersion !== null && reconstructionPhotoVersion !== photos.version;

  const sessionLabel = `Session · ${new Date(session.startedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  // In Live Simulation mode the consultation instruments are hidden, but an
  // in-progress review or an error must stay reachable so nothing is lost.
  const showConsultationPanel =
    mode === "consultation" ||
    pendingCommands.length > 0 ||
    Boolean(speechError || apiError);

  return (
    <div className="app">
      <AppHeader
        sessionLabel={sessionLabel}
        sessionStatus={session.status}
        backendOnline={backendOnline}
        canReset={history.length > 0}
        mode={mode}
        onModeChange={setMode}
        onNewConsultation={handleNewConsultation}
        onEndConsultation={handleEndConsultation}
        onResetSimulation={handleResetSimulation}
      />

      <main className="app__main">
        {notice ? (
          <StatusMessage variant="info" title="Notice" onDismiss={() => setNotice("")}>
            {notice}
          </StatusMessage>
        ) : null}

        <div className={`layout layout--${mode}`}>
          <div className="layout__main">
            <SimulationWorkspace
              modelState={modelState}
              scenarios={session.scenarios}
              personalization={personalization.personalization}
              onOpenPhotoManager={handleOpenPhotoManager}
              reconstructedMorph={reconstructedMorph}
              personalizedModel={personalizedModel}
              skinTexture={personalizedTexture}
              reconstructionOutdated={reconstructionOutdated}
            />
            <ChangeHistory
              history={history}
              onUndo={handleUndo}
              onSaveReport={handleSaveReport}
              onReset={handleResetSimulation}
            />
            {mode === "consultation" ? (
              <>
                <SessionTimeline events={session.events} />
                <ScenarioPanel
                  scenarios={session.scenarios}
                  selectedId={selectedScenarioId}
                  modelState={modelState}
                  disabled={!sessionActive}
                  onSave={handleSaveScenario}
                  onRename={handleRenameScenario}
                  onDelete={handleDeleteScenario}
                  onLoad={handleLoadScenario}
                  onSelect={setSelectedScenarioId}
                />
                <ConsultationHistoryPanel
                  entries={archived}
                  canArchive={hasWork}
                  onArchive={handleArchiveConsultation}
                  onRestore={handleRestoreArchived}
                  onDelete={handleDeleteArchived}
                  onClear={handleClearArchived}
                />
              </>
            ) : null}
          </div>

          <div className="layout__side">
            {mode === "live" && !showConsultationPanel ? (
              <LiveSimulationPanel
                status={live.status}
                supported={live.supported}
                sessionActive={sessionActive}
                interim={live.interim}
                error={live.error}
                events={liveEvents}
                onStart={live.start}
                onStop={live.stop}
                onRetry={live.restart}
                onDismissError={live.clearError}
                onSubmitTyped={(text) => void runLiveInstruction(text, "typed")}
              />
            ) : null}
            {showConsultationPanel ? (
            <ConsultationPanel
              isListening={isListening}
              speechSupported={speechService.isSupported}
              phase={phase}
              isProcessing={isProcessing}
              transcript={transcript}
              language={language}
              onLanguageChange={setLanguage}
              onToggleListening={handleToggleListening}
              speechError={speechError}
              apiError={apiError}
              onDismissSpeechError={() => setSpeechError("")}
              onDismissApiError={() => setApiError("")}
              onSubmitText={handleSubmitText}
              pendingCommands={pendingCommands}
              editingIndex={editingIndex}
              onConfirm={() => handleConfirm("all")}
              onConfirmValid={() => handleConfirm("valid")}
              onRejectAll={handleRejectAll}
              onStartEdit={setEditingIndex}
              onSaveEdit={() => setEditingIndex(null)}
              onPatch={handlePatch}
              onRemove={handleRemove}
              voiceConfirmation={voiceConfirmation}
              onToggleVoiceConfirmation={() => setVoiceConfirmation((v) => !v)}
              sessionActive={sessionActive}
              transcriptEntries={session.transcript}
              proposals={session.proposals}
            />
            ) : null}
            <ParameterPanel
              modelState={modelState}
              onChange={handleManualChange}
              onReset={handleParamReset}
            />
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={dialog === "new"}
        title="Start a new consultation?"
        danger
        confirmLabel="Discard and start new"
        onCancel={() => setDialog(null)}
        onConfirm={doNewConsultation}
      >
        This consultation is held only in memory. Starting a new one discards the
        current transcript, change history and saved scenarios. This cannot be
        undone.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "reset"}
        title="Reset the simulation?"
        danger
        confirmLabel="Reset to baseline"
        onCancel={() => setDialog(null)}
        onConfirm={doResetSimulation}
      >
        This clears all applied changes and returns the model to its baseline. The
        transcript, timeline and saved scenarios are kept.
      </ConfirmDialog>

      {/* Multi-view Photo Manager */}
      <MultiViewPhotoManager
        photos={photos}
        isOpen={showPhotoManager}
        onAcceptPhotos={handleAcceptPhotos}
        onCancel={handleClosePhotoManager}
      />

      {/* Reconstruction Panel */}
      <ReconstructionPanel
        photos={photos}
        isOpen={showReconstructionPanel}
        onApplyReconstruction={handleApplyReconstruction}
        onBackToPhotos={handleBackToPhotos}
        onCancel={handleCancelReconstruction}
      />

      <footer className="app-footer">
        <p>
          Prototype for simulation and educational purposes only. Not intended
          for clinical diagnosis, treatment, or surgical decision-making.
        </p>
      </footer>
    </div>
  );
}

export default App;
