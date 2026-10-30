import { describe, expect, it } from "vitest";
import {
  EMPTY_PATIENT_IDENTITY,
  isPatientIdentityComplete,
  normalizePatientIdentity,
  patientDisplayName,
  patientGroupKey,
} from "../src/lib/patient";

describe("patient identity", () => {
  it("requires a patient name and surgeon before archiving", () => {
    expect(isPatientIdentityComplete(EMPTY_PATIENT_IDENTITY)).toBe(false);
    expect(
      isPatientIdentityComplete({ patientId: "M-1", patientName: "Asha", surgeonName: "" }),
    ).toBe(false);
    expect(
      isPatientIdentityComplete({ patientId: "", patientName: "Asha", surgeonName: "Dr. M" }),
    ).toBe(true);
    expect(
      isPatientIdentityComplete({ patientId: "", patientName: "  ", surgeonName: "Dr. M" }),
    ).toBe(false);
  });

  it("groups by explicit patient id first, then by normalized name", () => {
    expect(patientGroupKey({ patientId: " MRN-1 ", patientName: "Asha" })).toBe("id:mrn-1");
    expect(patientGroupKey({ patientId: "", patientName: " Asha Rao " })).toBe(
      "name:asha rao",
    );
    expect(patientGroupKey({})).toBe("name:unassigned");
  });

  it("normalizes form input and labels legacy records", () => {
    expect(
      normalizePatientIdentity({
        patientId: " MRN-9 ",
        patientName: " Ravi ",
        surgeonName: " Dr. Iyer ",
      }),
    ).toEqual({ patientId: "MRN-9", patientName: "Ravi", surgeonName: "Dr. Iyer" });
    expect(patientDisplayName({ patientName: "  " })).toBe("Unassigned patient");
    expect(patientDisplayName({ patientName: "Asha" })).toBe("Asha");
  });
});
