import type { Metadata } from "next";
import { BoothRegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Register a booth",
};

export default function BoothRegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Register a booth</h1>
        <p className="text-sm text-foreground">
          Submit your booth and item prices. SAC reviews every registration before it can sell.
        </p>
      </div>
      <BoothRegisterForm />
    </div>
  );
}
