// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await login(usernameOrEmail, password);
    if (res.error) {
      setError(res.error);
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100 transition-all duration-300 hover:shadow-2xl">
        <div className="p-8 md:p-10">
          {/* Logo / Brand Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-[#0A2647] flex items-center justify-center text-white text-2xl font-bold mb-4 shadow-lg shadow-[#0a2647]/20">
              S
            </div>
            <h2 className=" text-2xl font-bold text-[#0A2647]">SALAYA ONE</h2>
            <h2 className="text-sm text-2xl font-bold text-[#0A2647]">PREMIUM SERVICED APARTMENT</h2>
            <p className="text-slate-400 text-sm mt-1">เข้าสู่ระบบเพื่อจัดการหอพักของคุณ</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm border border-red-100 animate-pulse">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">ชื่อผู้ใช้ หรือ อีเมล (Username or Email)</label>
              <input
                type="text"
                required
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                placeholder="ชื่อผู้ใช้ หรือ email@example.com"
                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4F81FF] focus:bg-white transition-all duration-200"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold text-slate-700">รหัสผ่าน (Password)</label>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4F81FF] focus:bg-white transition-all duration-200"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-6 bg-[#0A2647] text-white font-bold rounded-2xl shadow-lg shadow-[#0a2647]/10 hover:bg-[#143e6c] hover:shadow-[#0a2647]/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
            >
              {loading ? (
                <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'เข้าสู่ระบบ'
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-400">
              ยังไม่มีบัญชีผู้ใช้งาน?{' '}
              <Link href="/register" className="font-bold text-[#4F81FF] hover:underline">
                สมัครสมาชิกที่นี่
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
