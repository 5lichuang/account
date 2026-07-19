"use client";

import { FormEvent, useState } from "react";
import "./auth-form.css";

type AuthFormProps = {
  mode: "setup" | "login";
};

export function AuthForm({ mode }: AuthFormProps) {
  const isSetup = mode === "setup";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSetup && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "操作失败，请稍后重试");
      window.location.replace("/");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "操作失败，请稍后重试",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand" aria-label="Musu 余额监控">
          <span className="auth-brand__mark" aria-hidden="true">M</span>
          <span>
            <strong>Musu</strong>
            <small>余额监控</small>
          </span>
        </div>

        <div className="auth-heading">
          <p>{isSetup ? "FIRST RUN" : "WELCOME BACK"}</p>
          <h1 id="auth-title">{isSetup ? "创建管理员" : "登录看板"}</h1>
          <span>
            {isSetup
              ? "这是唯一一次初始化。创建后将关闭账号注册入口。"
              : "使用管理员账号继续访问余额与上游配置。"}
          </span>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9._-]+"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如：5lichuang"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSetup ? "至少 12 个字符" : "输入管理员密码"}
            />
          </label>
          {isSetup && (
            <label>
              <span>确认密码</span>
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="再次输入密码"
              />
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? "正在处理…" : isSetup ? "创建并进入看板" : "登录"}
          </button>
        </form>

        <p className="auth-footnote">
          登录只保护访问权限；公网使用仍必须配置 HTTPS。
        </p>
      </section>
    </main>
  );
}
