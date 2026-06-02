// src/app/pending/page.tsx
'use client';

import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function PendingPage() {
  const { profile, loading, logout, refreshProfile } = useAuth();
  const router = useRouter();

  // If status becomes active, redirect to home page automatically
  useEffect(() => {
    if (!loading && profile && profile.status === 'active') {
      router.push('/');
      router.refresh();
    }
  }, [profile, loading, router]);

  const handleCheckStatus = async () => {
    await refreshProfile();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100 p-8 md:p-10 text-center">
        <div className="w-20 h-20 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center text-4xl mx-auto mb-6 animate-pulse">
          ⏳
        </div>
        
        <h2 className="text-2xl font-bold text-[#0A2647] mb-2">อยู่ระหว่างรอการอนุมัติ</h2>
        <p className="text-slate-500 text-sm leading-relaxed mb-6">
          สวัสดีคุณ <span className="font-bold text-slate-800">{profile?.user_name || 'ผู้ใช้งาน'}</span> ({profile?.email})<br />
          บัญชีของคุณได้รับการลงทะเบียนแล้ว ขณะนี้กำลังรอผู้ดูแลระบบ (Owner หรือ Admin) ทำการอนุมัติสิทธิ์การเข้าใช้งาน
        </p>

        <div className="space-y-3">
          <button
            onClick={handleCheckStatus}
            className="w-full py-4 px-6 bg-[#0A2647] text-white font-bold rounded-2xl shadow-lg hover:bg-[#143e6c] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
          >
            ตรวจสอบสถานะอีกครั้ง
          </button>
          
          <button
            onClick={logout}
            className="w-full py-4 px-6 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all duration-200"
          >
            ออกจากระบบ (Logout)
          </button>
        </div>
      </div>
    </div>
  );
}
