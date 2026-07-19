import type { Metadata } from "next";
import { BalanceDashboard } from "./components/BalanceDashboard";

export const metadata: Metadata = {
  title: "余额监控",
  description: "实时查看每个上游，还剩多少额度。",
};

export default function Home() {
  return <BalanceDashboard />;
}
