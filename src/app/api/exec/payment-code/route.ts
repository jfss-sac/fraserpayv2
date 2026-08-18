import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { usersCol } from "@/lib/server/db";
import { InternalError, NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { generatePaymentCode } from "@/lib/server/paymentCode";
import { firestoreDocumentIdSchema } from "@/lib/shared/document-id";

const MAX_CODE_ATTEMPTS = 10;

const regenSchema = z.object({ studentUid: firestoreDocumentIdSchema }).strict();

export const POST = defineHandler(
  { role: "sacExec", schema: regenSchema, rateLimit: "exec-mutations" },
  async ({ input, authorization }) => {
    const userRef = usersCol().doc(input.studentUid);

    return runAuthorizedTransaction(authorization, async (t, actor) => {
      const user = (await t.get(userRef)).data();
      if (!user) throw new NotFoundError("Student not found.");

      let paymentCode: string | null = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const candidate = generatePaymentCode();
        const clash = await t.get(usersCol().where("paymentCode", "==", candidate).limit(1));
        if (clash.empty) {
          paymentCode = candidate;
          break;
        }
      }
      if (!paymentCode) throw new InternalError();

      t.update(userRef, { paymentCode, updatedAt: Timestamp.now() });

      writeAudit(t, "user.paymentCodeRegen", actor, {
        type: "user",
        id: input.studentUid,
        label: user.displayName,
      });

      return { studentUid: input.studentUid };
    });
  },
);
