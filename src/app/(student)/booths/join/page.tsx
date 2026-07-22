import type { Metadata } from "next";
import { BoothJoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join a booth",
};

export default function BoothJoinPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Join a booth</h1>
        <p className="text-sm text-foreground">
          Enter the join code your booth shared with you to start selling.
        </p>
      </div>
      <BoothJoinForm />
    </div>
  );
}
