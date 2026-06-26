import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

const APP_TITLE = "Archie — Your team AI coding environment";
const APP_DESCRIPTION = "Your team AI coding environment";

function getRequestOrigin(requestHeaders: Headers): URL {
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");

  if (!host) return new URL("http://localhost:3001");
  return new URL(`${proto}://${host}`);
}

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = getRequestOrigin(await headers());

  return {
    metadataBase,
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    openGraph: {
      title: APP_TITLE,
      description: APP_DESCRIPTION,
      siteName: "Archie",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "Archie",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: APP_TITLE,
      description: APP_DESCRIPTION,
      images: ["/og-image.png"],
    },
  };
}

const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('archie-theme') || 'dark';
    if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`} suppressHydrationWarning>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
