"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DashboardPayload, PublicUpstream } from "@/lib/upstreams";
import "./balance-dashboard.css";

type UpstreamResponse = DashboardPayload;

type FormValues = {
  provider: PublicUpstream["provider"];
  name: string;
  baseUrl: string;
  balancePath: string;
  apiKey: string;
  accessKeyId: string;
  accessKeySecret: string;
  sessionCookie: string;
  accessToken: string;
  userHeaderName: string;
  userHeaderValue: string;
  quotaDivisor: string;
  balanceCurrency: string;
  lowBalanceThreshold: string;
  active: boolean;
};

const DEFAULT_FORM: FormValues = {
  provider: "generic_bearer",
  name: "",
  baseUrl: "",
  balancePath: "/api/usage/balance/",
  apiKey: "",
  accessKeyId: "",
  accessKeySecret: "",
  sessionCookie: "",
  accessToken: "",
  userHeaderName: "New-Api-User",
  userHeaderValue: "",
  quotaDivisor: "500000",
  balanceCurrency: "CNY",
  lowBalanceThreshold: "10",
  active: true,
};

type AppearanceMode = "dark" | "light";
type AppearanceTheme = "glass" | "mint" | "ocean" | "violet" | "amber" | "slate";

const THEME_OPTIONS: { id: AppearanceTheme; label: string }[] = [
  { id: "glass", label: "Glass 薄荷青" },
  { id: "mint", label: "Mint 经典绿" },
  { id: "ocean", label: "Ocean 海洋蓝" },
  { id: "violet", label: "Violet 紫雾" },
  { id: "amber", label: "Amber 暖琥珀" },
  { id: "slate", label: "Slate 石墨灰" },
];

const MODE_KEY = "bd-appearance-mode";
const THEME_KEY = "bd-appearance-theme";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeFlyAnchor(cardRect: DOMRect, popW: number, popH: number) {
  const margin = 16;
  const cardCx = cardRect.left + cardRect.width / 2;
  const cardCy = cardRect.top + cardRect.height / 2;
  let anchorX = cardCx;
  let anchorY = cardCy - Math.min(40, popH * 0.08);
  const halfW = popW / 2;
  const halfH = popH / 2;
  anchorX = clamp(anchorX, margin + halfW, window.innerWidth - margin - halfW);
  anchorY = clamp(anchorY, margin + halfH, window.innerHeight - margin - halfH);
  return {
    x: anchorX,
    y: anchorY,
    dx: cardCx - anchorX,
    dy: cardCy - anchorY,
  };
}

const NUMBER_FORMAT = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

