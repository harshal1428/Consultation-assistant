import type {
  ParamKey,
  Parameter,
  TargetRegion,
  Unit,
} from "../scene/transformations/types";
import registryJson from "../../../shared/clinical_parameters.json";

/**
 * Typed view over the one machine-readable clinical registry.
 *
 * The JSON file is shared with the Python backend. It is the source of truth for
 * clinical names, synonyms, parser mappings, reviewability and simulation
 * status. `params.ts` only enriches the geometry-backed subset with UI metadata.
 */

export type ClinicalGroup = "nose" | "lips" | "chin" | "jawline" | "cheeks" | "face";

export type ParserStatus =
  | "supported"
  | "registered"
  | "unsupported"
  | "ambiguous";

export type SimulationStatus = "simulated" | "registered_not_simulated";

export type ValueKind = "length" | "angle" | "ratio" | "categorical";

export interface ClinicalParameter {
  key: string;
  clinicalName: string;
  group: ClinicalGroup;
  anatomicalRegion: string;
  parameterType: Parameter;
  valueKind: ValueKind;
  unit: Unit | null;
  definition: string;
  synonyms: string[];
  operations: string[];
  min: number;
  max: number;
  default: number;
  parser: {
    status: ParserStatus;
    target: TargetRegion;
    parameter: Parameter;
  };
  reviewable: boolean;
  simulation: {
    status: SimulationStatus;
    modelField: ParamKey | null;
    driver: string | null;
  };
  source: string;
  limitations: string;
}

interface RegistryFile {
  schema: number;
  note: string;
  parameters: ClinicalParameter[];
}

const registry = registryJson as unknown as RegistryFile;

export const CLINICAL_REGISTRY_SCHEMA = registry.schema;
export const CLINICAL_PARAMETERS: readonly ClinicalParameter[] =
  registry.parameters;

if (registry.schema !== 1) {
  throw new Error(`Unsupported clinical registry schema: ${registry.schema}`);
}

const byKey = new Map<string, ClinicalParameter>();
for (const parameter of CLINICAL_PARAMETERS) {
  if (byKey.has(parameter.key)) {
    throw new Error(`Duplicate clinical parameter key: ${parameter.key}`);
  }
  byKey.set(parameter.key, parameter);
}

export const CLINICAL_PARAMETER_BY_KEY: ReadonlyMap<string, ClinicalParameter> =
  byKey;

export const SIMULATED_CLINICAL_PARAMETERS = CLINICAL_PARAMETERS.filter(
  (parameter) => parameter.simulation.status === "simulated",
);

export const REGISTERED_NOT_SIMULATED_PARAMETERS = CLINICAL_PARAMETERS.filter(
  (parameter) => parameter.simulation.status !== "simulated",
);

export function clinicalParameterFor(
  key: string | null | undefined,
): ClinicalParameter | null {
  if (!key) return null;
  return CLINICAL_PARAMETER_BY_KEY.get(key) ?? null;
}

export function isSimulatedClinicalParameter(
  key: string | null | undefined,
): boolean {
  return clinicalParameterFor(key)?.simulation.status === "simulated";
}

export function modelFieldForClinicalKey(
  key: string | null | undefined,
): ParamKey | null {
  const parameter = clinicalParameterFor(key);
  if (!parameter || parameter.simulation.status !== "simulated") return null;
  return parameter.simulation.modelField;
}

/**
 * Resolve a coarse target/parameter pair only when exactly one registered
 * clinical concept claims it. Legacy LLM responses do not carry a clinical key;
 * an ambiguous pair must ask for review instead of silently aliasing a similar
 * concept such as alar width / alar flare.
 */
export function uniqueClinicalParameterForPair(
  target: TargetRegion | null | undefined,
  parameter: Parameter | string | null | undefined,
): ClinicalParameter | null {
  if (!target || !parameter) return null;
  const matches = CLINICAL_PARAMETERS.filter(
    (candidate) =>
      candidate.parser.target === target &&
      candidate.parser.parameter === parameter,
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Human label for the four states used in the report and review UI. */
export function simulationStatusLabel(status: SimulationStatus): string {
  return status === "simulated" ? "Geometry simulated" : "Registered only";
}
