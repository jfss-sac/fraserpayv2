import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { boothsCol, membersCol } from "@/lib/server/db";
import { NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { boothJoinSchema } from "@/lib/shared/booth";

export const POST = defineHandler(
  { role: "active", schema: boothJoinSchema, rateLimit: "join" },
  async ({ input, session }) => {
    const snap = await boothsCol().where("joinCode", "==", input.code).limit(1).get();
    const boothDoc = snap.docs[0];
    if (!boothDoc || boothDoc.data().status !== "approved") {
      throw new NotFoundError("That join code isn't valid.");
    }

    const memberRef = membersCol(boothDoc.id).doc(session!.uid);
    if (!(await memberRef.get()).exists) {
      await memberRef.set({
        uid: session!.uid,
        displayName: session!.displayName,
        joinedAt: Timestamp.now(),
      });
    }

    return { boothId: boothDoc.id, name: boothDoc.data().name };
  },
);
