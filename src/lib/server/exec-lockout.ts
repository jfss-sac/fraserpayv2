import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { usersCol } from "./db";

export async function hasOtherActiveExec(t: Transaction, excludeUid: string): Promise<boolean> {
  const execs = await t.get(usersCol().where("roles.sacExec", "==", true));
  return execs.docs.some((doc) => doc.id !== excludeUid && !doc.data().suspended);
}
