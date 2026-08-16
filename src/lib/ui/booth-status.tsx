import type { BoothStatus } from "@/lib/shared/types";

export const STATUS_LABEL: Record<BoothStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  deactivated: "Deactivated",
};

export const STATUS_BADGE: Record<BoothStatus, string> = {
  pending: "bg-brand/10 text-brand",
  approved: "bg-success/10 text-success",
  deactivated: "bg-muted/10 text-muted",
};
