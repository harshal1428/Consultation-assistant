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
import { NewConsultationDialog } from "./components/NewConsultationDialog";
import { PatientContextPanel } from "./components/PatientContextPanel";
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
import { buildTextPdf } from "./scene/live/logic";
import { formatParameter, formatTarget, formatUnit } from "./lib/format";
import {
  clearConsultationArchive,
  deleteConsultationRecord,
  loadConsultationArchive,
  persistConsultation,
} from "./lib/consultationRepository";
import type { ConsultationStorage } from "./lib/consultationRepository";
import type { ArchivedConsultation } from "./lib/historyStore";
import {
  EMPTY_PATIENT_IDENTITY,
  isPatientIdentityComplete,
  normalizePatientIdentity,
} from "./lib/patient";
import type { PatientIdentity } from "./lib/patient";
import type { ConsultationSession } from "./scene/session/types";
import { useFacePersonalization } from "./hooks/useFacePersonalization";
import { useLiveSimulation } from "./hooks/useLiveSimulation";
import { useServerVoice } from "./hooks/useServerVoice";
import { LiveSimulationPanel } from "./components/LiveSimulationPanel";
import { VOICE_AUTOAPPLY, VOICE_DEV_TOOLS, VOICE_MODE } from "./lib/voiceConfig";
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

type DialogKind = "reset";

