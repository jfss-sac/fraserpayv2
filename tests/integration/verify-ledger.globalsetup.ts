import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { formatReport, verifyLedger } from "../../scripts/verify-ledger";

export function setup(): void {}

export async function teardown(): Promise<void> {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-fraserpay";
  const app = getApps()[0] ?? initializeApp({ projectId });
  const report = await verifyLedger(getFirestore(app));
  if (!report.ok) {
    throw new Error(`Integration suite left the ledger inconsistent.\n${formatReport(report)}`);
  }
}
