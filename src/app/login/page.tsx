'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { K2D } from 'next/font/google';

// โหลดฟอนต์ K2D รองรับภาษาไทยและอังกฤษ
const k2d = K2D({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700']
});

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); // เพิ่มฟังก์ชันเปิด-ปิดตาดูรหัสผ่าน
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envMode, setEnvMode] = useState<'production' | 'demo'>('production');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mode = (localStorage.getItem('supabase_mode') as 'production' | 'demo') || 'production';
      setEnvMode(mode);
    }
  }, []);

  const handleSwitchEnv = (mode: 'production' | 'demo') => {
    if (typeof window !== 'undefined') {
      // ล้าง sessionStorage และ localStorage ที่เกี่ยวกับ Supabase เพื่อหลีกเลี่ยง session ข้ามระบบกัน
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('sb-')) {
          sessionStorage.removeItem(key);
        }
      }
      document.cookie.split(";").forEach((c) => {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
        if (name.startsWith("sb-")) {
          document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
        }
      });
      localStorage.setItem('supabase_mode', mode);
      window.location.reload();
    }
  };


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
    <div className={`${k2d.className} bg-[#031222] text-white min-h-screen flex flex-col justify-center items-center overflow-x-hidden relative antialiased`}>

      {/* Background Image Pattern with Filter */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[url('https://salayaone.com/img/banner.jpg')] bg-cover bg-center"
        // style={{ filter: 'grayscale(100%) contrast(1.2) brightness(0.4)' }}
      />
      {/* <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-b from-[#031222]/80 via-[#031222]/90 to-[#031222]" /> */}

      <main className="w-full max-w-[540px] px-5 md:px-0 z-10">
        {/* Login Glassmorphic Card */}
        <div className="bg-white/5 rounded-3xl shadow-2xl border border-white/10 p-8 md:p-16 relative overflow-hidden backdrop-blur-xl">

          {/* Subtle Accent Line */}
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#e8d8c3] to-transparent opacity-50" />

          {/* Header Section */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-[#001128] to-[#0a2647] rounded-xl flex items-center justify-center shadow-lg border border-[#e8d8c3]/20 mb-6">
              <span className="text-[#e8d8c3] text-3xl font-light tracking-widest">L</span>
            </div>
            <h1 className="text-2xl font-semibold text-white tracking-[0.2em] font-light">SALAYA ONE</h1>
            <p className="text-[#e8d8c3]/70 mt-1 font-light uppercase tracking-wider text-xs">Premium Serviced Apartment</p>
          </div>

          {/* Environment Selector */}
          <div className="flex flex-col items-center mb-8">
            
            <div className="bg-[#001128]/60 p-1.5 rounded-2xl border border-white/10 flex w-full max-w-[320px] backdrop-blur-md">
              <button
                type="button"
                onClick={() => handleSwitchEnv('production')}
                className={`flex-1 py-2 rounded-xl text-xs font-medium tracking-wide transition-all duration-300 ${
                  envMode === 'production'
                    ? 'bg-[#e8d8c3] text-[#001128] font-bold shadow-md'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                Production
              </button>
              <button
                type="button"
                onClick={() => handleSwitchEnv('demo')}
                className={`flex-1 py-2 rounded-xl text-xs font-medium tracking-wide transition-all duration-300 ${
                  envMode === 'demo'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                Demo
              </button>
            </div>
          </div>

          {/* Form Title */}
          <h2 className="text-lg text-white/90 mb-10 text-center font-light tracking-wide">
            เข้าสู่ระบบเพื่อจัดการห้องพัก {envMode === 'demo' && <span className="text-amber-400 font-normal">(Demo)</span>}
          </h2>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-8">

            {/* Error Message Box */}
            {error && (
              <div className="p-4 bg-red-500/10 text-red-300 rounded-xl text-sm border border-red-500/20 flex items-center gap-3 animate-pulse">
                {/* SVG Alert Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 shrink-0 text-red-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span className="font-medium">{error}</span>
              </div>
            )}

            {/* Username Field */}
            <div>
              <label className="block text-sm text-[#e8d8c3]/80 mb-2 font-light" htmlFor="username">
                ชื่อผู้ใช้ หรือ อีเมล (Username or Email)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-1 flex items-center pointer-events-none text-white/50">
                  {/* SVG User Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="ชื่อผู้ใช้ หรือ email@example.com"
                  className="block w-full pl-10 pr-3 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm text-[#e8d8c3]/80 font-light" htmlFor="password">
                  รหัสผ่าน (Password)
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-1 flex items-center pointer-events-none text-white/50">
                  {/* SVG Lock Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-10 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-1 flex items-center text-white/50 hover:text-[#e8d8c3] transition-colors"
                >
                  {/* SVG Eye / Visibility Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-lg text-sm font-medium text-[#001128] bg-gradient-to-r from-[#e8d8c3] to-[#d4b895] hover:from-[#d4b895] hover:to-[#e8d8c3] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#e8d8c3] focus:ring-offset-[#031222] uppercase tracking-wider disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-[#001128] border-t-transparent rounded-full animate-spin" />
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </button>
            </div>
          </form>

          {/* Footer Link */}
          <div className="mt-10 text-center">
            <Link href="/register" className="text-sm text-white/60 hover:text-[#e8d8c3] transition-colors font-light tracking-wide">
              ยังไม่มีบัญชีผู้ใช้งาน? สมัครสมาชิกที่นี่
            </Link>
          </div>
        </div>

        {/* Shared Footer */}
        <footer className="mt-10 w-full flex flex-col md:flex-row justify-center items-center gap-3 py-6 z-10 relative">
          <span className="text-xs text-white/40 font-light tracking-wider text-center md:text-left">
            © 2026 Salaya One Premium Serviced Apartments. All rights reserved.
          </span>
          <div className="flex gap-6 md:ml-4">
            <Link href="#" className="text-xs text-white/40 hover:text-[#e8d8c3] transition-colors font-light uppercase tracking-wider">Privacy Policy</Link>
            <Link href="#" className="text-xs text-white/40 hover:text-[#e8d8c3] transition-colors font-light uppercase tracking-wider">Terms of Service</Link>
            <Link href="#" className="text-xs text-white/40 hover:text-[#e8d8c3] transition-colors font-light uppercase tracking-wider">Contact Support</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}