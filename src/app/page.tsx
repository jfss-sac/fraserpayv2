import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/dal";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect("/wallet");
}
