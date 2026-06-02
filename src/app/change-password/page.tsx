// src/app/change-password/page.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import Link from 'next/link';

export default function ChangePasswordPage() {
  const { user, profile, loading, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A2647] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
        <p className="text-white/60 text-sm font-medium tracking-wide">กำลังเตรียมความพร้อมของระบบ...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold text-[#0A2647] mb-2">ไม่พบข้อมูลผู้ใช้งาน</h2>
        <p className="text-slate-500 mb-6">กรุณา<Link href="/login" className="font-bold text-[#4F81FF] hover:underline">เข้าสู่ระบบ</Link>ก่อน</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Validate
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('กรุณากรอกข้อมูลทุกช่อง');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('รหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }

    if (newPassword.length < 6) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }

    setProcessing(true);

    const res = await changePassword(currentPassword, newPassword);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }

    setProcessing(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-md mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-[#0A2647]">เปลี่ยนรหัสผ่าน</h1>
        <p className="text-slate-500 mt-2">อัปเดตรหัสผ่านของบัญชี <span className="font-semibold text-slate-700">{profile.user_name}</span></p>
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm border border-red-100 animate-pulse">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-green-50 text-green-700 rounded-2xl text-sm border border-green-100 flex items-center gap-3">
            <span className="text-lg">✅</span>
            <div>
              <div className="font-semibold">เปลี่ยนรหัสผ่านสำเร็จ</div>
              <p className="text-xs opacity-80">รหัสผ่านของคุณได้ถูกอัปเดตเรียบร้อย</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Current Password */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">รหัสผ่านปัจจุบัน</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4F81FF] focus:bg-white transition-all duration-200"
              disabled={processing}
            />
          </div>

          {/* New Password */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">รหัสผ่านใหม่</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4F81FF] focus:bg-white transition-all duration-200"
              disabled={processing}
            />
            <p className="text-xs text-slate-500 mt-1.5">ต้องมีอย่างน้อย 6 ตัวอักษร</p>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">ยืนยันรหัสผ่านใหม่</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4F81FF] focus:bg-white transition-all duration-200"
              disabled={processing}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={processing}
            className="w-full py-4 px-6 bg-[#0A2647] text-white font-bold rounded-2xl shadow-lg shadow-[#0a2647]/10 hover:bg-[#143e6c] hover:shadow-[#0a2647]/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
          >
            {processing ? (
              <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              'เปลี่ยนรหัสผ่าน'
            )}
          </button>
        </form>
      </div>

      {/* Back Link */}
      <div className="text-center">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors">
          ← กลับไปยังหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
