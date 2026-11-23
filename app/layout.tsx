import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'open/order · Procedural navigator for the NZ House of Representatives',
  description:
    'Evidence-first procedural retrieval for New Zealand parliamentary material.'
}

// Set the saved theme before first paint, independently of React hydration.
const initialiseTheme = `try {
  const saved = window.localStorage.getItem("open-order-theme");
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initialiseTheme }} />
      </head>
      <body>{children}</body>
    </html>
  )
}