const INTEGER_FORMAT = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || "USD"} ${NUMBER_FORMAT.format(value)}`;
  }
}

function dateTime(value?: string | number | null, empty = "暂无") {
  if (!value || value === "0") return empty;
  const numericValue = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function longDate(value?: string | number | null, empty = "未设置") {
  if (!value || value === "0") return empty;
  const numericValue = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function relativeTime(value?: string | null) {
  if (!value) return "尚未同步";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "尚未同步";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "刚刚同步";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function statusOf(account: PublicUpstream) {
  if (!account.active) return "disabled";
  if (account.sync.error || account.sync.status === "error") return "error";
  if (!account.usage || account.sync.status === "idle") return "pending";
  if (
    account.usage.balance_amount !== null &&
    account.usage.balance_amount <= account.lowBalanceThreshold
  ) {
    return "warning";
  }
  return "healthy";
}

function statusLabel(status: ReturnType<typeof statusOf>) {
  if (status === "healthy") return "运行正常";
  if (status === "warning") return "余额预警";
  if (status === "error") return "同步异常";
  if (status === "disabled") return "已停用";
  return "等待同步";
}

function providerLabel(provider: PublicUpstream["provider"]) {
  if (provider === "aliyun_bss") return "阿里云 BSS";
  if (provider === "cookie_session") return "网页登录会话（Cookie）";
  if (provider === "web_bearer") return "网页访问令牌（Bearer）";
  return "兼容 API";
}

function connectionLabel(account: PublicUpstream) {
  if (account.provider === "aliyun_bss") {
    return `阿里云 BSS · ${account.baseUrl} · QueryAccountBalance`;
  }
  if (account.provider === "cookie_session") {
    return `网页登录会话 · ${account.baseUrl}${account.balancePath}`;
  }
  if (account.provider === "web_bearer") {
    return `网页访问令牌 · ${account.baseUrl}${account.balancePath}`;
  }
  return `兼容 API · ${account.baseUrl}${account.balancePath}`;
}

async function readResponse(response: Response): Promise<UpstreamResponse> {
  const payload = (await response.json().catch(() => null)) as
    | UpstreamResponse
    | { error?: string }
    | null;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error : undefined;
    throw new Error(message || `请求失败（${response.status}）`);
  }
  if (!payload || !("accounts" in payload) || !Array.isArray(payload.accounts)) {
    throw new Error("服务返回了无法识别的数据");
  }
  return payload;
}

function remainingProgress(account: PublicUpstream): {
  percent: number;
  leftLabel: string;
  rightLabel: string;
} | null {
  const subscriptions = account.usage?.subscriptions ?? [];
  if (!subscriptions.length) return null;
  const subscription = subscriptions[0];
  if (subscription.amount_total === 0) {
    return { percent: 100, leftLabel: "不限额度", rightLabel: "—" };
  }
  if (
    subscription.amount_total === null ||
    subscription.amount_total <= 0 ||
    subscription.amount_remain === null
  ) {
    return null;
  }
  const percent = Math.min(
    100,
    Math.max(0, (subscription.amount_remain / subscription.amount_total) * 100),
  );
  return {
    percent,
    leftLabel: `剩余 ${Math.round(percent)}%`,
    rightLabel: `${NUMBER_FORMAT.format(subscription.amount_remain)} 点`,
  };
}

export function BalanceDashboard() {
  const [accounts, setAccounts] = useState<PublicUpstream[]>([]);
  const [selectedId, setSelectedId] = useState("all");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [editingAccount, setEditingAccount] = useState<PublicUpstream | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "healthy" | "warning" | "error" | "disabled" | "pending"
  >("all");
  const [mode, setMode] = useState<AppearanceMode>(() =>
    typeof window === "undefined"
      ? "dark"
      : readPref(MODE_KEY, ["dark", "light"] as const, "dark"),
  );
  const [theme, setTheme] = useState<AppearanceTheme>(() =>
    typeof window === "undefined"
      ? "glass"
      : readPref(
          THEME_KEY,
          ["glass", "mint", "ocean", "violet", "amber", "slate"] as const,
          "glass",
        ),
  );
  const [flyOpen, setFlyOpen] = useState(false);
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const flyPopRef = useRef<HTMLElement>(null);
  const sourceElRef = useRef<HTMLElement | null>(null);
  const lastDeltaRef = useRef({ dx: 0, dy: 0 });
  const closingRef = useRef(false);
  const glowRef = useRef<HTMLDivElement>(null);

  const applyPayload = useCallback((payload: UpstreamResponse) => {
    setAccounts(payload.accounts);
    setGeneratedAt(payload.generatedAt);
    if (payload.refreshIntervalSeconds > 0) {
      setRefreshInterval(payload.refreshIntervalSeconds);
    }
    setSelectedId((current) =>
      current === "all" || payload.accounts.some((item) => item.id === current)
        ? current
        : "all",
    );
  }, []);

  const loadAccounts = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!options.quiet) setIsLoading(true);
      try {
        const response = await fetch("/api/upstreams", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        applyPayload(await readResponse(response));
        setLoadError(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "加载上游账号失败");
      } finally {
        if (!options.quiet) setIsLoading(false);
      }
    },
    [applyPayload],
  );

  const refreshAccounts = useCallback(
    async (id?: string, quiet = false) => {
      if (id) setBusyId(id);
      else if (!quiet) setIsRefreshing(true);
      try {
        const response = await fetch("/api/upstreams/refresh", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(id ? { id } : {}),
        });
        applyPayload(await readResponse(response));
        setLoadError(null);
        if (!quiet) {
          setActionMessage(id ? "账号数据已刷新" : "全部上游已刷新");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "刷新失败";
        setLoadError(message);
      } finally {
        setBusyId(null);
        setIsRefreshing(false);
      }
    },
    [applyPayload],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [mode, theme]);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const glow = glowRef.current;
    if (!glow) return;

    const onMove = (event: PointerEvent) => {
      if (!fine.matches) {
        glow.classList.remove("is-on");
        return;
      }
      glow.classList.add("is-on");
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    };
    const onLeave = () => glow.classList.remove("is-on");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  // Soft scrollbar: show only while scrolling, hide when idle (no brightening)
  useEffect(() => {
    const nodes = [flyPopRef.current, ...Array.from(document.querySelectorAll(".bd-modal"))].filter(
      (node): node is HTMLElement => Boolean(node),
    );
    const cleanups: Array<() => void> = [];

    for (const el of nodes) {
      let idleTimer = 0;
      const onScroll = () => {
        el.classList.add("is-scrolling");
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          el.classList.remove("is-scrolling");
        }, 900);
      };
      el.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => {
        el.removeEventListener("scroll", onScroll);
        window.clearTimeout(idleTimer);
        el.classList.remove("is-scrolling");
      });
    }

    return () => {
      for (const dispose of cleanups) dispose();
    };
  }, [formMode, selectedId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAccounts(undefined, true);
      }
    }, Math.max(15, refreshInterval) * 1000);
    return () => window.clearInterval(interval);
  }, [refreshAccounts, refreshInterval]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!formMode) return;
    firstInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) setFormMode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formMode, isSaving]);

  const selectedAccount =
    selectedId === "all"
      ? null
      : accounts.find((account) => account.id === selectedId) || null;

  const closeFlyDetail = useCallback((immediate = false) => {
    const pop = flyPopRef.current;
    if (!pop || selectedId === "all") {
      setSelectedId("all");
      setFlyOpen(false);
      setSourceCardId(null);
      sourceElRef.current = null;
      return;
    }

    const finish = () => {
      setSelectedId("all");
      setFlyOpen(false);
      setSourceCardId(null);
      if (sourceElRef.current) {
        sourceElRef.current.classList.remove("is-source");
        sourceElRef.current = null;
      }
      pop.classList.remove("is-open", "is-closing");
      pop.style.visibility = "hidden";
      pop.style.opacity = "";
      pop.style.transition = "";
      pop.style.setProperty("--pop-dx", "0px");
      pop.style.setProperty("--pop-dy", "0px");
      pop.style.setProperty("--pop-scale", "1");
      closingRef.current = false;
    };

    if (immediate || closingRef.current) {
      finish();
      return;
    }

    closingRef.current = true;
    pop.classList.add("is-closing");
    pop.classList.remove("is-open");
    pop.style.setProperty("--pop-dx", `${lastDeltaRef.current.dx}px`);
    pop.style.setProperty("--pop-dy", `${lastDeltaRef.current.dy}px`);
    pop.style.setProperty("--pop-scale", "0.88");
    pop.style.opacity = "0";
    setFlyOpen(false);

    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "transform" && event.propertyName !== "opacity") return;
      pop.removeEventListener("transitionend", onEnd);
      finish();
    };
    pop.addEventListener("transitionend", onEnd);
    window.setTimeout(() => {
      if (closingRef.current) {
        pop.removeEventListener("transitionend", onEnd);
        finish();
      }
    }, 560);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === "all" || !selectedAccount) return;
    const pop = flyPopRef.current;
    const source = sourceElRef.current;
    if (!pop || !source) return;

    const cardRect = source.getBoundingClientRect();
    pop.classList.remove("is-open", "is-closing");
    pop.style.transition = "none";
    pop.style.visibility = "hidden";
    pop.style.opacity = "0";
    pop.style.left = "50%";
    pop.style.top = "50%";
    pop.style.setProperty("--pop-dx", "0px");
    pop.style.setProperty("--pop-dy", "0px");
    pop.style.setProperty("--pop-scale", "1");
    void pop.offsetWidth;

    const popW = pop.offsetWidth || Math.min(400, window.innerWidth - 32);
    const popH = Math.min(pop.scrollHeight || 360, window.innerHeight * 0.72, 560);
    const anchor = computeFlyAnchor(cardRect, popW, popH);
    lastDeltaRef.current = { dx: anchor.dx, dy: anchor.dy };

    pop.style.left = `${anchor.x}px`;
    pop.style.top = `${anchor.y}px`;
    pop.style.setProperty("--pop-dx", `${anchor.dx}px`);
    pop.style.setProperty("--pop-dy", `${anchor.dy}px`);
    pop.style.setProperty("--pop-scale", "0.86");
    pop.style.opacity = "0";
    pop.style.visibility = "visible";
    void pop.offsetWidth;

    const frame = window.requestAnimationFrame(() => {
      pop.style.transition = "";
      pop.classList.add("is-open");
      pop.style.opacity = "";
      pop.style.setProperty("--pop-dx", "0px");
      pop.style.setProperty("--pop-dy", "0px");
      pop.style.setProperty("--pop-scale", "1");
      setFlyOpen(true);
    });

    return () => window.cancelAnimationFrame(frame);
    // Only re-fly when the selected account id changes, not on data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === "all") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !formMode) closeFlyDetail(false);
    };
    const onResize = () => closeFlyDetail(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [selectedId, formMode, closeFlyDetail]);

  function openAccountFromCard(id: string, el: HTMLElement) {
    if (sourceElRef.current) sourceElRef.current.classList.remove("is-source");
    sourceElRef.current = el;
    el.classList.add("is-source");
    setSourceCardId(id);
    setSelectedId(id);
    closingRef.current = false;
  }

  const summary = useMemo(() => {
    const balances = new Map<string, number>();
    const used = new Map<string, number>();
    let requests = 0;
    let healthy = 0;
    let warning = 0;
    let errors = 0;
    let requestSources = 0;

    for (const account of accounts) {
      const status = statusOf(account);
      if (status === "healthy") healthy += 1;
      if (status === "warning") warning += 1;
      if (status === "error") errors += 1;
      if (!account.usage) continue;
      const currency = account.usage.currency || "USD";
      if (account.usage.balance_amount !== null) {
        balances.set(currency, (balances.get(currency) || 0) + account.usage.balance_amount);
      }
      if (account.usage.used_amount !== null) {
        used.set(currency, (used.get(currency) || 0) + account.usage.used_amount);
      }
      if (account.usage.request_count !== null) {
        requests += numberValue(account.usage.request_count);
        requestSources += 1;
      }
    }
    return {
      balances: Array.from(balances.entries()),
      used: Array.from(used.entries()),
      requests,
      healthy,
      warning,
      errors,
      requestSources,
    };
  }, [accounts]);

  function openAdd() {
    setEditingAccount(null);
    setFormValues(DEFAULT_FORM);
    setFormError(null);
    setFormMode("add");
  }

  function openEdit(account: PublicUpstream) {
    setEditingAccount(account);
    setFormValues({
      provider: account.provider,
      name: account.name,
      baseUrl: account.baseUrl,
      balancePath: account.balancePath,
      apiKey: "",
      accessKeyId: "",
      accessKeySecret: "",
      sessionCookie: "",
      accessToken: "",
      userHeaderName: account.userHeaderName || "New-Api-User",
      userHeaderValue: "",
      quotaDivisor: String(account.quotaDivisor || 500000),
      balanceCurrency: account.balanceCurrency || "CNY",
      lowBalanceThreshold: String(account.lowBalanceThreshold),
      active: account.active,
    });
    setFormError(null);
    setFormMode("edit");
  }

  function updateField(field: keyof FormValues, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function updateProvider(provider: PublicUpstream["provider"]) {
    const isAliyun = provider === "aliyun_bss";
    const isWebBearer = provider === "web_bearer";
    setFormValues((current) => ({
      ...current,
      provider,
      baseUrl: isAliyun ? "https://business.aliyuncs.com" : "",
      balancePath: isAliyun ? "/" : isWebBearer ? "/user/self" : "/api/usage/balance",
      apiKey: "",
      accessKeyId: "",
      accessKeySecret: "",
      sessionCookie: "",
      accessToken: "",
      userHeaderName: "New-Api-User",
      userHeaderValue: "",
      quotaDivisor: "500000",
      balanceCurrency: "CNY",
    }));
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const threshold = Number(formValues.lowBalanceThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      setFormError("余额预警值必须是大于或等于 0 的数字");
      return;
    }
    const quotaDivisor = Number(formValues.quotaDivisor);
    if (
      formValues.provider === "web_bearer" &&
      (!Number.isFinite(quotaDivisor) || quotaDivisor <= 0)
    ) {
      setFormError("点数换算除数必须是大于 0 的数字");
      return;
    }
    if (
      formValues.provider === "generic_bearer" &&
      formMode === "add" &&
      !formValues.apiKey.trim()
    ) {
      setFormError("新增账号时必须填写 API Key");
      return;
    }
    if (
      formValues.provider === "aliyun_bss" &&
      formMode === "add" &&
      (!formValues.accessKeyId.trim() || !formValues.accessKeySecret.trim())
    ) {
      setFormError("新增阿里云账号时必须填写 AccessKey ID 和 AccessKey Secret");
      return;
    }
    if (
      formValues.provider === "aliyun_bss" &&
      Boolean(formValues.accessKeyId.trim()) !== Boolean(formValues.accessKeySecret.trim())
    ) {
      setFormError("更新阿里云凭证时，AccessKey ID 和 AccessKey Secret 必须同时填写");
      return;
    }
    if (
      formValues.provider === "cookie_session" &&
      formMode === "add" &&
      !formValues.sessionCookie.trim()
    ) {
      setFormError("新增网页登录会话账号时必须填写 Cookie");
      return;
    }
    if (
      formValues.provider === "cookie_session" &&
      formMode === "edit" &&
      editingAccount &&
      (formValues.baseUrl.trim().replace(/\/$/, "") !== editingAccount.baseUrl ||
        formValues.balancePath.trim() !== editingAccount.balancePath) &&
      !formValues.sessionCookie.trim()
    ) {
      setFormError("修改服务地址或余额接口路径时，必须重新输入 Cookie");
      return;
    }
    if (
      formValues.provider === "web_bearer" &&
      (!formValues.userHeaderName.trim() || !formValues.balanceCurrency.trim())
    ) {
      setFormError("请填写用户标识请求头名称和币种");
      return;
    }
    if (
      formValues.provider === "web_bearer" &&
      formMode === "add" &&
      (!formValues.accessToken.trim() || !formValues.userHeaderValue.trim())
    ) {
      setFormError("新增网页访问令牌账号时必须填写 Access Token 和用户标识请求头值");
      return;
    }
    if (
      formValues.provider === "web_bearer" &&
      formMode === "edit" &&
      editingAccount &&
      (formValues.baseUrl.trim().replace(/\/$/, "") !== editingAccount.baseUrl ||
        formValues.balancePath.trim() !== editingAccount.balancePath) &&
      (!formValues.accessToken.trim() || !formValues.userHeaderValue.trim())
    ) {
      setFormError(
        "修改服务地址或接口路径时，必须同时重新输入 Access Token 和用户标识请求头值",
      );
      return;
    }
    if (
      formValues.provider === "web_bearer" &&
      formMode === "edit" &&
      editingAccount &&
      formValues.userHeaderName.trim() !== editingAccount.userHeaderName &&
      !formValues.userHeaderValue.trim()
    ) {
      setFormError("修改用户标识请求头名称时，必须重新输入请求头值");
      return;
    }

    setIsSaving(true);
    try {
      const body: Record<string, string | number | boolean> = {
        provider: formValues.provider,
        name: formValues.name.trim(),
        baseUrl: formValues.baseUrl.trim().replace(/\/$/, ""),
        lowBalanceThreshold: threshold,
        active: formValues.active,
      };
      if (formValues.provider === "generic_bearer") {
        body.balancePath = formValues.balancePath.trim();
        if (formValues.apiKey.trim()) body.apiKey = formValues.apiKey.trim();
      } else if (formValues.provider === "aliyun_bss") {
        if (formValues.accessKeyId.trim()) {
          body.accessKeyId = formValues.accessKeyId.trim();
        }
        if (formValues.accessKeySecret.trim()) {
          body.accessKeySecret = formValues.accessKeySecret.trim();
        }
      } else if (formValues.provider === "cookie_session") {
        body.balancePath = formValues.balancePath.trim();
        if (formValues.sessionCookie.trim()) {
          body.sessionCookie = formValues.sessionCookie.trim();
        }
      } else {
        body.balancePath = formValues.balancePath.trim();
        body.userHeaderName = formValues.userHeaderName.trim();
        body.quotaDivisor = quotaDivisor;
        body.balanceCurrency = formValues.balanceCurrency.trim().toUpperCase();
        if (formValues.accessToken.trim()) {
          body.accessToken = formValues.accessToken.trim();
        }
        if (formValues.userHeaderValue.trim()) {
          body.userHeaderValue = formValues.userHeaderValue.trim();
        }
      }
      const response = await fetch(
        formMode === "edit" && editingAccount
          ? `/api/upstreams/${encodeURIComponent(editingAccount.id)}`
          : "/api/upstreams",
        {
          method: formMode === "edit" ? "PATCH" : "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await readResponse(response);
      applyPayload(payload);
      setLoadError(null);
      setFormValues((current) => ({
        ...current,
        apiKey: "",
        accessKeyId: "",
        accessKeySecret: "",
        sessionCookie: "",
        accessToken: "",
        userHeaderValue: "",
      }));
      setFormMode(null);
      setActionMessage(formMode === "edit" ? "账号配置已更新" : "上游账号已添加");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteAccount(account: PublicUpstream) {
    const confirmed = window.confirm(
      `确定删除「${account.name}」吗？该操作不会影响上游账户，但会移除本地配置。`,
    );
    if (!confirmed) return;
    setBusyId(account.id);
    try {
      const response = await fetch(`/api/upstreams/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      applyPayload(await readResponse(response));
      setLoadError(null);
      setActionMessage("上游账号已删除");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  const healthyText = accounts.length
    ? `${summary.healthy}/${accounts.length} 个账号正常`
    : "等待添加账号";

  const statusCounts = useMemo(() => {
    const counts = {
      all: accounts.length,
      healthy: 0,
      warning: 0,
      error: 0,
      disabled: 0,
      pending: 0,
    };
    for (const account of accounts) {
      counts[statusOf(account)] += 1;
    }
    return counts;
  }, [accounts]);

  const glassAccounts = useMemo(() => {
    const rank: Record<ReturnType<typeof statusOf>, number> = {
      warning: 0,
      error: 1,
      pending: 2,
      healthy: 3,
      disabled: 4,
    };
    return accounts
      .filter((account) => statusFilter === "all" || statusOf(account) === statusFilter)
      .slice()
      .sort((a, b) => {
        const statusDiff = rank[statusOf(a)] - rank[statusOf(b)];
        if (statusDiff !== 0) return statusDiff;
        const balA = a.usage?.balance_amount;
        const balB = b.usage?.balance_amount;
        if (balA === null || balA === undefined) return 1;
        if (balB === null || balB === undefined) return -1;
        return balA - balB;
      });
  }, [accounts, statusFilter]);

  return (
    <main className="bd-shell" data-mode={mode} data-theme={theme}>
      <div className="bd-cursor-glow" ref={glowRef} aria-hidden="true" />
      <header className="bd-header">
        <div className="bd-brand" aria-label="Musu 余额监控">
          <span className="bd-brand__mark" aria-hidden="true">
            {/* Apple continuous-corner app icon: filled gradient + white M */}
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="musuIconBg" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
                  <stop className="musu-stop-a" stopColor="#64D2FF" />
                  <stop className="musu-stop-b" offset="0.48" stopColor="#30D158" />
                  <stop className="musu-stop-c" offset="1" stopColor="#0A84FF" />
                </linearGradient>
                <linearGradient id="musuIconSheen" x1="8" y1="4" x2="20" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#fff" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#musuIconBg)" />
              <rect x="1.4" y="1.4" width="29.2" height="29.2" rx="7.6" stroke="#fff" strokeOpacity="0.22" />
              <path d="M2 9.5C6 5.5 12 4 16 4s10 1.5 14 5.5" stroke="url(#musuIconSheen)" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
              <path
                d="M9.1 22.4V11.2c0-.52.4-.92.9-.92.3 0 .58.15.74.42l4.35 7.65h.08l4.35-7.65c.16-.27.44-.42.74-.42.5 0 .9.4.9.92v11.2c0 .42-.34.76-.76.76s-.76-.34-.76-.76v-7.35h-.08l-3.78 6.6c-.16.28-.44.45-.75.45s-.59-.17-.75-.45l-3.78-6.6H9.86v7.35c0 .42-.34.76-.76.76s-.76-.34-.76-.76Z"
                fill="#fff"
              />
            </svg>
          </span>
          <span>
            <strong>Musu</strong>
            <small>余额监控</small>
          </span>
        </div>
        <div className="bd-header__status" aria-live="polite">
          <span
            className={`bd-status-dot${summary.errors ? " bd-status-dot--error" : summary.warning ? " bd-status-dot--warning" : ""}`}
            aria-hidden="true"
          />
          <span>{healthyText}</span>
          <span className="bd-header__divider" aria-hidden="true" />
          <span className="bd-header__time">
            {generatedAt ? `数据更新于 ${dateTime(generatedAt)}` : "正在连接服务"}
          </span>
        </div>
        <div className="bd-header__actions">
          <div className="bd-appearance" aria-label="外观设置">
            <div className="bd-seg" role="group" aria-label="颜色模式">
              <button
                type="button"
                className={mode === "dark" ? "is-on" : ""}
                onClick={() => setMode("dark")}
              >
                暗色
              </button>
              <button
                type="button"
                className={mode === "light" ? "is-on" : ""}
                onClick={() => setMode("light")}
              >
                白天
              </button>
            </div>
            <label className="bd-theme-field">
              <span
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                }}
              >
                主题
              </span>
              <select
                className="bd-theme-select"
                value={theme}
                onChange={(event) => setTheme(event.target.value as AppearanceTheme)}
                aria-label="主题色"
              >
                {THEME_OPTIONS.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="bd-button bd-button--primary" type="button" onClick={openAdd}>
            <span aria-hidden="true">＋</span>
            添加上游
          </button>
        </div>
      </header>

      <div className="bd-content">
        <div className="bd-stage">
          <section className="bd-intro" aria-labelledby="dashboard-title">
            <div>
              <p className="bd-kicker">MUSU</p>
              <h1 id="dashboard-title">余额监控</h1>
              <p>实时查看每个上游，还剩多少额度</p>
            </div>
            <div className="bd-intro__actions">
              <button
                className="bd-button bd-button--secondary"
                type="button"
                disabled={isRefreshing || Boolean(busyId) || accounts.length === 0}
                onClick={() => void refreshAccounts(selectedAccount?.id)}
              >
                <span className={isRefreshing || busyId ? "bd-spin" : ""} aria-hidden="true">
                  ↻
                </span>
                {selectedAccount ? "刷新当前" : "刷新全部"}
              </button>
            </div>
          </section>

          {loadError && (
            <div className="bd-alert" role="alert">
              <span className="bd-alert__icon" aria-hidden="true">
                !
              </span>
              <div>
                <strong>数据同步未完成</strong>
                <p>{loadError}。页面将保留最近一次成功数据。</p>
              </div>
              <button type="button" onClick={() => void loadAccounts()}>
                重试
              </button>
            </div>
          )}

          {isLoading ? (
            <DashboardSkeleton />
          ) : accounts.length === 0 ? (
            <section className="bd-empty">
              <span className="bd-empty__mark" aria-hidden="true">
                ＋
              </span>
              <p className="bd-kicker">GET STARTED</p>
              <h2>添加第一个上游账号</h2>
              <p>选择上游类型并填写服务端凭证后，这里会以玻璃卡展示各上游额度。</p>
              <button className="bd-button bd-button--primary" type="button" onClick={openAdd}>
                添加上游
              </button>
            </section>
          ) : (
            <>
              <div className="bd-strip" role="tablist" aria-label="按状态筛选上游">
                {(
                  [
                    ["all", "全部", statusCounts.all, ""],
                    ["warning", "预警", statusCounts.warning, " bd-strip__chip--warn"],
                    ["error", "异常", statusCounts.error, " bd-strip__chip--err"],
                    ["healthy", "正常", statusCounts.healthy, ""],
                  ] as const
                ).map(([key, label, count, extra]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === key}
                    className={`bd-strip__chip${extra}${statusFilter === key ? " is-active" : ""}`}
                    onClick={() => {
                      setStatusFilter(key);
                      if (selectedId !== "all") closeFlyDetail(true);
                      else setSelectedId("all");
                    }}
                  >
                    {label} <b>{count}</b>
                  </button>
                ))}
                {summary.balances.map(([currency, value]) => (
                  <span className="bd-strip__chip" key={currency} aria-label={`${currency} 合计`}>
                    {currency} 合计 <b>{money(value, currency)}</b>
                  </span>
                ))}
              </div>

              <div className="bd-quota-toolbar">
                <div>
                  <h2>上游额度</h2>
                  <p>
                    排序：预警优先 → 余额从低到高 · 显示 {glassAccounts.length} 个
                    {selectedAccount ? ` · 已打开 ${selectedAccount.name}` : ""}
                  </p>
                </div>
              </div>

              <CompactGlassGrid
                accounts={glassAccounts}
                busyId={busyId}
                sourceId={sourceCardId}
                onSelect={openAccountFromCard}
              />
            </>
          )}
        </div>
      </div>

      <div
        className={`bd-fly-scrim${flyOpen || selectedAccount ? " is-open" : ""}`}
        role="presentation"
        onMouseDown={() => {
          if (!formMode) closeFlyDetail(false);
        }}
      />
      <section
        ref={flyPopRef}
        className="bd-fly-pop"
        role="dialog"
        aria-modal="true"
        aria-hidden={selectedAccount ? "false" : "true"}
        aria-label={selectedAccount ? `${selectedAccount.name} 详情` : "账号详情"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {selectedAccount ? (
          <div className="bd-detail">
            <AccountDetail
              account={selectedAccount}
              busy={busyId === selectedAccount.id}
              onEdit={() => openEdit(selectedAccount)}
              onDelete={() => {
                const id = selectedAccount.id;
                closeFlyDetail(true);
                void deleteAccount(
                  accounts.find((item) => item.id === id) || selectedAccount,
                );
              }}
              onRefresh={() => void refreshAccounts(selectedAccount.id)}
              onClose={() => closeFlyDetail(false)}
            />
          </div>
        ) : null}
      </section>

      {formMode && (
        <div className="bd-modal-backdrop" role="presentation" onMouseDown={() => !isSaving && setFormMode(null)}>
          <section
            className="bd-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upstream-form-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="bd-modal__head">
              <div>
                <p className="bd-kicker">{formMode === "add" ? "NEW UPSTREAM" : "EDIT UPSTREAM"}</p>
                <h2 id="upstream-form-title">
                  {formMode === "add" ? "添加上游账号" : "编辑账号配置"}
                </h2>
              </div>
              <button
                className="bd-icon-button"
                type="button"
                aria-label="关闭"
                disabled={isSaving}
                onClick={() => setFormMode(null)}
              >
                ×
              </button>
            </div>
            <form className="bd-form" onSubmit={saveAccount}>
              <label className="bd-field">
                <span>
                  上游类型
                  <em>{formMode === "edit" ? "编辑时不可更改" : "选择对应鉴权方式"}</em>
                </span>
                <select
                  name="provider"
                  value={formValues.provider}
                  disabled={formMode === "edit"}
                  onChange={(event) =>
                    updateProvider(event.target.value as PublicUpstream["provider"])
                  }
                >
                  <option value="generic_bearer">兼容 API（Bearer）</option>
                  <option value="aliyun_bss">阿里云 BSS</option>
                  <option value="cookie_session">网页登录会话（Cookie）</option>
                  <option value="web_bearer">网页访问令牌（Bearer）</option>
                </select>
              </label>
              <label className="bd-field">
                <span>账号名称</span>
                <input
                  ref={firstInputRef}
                  name="name"
                  value={formValues.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder={
                    formValues.provider === "aliyun_bss"
                      ? "例如：阿里云生产账号"
                      : formValues.provider === "cookie_session"
                        ? "例如：网页登录余额账号"
                        : formValues.provider === "web_bearer"
                          ? "例如：网页令牌余额账号"
                      : "例如：CloudSky 主账号"
                  }
                  required
                  autoComplete="off"
                />
              </label>
              <label className="bd-field">
                <span>
                  {formValues.provider === "aliyun_bss" ? "Endpoint" : "服务地址"}
                  {formValues.provider === "aliyun_bss" && (
                    <em>默认使用阿里云中国站</em>
                  )}
                </span>
                <input
                  name="baseUrl"
                  type="url"
                  value={formValues.baseUrl}
                  onChange={(event) => updateField("baseUrl", event.target.value)}
                  placeholder={
                    formValues.provider === "aliyun_bss"
                      ? "https://business.aliyuncs.com"
                      : "https://api.example.com"
                  }
                  required
                  autoComplete="url"
                />
                <small>
                  {formValues.provider === "aliyun_bss"
                    ? "中国站使用 business.aliyuncs.com，国际站可填写对应 BSS Endpoint。"
                    : formValues.provider === "cookie_session"
                      ? "填写已登录网站的 HTTPS 根地址；修改地址时必须重新输入 Cookie。"
                      : formValues.provider === "web_bearer"
                        ? "填写网页账户接口的 HTTPS 根地址；修改地址时必须重新输入 Token 和用户标识值。"
                    : "填写上游 API 的根地址，不包含末尾斜杠。"}
                </small>
              </label>
              {formValues.provider === "generic_bearer" ? (
                <>
                  <label className="bd-field">
                    <span>余额接口路径</span>
                    <input
                      name="balancePath"
                      value={formValues.balancePath}
                      onChange={(event) => updateField("balancePath", event.target.value)}
                      placeholder="/api/usage/balance/"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      API Key
                      <em>
                        {formMode === "edit"
                          ? `当前 ${editingAccount?.maskedKey || "已配置"}，留空保留`
                          : "仅在服务端保存"}
                      </em>
                    </span>
                    <input
                      name="apiKey"
                      type="password"
                      value={formValues.apiKey}
                      onChange={(event) => updateField("apiKey", event.target.value)}
                      placeholder={formMode === "edit" ? "••••••••••••••••" : "sk-xxxxxxxx"}
                      required={formMode === "add"}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : formValues.provider === "aliyun_bss" ? (
                <>
                  <label className="bd-field">
                    <span>
                      AccessKey ID
                      <em>
                        {formMode === "edit"
                          ? `当前 ${editingAccount?.maskedKey || "已配置"}，留空保留`
                          : "仅在服务端保存"}
                      </em>
                    </span>
                    <input
                      name="accessKeyId"
                      value={formValues.accessKeyId}
                      onChange={(event) => updateField("accessKeyId", event.target.value)}
                      placeholder={formMode === "edit" ? "LTAI••••••••" : "LTAIxxxxxxxxxxxxxxxx"}
                      required={formMode === "add"}
                      autoComplete="off"
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      AccessKey Secret
                      <em>{formMode === "edit" ? "留空则保留当前 Secret" : "仅在服务端保存"}</em>
                    </span>
                    <input
                      name="accessKeySecret"
                      type="password"
                      value={formValues.accessKeySecret}
                      onChange={(event) => updateField("accessKeySecret", event.target.value)}
                      placeholder={formMode === "edit" ? "••••••••••••••••" : "填写 RAM 用户 Secret"}
                      required={formMode === "add"}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : formValues.provider === "web_bearer" ? (
                <>
                  <label className="bd-field">
                    <span>
                      余额接口路径
                      <em>默认适配网页账户自查接口</em>
                    </span>
                    <input
                      name="balancePath"
                      value={formValues.balancePath}
                      onChange={(event) => updateField("balancePath", event.target.value)}
                      placeholder="/user/self"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      Access Token
                      <em>
                        {formMode === "edit"
                          ? `当前 ${editingAccount?.maskedKey || "已配置"}，留空沿用；改地址或路径时须与用户标识值同时重填`
                          : "仅在服务端保存"}
                      </em>
                    </span>
                    <input
                      name="accessToken"
                      type="password"
                      value={formValues.accessToken}
                      onChange={(event) => updateField("accessToken", event.target.value)}
                      placeholder={formMode === "edit" ? "••••••••••••••••" : "填写网页 Access Token"}
                      required={formMode === "add"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <small>可粘贴 Token 本身或完整的“Bearer …”值；完整凭证不会返回浏览器。</small>
                  </label>
                  <label className="bd-field">
                    <span>用户标识请求头名称</span>
                    <input
                      name="userHeaderName"
                      value={formValues.userHeaderName}
                      onChange={(event) => updateField("userHeaderName", event.target.value)}
                      placeholder="New-Api-User"
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      用户标识请求头值
                      <em>
                        {formMode === "edit"
                          ? "留空沿用；改地址、路径或请求头名称时必须重填"
                          : "仅在服务端保存"}
                      </em>
                    </span>
                    <input
                      name="userHeaderValue"
                      type="password"
                      value={formValues.userHeaderValue}
                      onChange={(event) => updateField("userHeaderValue", event.target.value)}
                      placeholder={formMode === "edit" ? "••••••••••••••••" : "填写用户标识值"}
                      required={formMode === "add"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      点数换算除数
                      <em>原始点数 ÷ 除数 = 余额金额</em>
                    </span>
                    <input
                      name="quotaDivisor"
                      type="number"
                      min="0.00000001"
                      step="any"
                      value={formValues.quotaDivisor}
                      onChange={(event) => updateField("quotaDivisor", event.target.value)}
                      required
                    />
                  </label>
                  <label className="bd-field">
                    <span>余额币种</span>
                    <input
                      name="balanceCurrency"
                      value={formValues.balanceCurrency}
                      onChange={(event) =>
                        updateField("balanceCurrency", event.target.value.toUpperCase())
                      }
                      placeholder="CNY"
                      maxLength={3}
                      pattern="[A-Za-z]{3}"
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="bd-field">
                    <span>
                      余额接口路径
                      <em>填写返回余额 JSON 的 GET 接口</em>
                    </span>
                    <input
                      name="balancePath"
                      value={formValues.balancePath}
                      onChange={(event) => updateField("balancePath", event.target.value)}
                      placeholder="/api/usage/balance"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="bd-field">
                    <span>
                      登录会话 Cookie
                      <em>
                        {formMode === "edit"
                          ? "留空沿用；改地址或路径时必须重填"
                          : "仅在服务端保存"}
                      </em>
                    </span>
                    <input
                      name="sessionCookie"
                      type="password"
                      value={formValues.sessionCookie}
                      onChange={(event) => updateField("sessionCookie", event.target.value)}
                      placeholder={
                        formMode === "edit" ? "••••••••••••••••" : "name=value; name2=value2"
                      }
                      required={formMode === "add"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <small>
                      只粘贴 Cookie 请求头的值，不要包含“Cookie:”。会话失效后需重新登录并替换。
                    </small>
                  </label>
                </>
              )}
              <label className="bd-field">
                <span>低余额预警值</span>
                <span className="bd-input-suffix">
                  <input
                    name="lowBalanceThreshold"
                    type="number"
                    min="0"
                    step="any"
                    value={formValues.lowBalanceThreshold}
                    onChange={(event) => updateField("lowBalanceThreshold", event.target.value)}
                    required
                  />
                  <small>按接口返回币种</small>
                </span>
              </label>
              <label className="bd-toggle-field">
                <span>
                  <strong>启用余额监控</strong>
                  <small>停用后保留配置与历史数据，但不再自动请求上游。</small>
                </span>
                <input
                  name="active"
                  type="checkbox"
                  checked={formValues.active}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
              </label>
              {formError && (
                <p className="bd-form__error" role="alert">
                  {formError}
                </p>
              )}
              <div className="bd-form__actions">
                <button
                  className="bd-button bd-button--ghost"
                  type="button"
                  disabled={isSaving}
                  onClick={() => setFormMode(null)}
                >
                  取消
                </button>
                <button className="bd-button bd-button--primary" type="submit" disabled={isSaving}>
                  {isSaving ? "正在保存…" : formMode === "add" ? "添加并连接" : "保存配置"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {actionMessage && (
        <div className="bd-toast" role="status">
          <span aria-hidden="true">✓</span>
          {actionMessage}
        </div>
      )}
    </main>
  );
}

function AccountDetail({
  account,
  busy,
  onEdit,
  onDelete,
  onRefresh,
  onClose,
}: {
  account: PublicUpstream;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onClose?: () => void;
}) {
  const status = statusOf(account);
  const usage = account.usage;
  const isAliyun = account.provider === "aliyun_bss";
  const isCookieSession = account.provider === "cookie_session";
  const isWebBearer = account.provider === "web_bearer";
  const hasRecharge =
    typeof usage?.recharge_balance_amount === "number";
  const hasGift = typeof usage?.gift_balance_amount === "number";
  const hasQuota = usage?.quota !== null && usage?.quota !== undefined;
  const hasUsedQuota = usage?.used_quota !== null && usage?.used_quota !== undefined;
  const hasRequestCount =
    usage?.request_count !== null && usage?.request_count !== undefined;
  const hasUsedAmount =
    usage?.used_amount !== null && usage?.used_amount !== undefined;
  const subscriptions = usage?.subscriptions ?? [];
  const extraCards =
    Number(hasRecharge) +
    Number(hasGift) +
    Number(hasQuota) +
    Number(hasRequestCount) +
    Number(hasUsedAmount);
  const accountConnection = connectionLabel(account);

  return (
    <>
      <div className="bd-detail__head">
        <div className="bd-detail__title">
          <span className="bd-account__avatar" aria-hidden="true">
            {account.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            {status !== "healthy" ? (
              <span className={`bd-status-chip bd-status-chip--${status}`}>
                <span className="bd-status-dot" aria-hidden="true" />
                {statusLabel(status)}
              </span>
            ) : (
              <span className="bd-status-chip bd-status-chip--healthy bd-status-chip--quiet">
                {providerLabel(account.provider)}
              </span>
            )}
            <h2>{account.name}</h2>
            <p title={accountConnection}>{accountConnection}</p>
          </div>
        </div>
        <div className="bd-detail__actions">
          <button className="bd-button bd-button--ghost" type="button" onClick={onEdit}>
            编辑
          </button>
          <button
            className="bd-icon-button"
            type="button"
            title="刷新账号"
            aria-label={`刷新 ${account.name}`}
            disabled={busy}
            onClick={onRefresh}
          >
            <span className={busy ? "bd-spin" : ""} aria-hidden="true">
              ↻
            </span>
          </button>
          <button
            className="bd-icon-button bd-icon-button--danger"
            type="button"
            title="删除账号"
            aria-label={`删除 ${account.name}`}
            disabled={busy}
            onClick={onDelete}
          >
            ⌫
          </button>
          {onClose ? (
            <button
              className="bd-icon-button"
              type="button"
              title="关闭"
              aria-label="关闭详情"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {account.sync.error && (
        <div className="bd-sync-error" role="alert">
          <span className="bd-sync-error__code">SYNC ERROR</span>
          <div>
            <strong>最近一次同步失败</strong>
            <p>{account.sync.error}</p>
          </div>
          <small>{dateTime(account.sync.lastAttemptAt)}</small>
        </div>
      )}

      <div
        className={`bd-balance-grid${extraCards === 0 ? " bd-balance-grid--single" : ""}`}
      >
        <article
          className={`bd-balance-card${status === "warning" ? " bd-balance-card--warning" : ""}`}
        >
          <div>
            <p>{isAliyun ? "可用额度" : "当前可用余额"}</p>
            <span>{usage?.currency || "—"}</span>
          </div>
          <strong>
            {usage && usage.balance_amount !== null
              ? money(usage.balance_amount, usage.currency)
              : "—"}
          </strong>
          <small>
            {usage
              ? `预警线 ${money(account.lowBalanceThreshold, usage.currency)}`
              : "等待上游返回余额"}
          </small>
        </article>
        {hasRecharge ? (
          <article className="bd-balance-card">
            <div>
              <p>充值余额</p>
              <span>{usage?.currency}</span>
            </div>
            <strong>
              {money(usage!.recharge_balance_amount as number, usage!.currency)}
            </strong>
          </article>
        ) : null}
        {hasGift ? (
          <article className="bd-balance-card">
            <div>
              <p>馈赠金</p>
              <span>{usage?.currency}</span>
            </div>
            <strong>
              {money(usage!.gift_balance_amount as number, usage!.currency)}
            </strong>
          </article>
        ) : null}
        {hasUsedAmount ? (
          <article className="bd-balance-card">
            <div>
              <p>累计消耗</p>
              <span>{usage?.currency}</span>
            </div>
            <strong>{money(usage!.used_amount as number, usage!.currency)}</strong>
          </article>
        ) : null}
        {hasQuota ? (
          <article className="bd-balance-card">
            <div>
              <p>额度点数</p>
              <span>POINTS</span>
            </div>
            <strong>{NUMBER_FORMAT.format(usage!.quota as number)}</strong>
            {hasUsedQuota ? (
              <small>已用 {NUMBER_FORMAT.format(usage!.used_quota as number)}</small>
            ) : null}
          </article>
        ) : null}
        {hasRequestCount ? (
          <article className="bd-balance-card">
            <div>
              <p>累计请求</p>
              <span>REQ</span>
            </div>
            <strong>
              {INTEGER_FORMAT.format(usage!.request_count as number)}
            </strong>
            {usage?.username ? <small>{usage.username}</small> : null}
          </article>
        ) : null}
      </div>

      {subscriptions.length > 0 ? (
        <section className="bd-subscriptions" aria-labelledby={`subscriptions-${account.id}`}>
          <div className="bd-section-head bd-section-head--wide">
            <div>
              <p className="bd-kicker">SUBSCRIPTIONS</p>
              <h3 id={`subscriptions-${account.id}`}>活跃订阅</h3>
            </div>
            <span>{subscriptions.length}</span>
          </div>
          <div className="bd-subscription-list">
            {subscriptions.map((subscription) => {
              const unlimited = subscription.amount_total === 0;
              const progress =
                !subscription.amount_total || subscription.amount_used === null
                  ? 0
                  : Math.min(
                      100,
                      Math.max(
                        0,
                        (subscription.amount_used / subscription.amount_total) * 100,
                      ),
                    );
              return (
                <article className="bd-subscription" key={String(subscription.id)}>
                  <div className="bd-subscription__head">
                    <div>
                      <span className="bd-status-chip bd-status-chip--healthy">
                        <span className="bd-status-dot" aria-hidden="true" />
                        {subscription.status === "active"
                          ? "使用中"
                          : subscription.status || "有效"}
                      </span>
                      <h4>{subscription.plan_title || "未命名套餐"}</h4>
                    </div>
                    <strong>
                      {unlimited
                        ? "不限额度"
                        : subscription.amount_remain === null
                          ? "—"
                          : `${NUMBER_FORMAT.format(subscription.amount_remain)} 点可用`}
                    </strong>
                  </div>
                  <div className={`bd-progress${unlimited ? " bd-progress--unlimited" : ""}`}>
                    <span style={{ width: unlimited ? "100%" : `${progress}%` }} />
                  </div>
                  <div className="bd-subscription__legend">
                    <span>
                      已用{" "}
                      <strong>
                        {subscription.amount_used === null
                          ? "—"
                          : NUMBER_FORMAT.format(subscription.amount_used)}
                      </strong>
                    </span>
                    <span>
                      总额{" "}
                      <strong>
                        {unlimited
                          ? "不限"
                          : subscription.amount_total === null
                            ? "—"
                            : NUMBER_FORMAT.format(subscription.amount_total)}
                      </strong>
                    </span>
                  </div>
                  {(subscription.end_time || subscription.next_reset_time) && (
                    <dl className="bd-subscription__dates">
                      {subscription.end_time ? (
                        <div>
                          <dt>套餐到期</dt>
                          <dd>{longDate(subscription.end_time)}</dd>
                        </div>
                      ) : null}
                      {subscription.next_reset_time ? (
                        <div>
                          <dt>下次重置</dt>
                          <dd>{longDate(subscription.next_reset_time)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <footer className="bd-detail__footer">
        <span>
          {isAliyun
            ? "接口：QueryAccountBalance"
            : `路径：${account.balancePath}`}{" "}
          ·{" "}
          {isCookieSession
            ? "会话 Cookie"
            : isWebBearer
              ? "访问令牌"
              : "凭证"}
          ：{account.maskedKey}
        </span>
        <span>
          最近同步：
          {account.sync.lastSuccessAt
            ? longDate(account.sync.lastSuccessAt)
            : account.sync.lastAttemptAt
              ? `失败于 ${longDate(account.sync.lastAttemptAt)}`
              : "尚未同步"}
        </span>
      </footer>
    </>
  );
}

function CompactGlassGrid({
  accounts,
  busyId,
  sourceId,
  onSelect,
}: {
  accounts: PublicUpstream[];
  busyId: string | null;
  sourceId: string | null;
  onSelect: (id: string, el: HTMLElement) => void;
}) {
  if (!accounts.length) {
    return (
      <div className="bd-inline-empty" style={{ marginTop: 0 }}>
        <span aria-hidden="true">—</span>
        <div>
          <strong>当前筛选下没有上游</strong>
          <p>切换到「全部」或其它状态再看。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bd-glass-grid" aria-label="上游额度卡片">
      {accounts.map((account, index) => {
        const status = statusOf(account);
        const progress = remainingProgress(account);
        const currency = account.usage?.currency || "CNY";
        const metaLeft =
          status === "warning"
            ? `预警线 ${money(account.lowBalanceThreshold, currency)}`
            : status === "error"
              ? "同步异常"
              : progress
                ? progress.leftLabel
                : `预警线 ${money(account.lowBalanceThreshold, currency)}`;
        const metaRight =
          busyId === account.id
            ? "刷新中…"
            : progress && status !== "error"
              ? progress.rightLabel
              : relativeTime(account.sync.lastSuccessAt);

        return (
          <button
            type="button"
            key={account.id}
            className={`bd-glass-card${
              status === "warning"
                ? " is-warning"
                : status === "error"
                  ? " is-error"
                  : status === "disabled"
                    ? " is-disabled"
                    : ""
            }${sourceId === account.id ? " is-source" : ""}`}
            style={{ animationDelay: `${Math.min(index, 12) * 0.05}s` }}
            onClick={(event) => onSelect(account.id, event.currentTarget)}
          >
            <div className="bd-glass-card__top">
              <div className="bd-glass-card__who">
                <span className="bd-glass-card__avatar" aria-hidden="true">
                  {account.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{account.name}</strong>
                  <small>{providerLabel(account.provider)}</small>
                </span>
              </div>
              {status === "healthy" || status === "pending" ? null : (
                <span className={`bd-status-chip bd-status-chip--${status}`}>
                  <span className="bd-status-dot" aria-hidden="true" />
                  {statusLabel(status)}
                </span>
              )}
            </div>
            <p className="bd-glass-card__amount">
              {account.usage && account.usage.balance_amount !== null
                ? money(account.usage.balance_amount, account.usage.currency)
                : "—"}
            </p>
            {progress ? (
              <div className="bd-glass-card__bar" aria-hidden="true">
                <span style={{ width: `${progress.percent}%` }} />
              </div>
            ) : null}
            {account.sync.error ? (
              <p className="bd-glass-card__error" title={account.sync.error}>
                {account.sync.error}
              </p>
            ) : null}
            <div className="bd-glass-card__meta">
              <span>
                <strong>{metaLeft}</strong>
              </span>
              <span>{metaRight}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="bd-skeleton" aria-label="正在加载余额数据" aria-busy="true">
      <div className="bd-glass-grid">
        {[0, 1, 2, 3].map((item) => (
          <span
            key={item}
            style={{
              minHeight: 118,
              borderRadius: 12,
              display: "block",
              position: "relative",
              background: "rgba(56, 249, 215, 0.06)",
              overflow: "hidden",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default BalanceDashboard;
