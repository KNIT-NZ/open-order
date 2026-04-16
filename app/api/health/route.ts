import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'open-order',
    timestamp: new Date().toISOString()
  })
}