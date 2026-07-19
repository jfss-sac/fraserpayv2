import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return <h1 className="text-2xl font-bold text-foreground">Admin</h1>;
}
