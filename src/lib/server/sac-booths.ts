import "server-only";
import { getBoothSummary } from "./dal";
import { boothsCol, membersCol } from "./db";
import type { AdminBoothListItem, BoothDetail, BoothStatus } from "@/lib/shared/types";

const STATUS_ORDER: Record<BoothStatus, number> = {
  pending: 0,
  approved: 1,
  deactivated: 2,
};

export async function listBooths(): Promise<AdminBoothListItem[]> {
  const snap = await boothsCol().get();
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        status: data.status,
        submitterEmail: data.submitterEmail,
        joinCode: data.joinCode,
      };
    })
    .sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
    );
}

export async function getBoothDetail(boothId: string): Promise<BoothDetail | null> {
  const booth = (await boothsCol().doc(boothId).get()).data();
  if (!booth) return null;

  const memberSnap = await membersCol(boothId).get();
  const members = memberSnap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: data.uid,
        displayName: data.displayName,
        joinedAt: data.joinedAt.toDate().toISOString(),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const summary = booth.status === "pending" ? null : await getBoothSummary(boothId);

  return {
    id: boothId,
    name: booth.name,
    description: booth.description,
    status: booth.status,
    items: booth.items,
    joinCode: booth.joinCode,
    submitterUid: booth.submitterUid,
    submitterEmail: booth.submitterEmail,
    createdAt: booth.createdAt.toDate().toISOString(),
    approvedAt: booth.approvedAt ? booth.approvedAt.toDate().toISOString() : null,
    members,
    summary,
  };
}
