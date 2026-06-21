import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  // 1. ดึงค่า Environment Variables ของทั้ง 2 Databases
  const mainUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const mainKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const demoUrl = process.env.NEXT_PUBLIC_DEMO_SUPABASE_URL
  const demoKey = process.env.NEXT_PUBLIC_DEMO_SUPABASE_ANON_KEY

  if (!mainUrl || !mainKey || !demoUrl || !demoKey) {
    return NextResponse.json({ 
      error: 'ข้อมูล Environment Variables ไม่ครบ (ขาดของตัวหลัก หรือ ตัว DEMO)' 
    }, { status: 500 })
  }

  try {
    // 2. ปลุก Database ตัวหลัก โดยยิงไปทักทายตาราง rooms
    const supabaseMain = createClient(mainUrl, mainKey)
    const { error: mainError } = await supabaseMain.from('rooms').select('*').limit(1)

    // 3. ปลุก Database ตัว DEMO โดยยิงไปทักทายตาราง rooms เช่นกัน
    const supabaseDemo = createClient(demoUrl, demoKey)
    const { error: demoError } = await supabaseDemo.from('rooms').select('*').limit(1)

    // ตรวจสอบความผิดพลาด
    if (mainError || demoError) {
      return NextResponse.json({
        success: false,
        message: "มีบาง Database ยิงไม่สำเร็จ",
        main_db_status: mainError ? mainError.message : "ทำงานปกติ",
        demo_db_status: demoError ? demoError.message : "ทำงานปกติ"
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      message: "ปลุกระบบสำเร็จทั้ง Main DB และ Demo DB เรียบร้อยแล้ว!" 
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
