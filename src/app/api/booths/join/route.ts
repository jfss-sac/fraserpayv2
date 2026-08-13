import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol, membersCol } from "@/lib/server/db";
import { NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { boothJoinSchema } from "@/lib/shared/booth";

export const POST = defineHandler(
  { role: "active", schema: boothJoinSchema, rateLimit: "join" },
  async ({ input, session }) => {
    return runAuthorizedTransaction({ actorUid: session!.uid, role: "active" }, async (t) => {
      const snap = await t.get(boothsCol().where("joinCode", "==", input.code).limit(1));
      const boothDoc = snap.docs[0];
      if (!boothDoc || boothDoc.data().status !== "approved") {
        throw new NotFoundError("That join code isn't valid.");
      }

      const memberRef = membersCol(boothDoc.id).doc(session!.uid);
      if (!(await t.get(memberRef)).exists) {
        t.set(memberRef, {
          uid: session!.uid,
          displayName: session!.displayName,
          joinedAt: Timestamp.now(),
        });
      }

      return { boothId: boothDoc.id, name: boothDoc.data().name };
    });
  },
);
