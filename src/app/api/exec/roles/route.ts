import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { usersCol } from "@/lib/server/db";
import { ConflictError, NotFoundError } from "@/lib/server/errors";
import { hasOtherActiveExec } from "@/lib/server/exec-lockout";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";

const rolesSchema = z
  .object({
    targetUid: z.string().trim().min(1),
    role: z.enum(["sacMember", "sacExec"]),
    grant: z.boolean(),
  })
  .strict();

export const POST = defineHandler(
  { role: "sacExec", schema: rolesSchema, rateLimit: "exec-mutations" },
  async ({ input, session }) => {
    const db = getAdminFirestore();
    const userRef = usersCol().doc(input.targetUid);

    return db.runTransaction(async (t) => {
      const user = (await t.get(userRef)).data();
      if (!user) throw new NotFoundError("User not found.");
      if (user.roles[input.role] === input.grant) {
        throw new ConflictError(
          input.grant ? "They already hold that role." : "They do not hold that role.",
        );
      }

      if (
        input.role === "sacExec" &&
        !input.grant &&
        !(await hasOtherActiveExec(t, input.targetUid))
      ) {
        throw new ConflictError("Can't revoke the last SAC exec — grant another exec first.");
      }

      const roles = { ...user.roles, [input.role]: input.grant };
      t.update(userRef, { roles, updatedAt: Timestamp.now() });

      writeAudit(
        t,
        input.grant ? "user.roleGrant" : "user.roleRevoke",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "user", id: input.targetUid, label: user.displayName },
        { role: input.role },
      );

      return { targetUid: input.targetUid, role: input.role, grant: input.grant, roles };
    });
  },
);
