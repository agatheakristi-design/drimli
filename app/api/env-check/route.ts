import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    hasServiceRoleKey: !!v,
    serviceRoleKeyLength: v ? v.length : 0,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
