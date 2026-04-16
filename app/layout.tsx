import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Open Order',
  description:
    'Evidence-first procedural retrieval for New Zealand parliamentary material.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}