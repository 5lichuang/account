import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "Musu 余额监控：实时查看每个上游还剩多少额度。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${host}`);
  } catch {
    metadataBase = new URL("http://localhost:3000");
  }

  const previewImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: {
      default: "Musu · 余额监控",
      template: "%s · Musu",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Musu · 余额监控",
      description,
      url: metadataBase,
      siteName: "Musu",
      locale: "zh_CN",
      type: "website",
      images: [
        {
          url: previewImage,
          width: 1536,
          height: 1024,
          alt: "Musu 多上游余额监控",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Musu · 余额监控",
      description,
      images: [previewImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
