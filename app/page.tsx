import type { Metadata } from "next";
import { authStatus } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BalanceDashboard } from "./components/BalanceDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "余额监控",
  description: "实时查看每个上游，还剩多少额度。",
};

export default async function Home() {
  const requestHeaders = await headers();
  const status = await authStatus(requestHeaders.get("cookie"));
  if (status.setupRequired) redirect("/setup");
  if (!status.authenticated || !status.user) redirect("/login");
  return <BalanceDashboard username={status.user.username} />;
}
