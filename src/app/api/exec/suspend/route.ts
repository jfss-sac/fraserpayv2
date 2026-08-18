import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { usersCol } from "@/lib/server/db";
import { ConflictError, NotFoundError } from "@/lib/server/errors";
import { hasOtherActiveExec } from "@/lib/server/exec-lockout";
import { defineHandler } from "@/lib/server/http";
import { firestoreDocumentIdSchema } from "@/lib/shared/document-id";

const suspendSchema = z
  .object({ studentUid: firestoreDocumentIdSchema, suspended: z.boolean() })
  .strict();

export const POST = defineHandler(
  { role: "sacExec", schema: suspendSchema, rateLimit: "exec-mutations" },
  async ({ input, authorization }) => {
    const userRef = usersCol().doc(input.studentUid);

    return runAuthorizedTransaction(authorization, async (t, actor) => {
      const user = (await t.get(userRef)).data();
      if (!user) throw new NotFoundError("Student not found.");
      if (user.suspended === input.suspended) {
        throw new ConflictError(
          input.suspended ? "Account is already suspended." : "Account is not suspended.",
        );
      }

      if (
        input.suspended &&
        user.roles.sacExec &&
        !(await hasOtherActiveExec(t, input.studentUid))
      ) {
        throw new ConflictError("Can't suspend the last SAC exec — grant another exec first.");
      }

      t.update(userRef, { suspended: input.suspended, updatedAt: Timestamp.now() });

      writeAudit(t, input.suspended ? "user.suspend" : "user.unsuspend", actor, {
        type: "user",
        id: input.studentUid,
        label: user.displayName,
      });

      return { studentUid: input.studentUid, suspended: input.suspended };
    });
  },
);
