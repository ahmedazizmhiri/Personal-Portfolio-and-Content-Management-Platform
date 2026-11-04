import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateContentState } from "@/lib/firebase/mutations";

const snapshotPath = process.env.MIGRATION_VALIDATION_SNAPSHOT;
describe.skipIf(!snapshotPath)("private source snapshot preflight", () => {
  it("satisfies the Firestore publication and relationship invariants", () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath!, "utf8"));
    expect(() => validateContentState(snapshot.tables)).not.toThrow();
  });
});
