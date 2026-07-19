import { AuthForm } from "@/app/components/AuthForm";
import { authStatus } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const requestHeaders = await headers();
  const status = await authStatus(requestHeaders.get("cookie"));
  if (!status.setupRequired) redirect(status.authenticated ? "/" : "/login");
  return <AuthForm mode="setup" />;
}