function toContextItem(cmd: Command): ContextItem {
  return {
    target: cmd.target,
    parameter: cmd.parameter,
    clinical_parameter: cmd.clinical_parameter ?? null,
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
  const [archiveStorage, setArchiveStorage] = useState<ConsultationStorage>("local");
  /** Patient and surgeon that the current consultation belongs to. */
  const [patientIdentity, setPatientIdentity] =
    useState<PatientIdentity>(EMPTY_PATIENT_IDENTITY);
  const [newConsultationOpen, setNewConsultationOpen] = useState(false);
  /** Incremented whenever the workspace is replaced so child-local drafts reset. */
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [liveAutoApply, setLiveAutoApply] = useState(true);

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
  /** Last snapshot persisted by the automatic archive effect. */
  const autoArchiveSignatureRef = useRef("");

  // Latest-value refs so async continuations and handlers never read stale data.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const historyRef = useRef(history);
  historyRef.current = history;
  const patientIdentityRef = useRef(patientIdentity);
  patientIdentityRef.current = patientIdentity;
  const activeProposalIdRef = useRef(activeProposalId);
  activeProposalIdRef.current = activeProposalId;
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
      const archive = await loadConsultationArchive();
      setArchived(archive.entries);
      setArchiveStorage(archive.storage);
    } catch {
      setArchived([]);
      setArchiveStorage("local");
    }
  }, []);

  useEffect(() => {
    void refreshArchived();
  }, [refreshArchived]);

  /**
   * Build the durable snapshot for one consultation. The summary is generated
   * from the same report path as the downloadable Markdown so the database and
   * the export never disagree. Photographs are intentionally excluded.
   */
  const buildArchiveRecord = useCallback(
    (source: ConsultationSession): ArchivedConsultation => {
      const currentHistory = historyRef.current;
      const currentState = applyAllCommands(currentHistory);
      let summary = "";
      try {
        summary = buildConsultationReport({
          session: source,
          history: currentHistory,
          modelState: currentState,
          finalScenarioId: selectedScenarioId,
          patientId: patientIdentity.patientId,
          patientName: patientIdentity.patientName,
          surgeonName: patientIdentity.surgeonName,
        });
      } catch {
        summary = "";
      }
      return {
        id: source.id,
        label: `Consultation ${new Date(source.startedAt).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })}`,
        savedAt: Date.now(),
        startedAt: source.startedAt,
        endedAt: source.endedAt,
        status: source.status,
        changeCount: currentHistory.length,
        scenarioCount: source.scenarios.length,
        modelState: currentState,
        summary,
        patientId: patientIdentity.patientId.trim(),
        patientName: patientIdentity.patientName.trim(),
        surgeonName: patientIdentity.surgeonName.trim(),
        personalization: personalization.personalization,
        liveEvents,
        transcript: source.transcript,
        proposals: source.proposals,
        events: source.events,
        scenarios: source.scenarios,
      };
    },
    [
      liveEvents,
      patientIdentity,
      personalization.personalization,
      selectedScenarioId,
    ],
  );

  const saveArchive = useCallback(
    async (record: ArchivedConsultation, announce: boolean) => {
      const result = await persistConsultation(record);
      // Update the panel immediately; only an explicit archive re-reads the
      // whole database so automatic saves stay cheap.
      setArchived((prev) =>
        [record, ...prev.filter((entry) => entry.id !== record.id)].sort(
          (a, b) => b.savedAt - a.savedAt,
        ),
      );
      setArchiveStorage(result.storage);
      if (announce) {
        setNotice(
          result.storage === "database"
            ? "Consultation saved to the local SQLite database."
            : "Database unavailable — consultation saved in this browser instead.",
        );
        await refreshArchived();
      }
      return result;
    },
    [refreshArchived],
  );

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
      const parsed = await parseCommandAPI(text, context, source);
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

    // Respect UI toggle for live simulation. Fallback to env var if needed.
    const effectiveAutoApply = modeRef.current === "live" ? liveAutoApply : VOICE_AUTOAPPLY;
    if (source === "live_voice" && !effectiveAutoApply) {
      await parseText(trimmed, "voice");
      return;
    }

    const token = liveTokenRef.current;
    const at = Date.now();
    setIsProcessing(true);
    setApiError("");

    try {
      const context = historyRef.current.slice(-CONTEXT_LIMIT).map(toContextItem);
      const parsed = await parseCommandAPI(
        trimmed,
        context,
        source === "live_voice" ? "voice" : "typed",
      );
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
  }, [parseText]);

  const legacyLive = useLiveSimulation({
    lang: language,
    onUtterance: (text) => void runLiveInstruction(text, "live_voice"),
    onError: () => {
      /* Surfaced through the hook's `error` field. */
    },
  });

  const serverLive = useServerVoice({
    onUtterance: (text) => {
      // The same server capture hook serves both modes. Live uses the commitment
      // path; consultation goes straight to the normal proposal review.
      if (modeRef.current === "live") {
        void runLiveInstruction(text, "live_voice");
      } else {
        void parseText(text, "voice");
      }
    },
    onError: () => {
      /* Surfaced through the hook's `error` field. */
    },
  });

  const live = VOICE_MODE === "legacy" ? legacyLive : serverLive;

  const phase: ConsultationPhase =
    speechError || apiError || (VOICE_MODE === "server" ? serverLive.error : "")
      ? "error"
      : VOICE_MODE === "server" && mode === "consultation"
        ? serverLive.active
          ? "listening"
          : isProcessing
            ? "processing"
            : pendingCommands.length > 0
              ? "review"
              : serverLive.lastFinal
                ? "transcribed"
                : "ready"
        : isListening
          ? "listening"
          : isProcessing
            ? "processing"
            : pendingCommands.length > 0
              ? "review"
              : transcript
                ? "transcribed"
                : "ready";

  // Switching modes (or leaving Live) releases the microphone without ending or
  // deleting the consultation. It also prevents a capture from one mode being
  // routed by the other mode's callback.
  const previousModeRef = useRef(mode);
  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    legacyLive.stop();
    serverLive.stop();
    setTranscript("");
    setIsListening(false);
  }, [mode, legacyLive.stop, serverLive.stop]);

  const handleToggleListening = () => {
    if (!sessionActive) return;

    if (VOICE_MODE === "server") {
      if (serverLive.active) {
        serverLive.stop();
        return;
      }
      setSpeechError("");
      setApiError("");
      serverLive.start();
      return;
    }

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
    if (VOICE_MODE === "server") serverLive.stop();
    if (isListening) {
      speechService.stopListening();
      setIsListening(false);
    }
  };

  const hasWork =
    history.length > 0 ||
    session.scenarios.length > 0 ||
    session.transcript.length > 0 ||
    liveEvents.length > 0;
  const identityComplete = isPatientIdentityComplete(patientIdentity);
  const canArchive = hasWork && identityComplete;

  // Keep the SQLite archive warm while a consultation is being used. Debounced
  // updates make the current session recoverable after a reload without
  // writing on every keystroke or vertex update. A record is only written once
  // the patient and surgeon are known, so no consultation is stored without
  // its owner. Explicit archive / end still write immediately.
  useEffect(() => {
    if (!hasWork || !identityComplete) return;
    const signature = JSON.stringify({
      history,
      scenarios: session.scenarios,
      transcript: session.transcript,
      proposals: session.proposals,
      events: session.events,
      status: session.status,
      liveEvents: liveEvents.length,
      selectedScenarioId,
      personalization: personalization.personalization,
      patientIdentity,
    });
    if (signature === autoArchiveSignatureRef.current) return;
    const timer = window.setTimeout(() => {
      autoArchiveSignatureRef.current = signature;
      void saveArchive(buildArchiveRecord(sessionRef.current), false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    buildArchiveRecord,
    hasWork,
    history,
    identityComplete,
    liveEvents.length,
    patientIdentity,
    personalization.personalization,
    saveArchive,
    selectedScenarioId,
    session.events,
    session.proposals,
    session.scenarios,
    session.status,
    session.transcript,
  ]);

  /**
   * Clear every piece of state that belongs to one consultation. Used when a
   * new consultation is created or a stored one is opened, so patient A's
   * photos, personalization, proposals, live log and pending speech can never
   * leak into patient B's session.
   */
  const resetWorkspaceState = () => {
    stopListeningIfActive();
    live.stop();
    live.clearError();
    reqRef.current += 1; // Invalidate any in-flight parse.
    liveTokenRef.current += 1; // Invalidate any in-flight live parse.
    appliedRef.current = new Set();
    seqRef.current = 0;
    skinTextureRequest.current += 1; // Discard a late photo-texture result.

    // Photos and their derived personalization are consultation-scoped.
    photos.clearAllPhotos();
    personalization.remove();

    setSession(createSession());
    setHistory([]);
    setLiveEvents([]);
    setActiveProposalId(null);
    setEditingIndex(null);
    setSelectedScenarioId(null);
    setTranscript("");
    setSpeechError("");
    setApiError("");
    setIsListening(false);
    setIsProcessing(false);
    setShowPhotoManager(false);
    setShowReconstructionPanel(false);
    setReconstructedMorph(null);
    setPersonalizedModel(null);
    setPersonalizedTexture(null);
    setReconstructionPhotoVersion(null);
    setNotice("");
    setDialog(null);
    setNewConsultationOpen(false);
    setWorkspaceEpoch((epoch) => epoch + 1);
    autoArchiveSignatureRef.current = "";
  };

  const doNewConsultation = (identity: PatientIdentity) => {
    // Persist the consultation that is about to be discarded. This is what
    // makes "all consultations" recoverable from the SQLite archive even when
    // the surgeon did not press Archive explicitly.
    const current = sessionRef.current;
    const currentIdentity = patientIdentityRef.current;
    const hasArchivableWork =
      historyRef.current.length > 0 ||
      current.scenarios.length > 0 ||
      current.transcript.length > 0 ||
      liveEvents.length > 0;
    const shouldArchive =
      hasArchivableWork && isPatientIdentityComplete(currentIdentity);
    if (shouldArchive) {
      void saveArchive(buildArchiveRecord(endSession(current)), false);
    }

    resetWorkspaceState();
    setPatientIdentity(normalizePatientIdentity(identity));
    if (hasArchivableWork && !shouldArchive) {
      setNotice(
        "The previous consultation was not archived because its patient name or surgeon was missing.",
      );
    }
  };

  const handleNewConsultation = () => {
    stopListeningIfActive();
    setNewConsultationOpen(true);
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

    const current = sessionRef.current;
    const id = activeProposalIdRef.current;
    const proposal = id ? current.proposals.find((p) => p.id === id) ?? null : null;
    const base =
      proposal && !isTerminalProposal(proposal.status)
        ? resolveProposal(current, proposal.id, "cancelled")
        : current;
    const ended = endSession(base);
    setSession(ended);
    setActiveProposalId(null);
    setEditingIndex(null);

    // Ending a consultation automatically stores it in the archive, provided
    // the record has an owner. If not, the work stays in the workspace so the
    // surgeon can complete the patient details and archive explicitly.
    if (
      historyRef.current.length > 0 ||
      ended.scenarios.length > 0 ||
      ended.transcript.length > 0 ||
      liveEvents.length > 0
    ) {
      if (isPatientIdentityComplete(patientIdentityRef.current)) {
        void saveArchive(buildArchiveRecord(ended), false);
      } else {
        setNotice(
          "Consultation ended but not archived: enter the patient name and surgeon, then use Archive current.",
        );
      }
    }
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
        patientId: patientIdentity.patientId,
        patientName: patientIdentity.patientName,
        surgeonName: patientIdentity.surgeonName,
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

  const handleSaveReportPdf = () => {
    try {
      const report = buildConsultationReport({
        session: sessionRef.current,
        history: historyRef.current,
        modelState,
        finalScenarioId: selectedScenarioId,
        patientId: patientIdentity.patientId,
        patientName: patientIdentity.patientName,
        surgeonName: patientIdentity.surgeonName,
      });
      const pdf = buildTextPdf(
        report.split(/\r?\n/),
        "VoiceSurg 3D - Consultation report",
      );
      const blob = new Blob([pdf], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `VoiceSurg_Consultation_${sessionRef.current.id}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Consultation PDF downloaded.");
    } catch {
      setNotice("Could not generate the consultation PDF.");
    }
  };

  const handleArchiveConsultation = async () => {
    if (!isPatientIdentityComplete(patientIdentityRef.current)) {
      setNotice("Enter the patient name and surgeon before archiving this consultation.");
      return;
    }
    const record = buildArchiveRecord(sessionRef.current);
    const result = await saveArchive(record, true);
    setSession((prev) =>
      appendEvent(prev, {
        type: "consultation_archived",
        label: "Consultation archived",
        detail:
          result.storage === "database"
            ? "Saved to the local SQLite database."
            : "Saved to the browser fallback (database unavailable).",
      }),
    );
  };

  const handleRestoreArchived = (id: string) => {
    const record = archived.find((entry) => entry.id === id);
    if (!record) return;

    // Replace, rather than merge, every consultation-scoped state. This is the
    // data-isolation boundary between one patient and another.
    resetWorkspaceState();
    setPatientIdentity({
      patientId: record.patientId?.trim() ?? "",
      patientName: record.patientName?.trim() ?? "",
      surgeonName: record.surgeonName?.trim() ?? "",
    });
    setHistory(stateToCommands(record.modelState));
    setLiveEvents(record.liveEvents ?? []);
    if (record.personalization) {
      personalization.applyPersonalization(record.personalization);
    }

    const restored: ConsultationSession = {
      // Keep the archive id so continuing a restored consultation updates the
      // existing record instead of creating a duplicate.
      id: record.id,
      startedAt: record.startedAt,
      endedAt: null,
      status: "active",
      transcript: record.transcript ?? [],
      proposals: record.proposals ?? [],
      events: record.events ?? [],
      scenarios: record.scenarios ?? [],
    };
    setSession(
      appendEvent(restored, {
        type: "consultation_restored",
        label: "Consultation restored",
        detail: record.label,
      }),
    );
    setNotice(`Restored ${record.label}.`);
  };

  const handleDeleteArchived = async (id: string) => {
    const storage = await deleteConsultationRecord(id);
    setArchiveStorage(storage);
    await refreshArchived();
  };

  const handleClearArchived = async () => {
    const storage = await clearConsultationArchive();
    setArchiveStorage(storage);
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
        patientName={patientIdentity.patientName}
        patientId={patientIdentity.patientId}
        surgeonName={patientIdentity.surgeonName}
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
              key={`workspace-${workspaceEpoch}`}
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
              onSavePdf={handleSaveReportPdf}
              onReset={handleResetSimulation}
            />
            {mode === "consultation" ? (
              <>
                <SessionTimeline events={session.events} />
                <ScenarioPanel
                  key={`scenarios-${workspaceEpoch}`}
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
                  canArchive={canArchive}
                  storage={archiveStorage}
                  onArchive={handleArchiveConsultation}
                  onRestore={handleRestoreArchived}
                  onDelete={handleDeleteArchived}
                  onClear={handleClearArchived}
                  onRefresh={() => void refreshArchived()}
                />
              </>
            ) : null}
          </div>

          <div className="layout__side">
            <PatientContextPanel identity={patientIdentity} onChange={setPatientIdentity} />
            {mode === "live" && !showConsultationPanel ? (
              <LiveSimulationPanel
                key={`live-${workspaceEpoch}`}
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
                voiceMode={VOICE_MODE}
                serverState={VOICE_MODE === "server" ? serverLive.serverState : undefined}
                pttActive={VOICE_MODE === "server" ? serverLive.pttActive : false}
                muted={VOICE_MODE === "server" ? serverLive.muted : false}
                autoApply={liveAutoApply}
                lastFinal={VOICE_MODE === "server" ? serverLive.lastFinal : null}
                lastDiscard={VOICE_MODE === "server" ? serverLive.lastDiscard : null}
                onPttStart={VOICE_MODE === "server" ? serverLive.pttStart : undefined}
                onPttEnd={VOICE_MODE === "server" ? serverLive.pttEnd : undefined}
                onToggleMute={VOICE_MODE === "server" ? serverLive.toggleMute : undefined}
                devTools={VOICE_DEV_TOOLS}
                autoApplyEnabled={liveAutoApply}
                onToggleAutoApply={() => setLiveAutoApply((v) => !v)}
              />
            ) : null}
            {showConsultationPanel ? (
            <ConsultationPanel
              key={`consultation-${session.id}-${workspaceEpoch}`}
              isListening={VOICE_MODE === "server" ? serverLive.active : isListening}
              speechSupported={
                VOICE_MODE === "server" ? serverLive.supported : speechService.isSupported
              }
              phase={phase}
              isProcessing={isProcessing}
              transcript={VOICE_MODE === "server" ? (serverLive.lastFinal?.text ?? "") : transcript}
              language={language}
              onLanguageChange={setLanguage}
              onToggleListening={handleToggleListening}
              speechError={VOICE_MODE === "server" ? serverLive.error : speechError}
              apiError={apiError}
              onDismissSpeechError={
                VOICE_MODE === "server" ? serverLive.clearError : () => setSpeechError("")
              }
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

      <NewConsultationDialog
        open={newConsultationOpen}
        initialSurgeon={patientIdentity.surgeonName}
        hasCurrentWork={hasWork}
        currentCanBeArchived={canArchive}
        currentPatientName={patientIdentity.patientName}
        onCancel={() => setNewConsultationOpen(false)}
        onConfirm={doNewConsultation}
      />

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
