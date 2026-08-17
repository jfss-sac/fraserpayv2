import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { getFeed } from "@/lib/server/sac-feed";
import { getCachedAdminKpis } from "@/lib/server/sac-reports";
import { AdminKpiStrip } from "./admin-kpi-strip";
import { FeedView } from "./feed-view";

export const metadata: Metadata = {
  title: "Feed",
};

export default async function FeedPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const [feed, kpis] = await Promise.all([getFeed({}), getCachedAdminKpis().catch(() => null)]);

  return (
    <>
      {kpis ? <AdminKpiStrip data={kpis} /> : null}
      <FeedView
        initialEntries={feed.entries}
        initialCursor={feed.nextCursor}
        initialRepeatBuyers={feed.repeatBuyers}
        initialRepeatBuyersTruncated={feed.repeatBuyersTruncated}
      />
    </>
  );
}
