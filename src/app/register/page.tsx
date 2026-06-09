'use client';

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { K2D } from 'next/font/google';

// โหลดฟอนต์ K2D รองรับภาษาไทยและอังกฤษ
const k2d = K2D({ 
  subsets: ['thai', 'latin'], 
  weight: ['300', '400', '500', '600', '700'] 
});

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate username (only alphanumeric and underscores, min 3 chars)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      setError('ชื่อผู้ใช้ (Username) ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ _ ความยาว 3-20 ตัวอักษร');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('รหัสผ่านไม่ตรงกัน');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      setLoading(false);
      return;
    }

    const res = await register(email, password, username);
    if (res.error) {
      setError(res.error);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  // ==========================================
  // SCREEN 1: เมื่อสมัครสมาชิกสำเร็จ (Success View)
  // ==========================================
  if (success) {
    return (
      <div className={`${k2d.className} bg-[#031222] text-white min-h-screen flex flex-col justify-center items-center overflow-x-hidden relative antialiased`}>
        {/* Background Image Pattern with Filter */}
        <div 
          className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=2070')] bg-cover bg-center" 
          style={{ filter: 'grayscale(100%) contrast(1.2) brightness(0.4)' }}
        />
        <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-b from-[#031222]/80 via-[#031222]/90 to-[#031222]" />

        <main className="w-full max-w-[540px] px-5 z-10">
          <div className="bg-white/5 rounded-3xl shadow-2xl border border-white/10 p-8 md:p-12 text-center relative overflow-hidden backdrop-blur-xl">
            
            {/* Subtle Accent Line */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#e8d8c3] to-transparent opacity-50" />

            {/* Checkmark Circle Luxury Styled */}
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-3xl mx-auto mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>

            <h2 className="text-2xl font-semibold text-white mb-3 tracking-wide">สมัครสมาชิกสำเร็จ!</h2>
            <p className="text-[#e8d8c3]/70 text-sm leading-relaxed mb-8 font-light">
              บัญชีของคุณได้รับการลงทะเบียนในระบบเรียบร้อยแล้ว กรุณารอผู้ดูแลระบบ (Owner หรือ Admin) ทำการอนุมัติ (Approve) สิทธิ์การเข้าใช้งาน
            </p>
            
            <Link
              href="/login"
              className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-lg text-sm font-medium text-[#001128] bg-gradient-to-r from-[#e8d8c3] to-[#d4b895] hover:from-[#d4b895] hover:to-[#e8d8c3] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#e8d8c3] uppercase tracking-wider"
            >
              กลับสู่หน้าเข้าสู่ระบบ
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // ==========================================
  // SCREEN 2: ฟอร์มกรอกข้อมูลสมัครสมาชิก (Default Form View)
  // ==========================================
  return (
    <div className={`${k2d.className} bg-[#031222] text-white min-h-screen flex flex-col justify-center items-center overflow-x-hidden relative antialiased`}>
      
      {/* Background Image Pattern with Filter */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=2070')] bg-cover bg-center" 
        style={{ filter: 'grayscale(100%) contrast(1.2) brightness(0.4)' }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-b from-[#031222]/80 via-[#031222]/90 to-[#031222]" />

      <main className="w-full max-w-[540px] px-5 md:px-0 my-8 z-10">
        {/* Register Glassmorphic Card */}
        <div className="bg-white/5 rounded-3xl shadow-2xl border border-white/10 p-8 md:p-14 relative overflow-hidden backdrop-blur-xl">
          
          {/* Subtle Accent Line */}
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#e8d8c3] to-transparent opacity-50" />

          {/* Header Section */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-[#001128] to-[#0a2647] rounded-xl flex items-center justify-center shadow-lg border border-[#e8d8c3]/20 mb-5">
              <span className="text-[#e8d8c3] text-3xl font-light tracking-widest">S</span>
            </div>
            <h1 className="text-2xl font-semibold text-white tracking-[0.2em] font-light">SALAYA ONE</h1>
            <p className="text-[#e8d8c3]/70 mt-1 font-light uppercase tracking-wider text-xs">Premium Serviced Apartment</p>
          </div>

          {/* Form Title */}
          <h2 className="text-base text-white/90 mb-8 text-center font-light tracking-wide">
            กรอกข้อมูลเพื่อลงทะเบียนเข้าใช้งานระบบ
          </h2>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Error Message Box */}
            {error && (
              <div className="p-4 bg-red-500/10 text-red-300 rounded-xl text-sm border border-red-500/20 flex items-center gap-3 animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 shrink-0 text-red-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span className="font-medium">{error}</span>
              </div>
            )}

            {/* Username Field */}
            <div>
              <label className="block text-sm text-[#e8d8c3]/80 mb-1 font-light" htmlFor="username">
                ชื่อผู้ใช้ (Username)
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Name"
                  className="block w-full pl-10 pr-3 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-sm text-[#e8d8c3]/80 mb-1 font-light" htmlFor="email">
                อีเมล (Email)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-1 flex items-center pointer-events-none text-white/50">
                  {/* SVG Email Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0l-7.5-4.615a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="block w-full pl-10 pr-3 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm text-[#e8d8c3]/80 mb-1 font-light" htmlFor="password">
                รหัสผ่าน (Password)
              </label>
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
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  className="block w-full pl-10 pr-10 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-1 flex items-center text-white/50 hover:text-[#e8d8c3] transition-colors"
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div>
              <label className="block text-sm text-[#e8d8c3]/80 mb-1 font-light" htmlFor="confirmPassword">
                ยืนยันรหัสผ่าน (Confirm Password)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-1 flex items-center pointer-events-none text-white/50">
                  {/* SVG Lock Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="ป้อนรหัสผ่านอีกครั้ง"
                  className="block w-full pl-10 pr-10 py-3 bg-transparent border-0 border-b border-white/20 focus:ring-0 focus:border-[#e8d8c3] transition-all text-base text-white placeholder:text-white/30 outline-none font-light"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-1 flex items-center text-white/50 hover:text-[#e8d8c3] transition-colors"
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-lg text-sm font-medium text-[#001128] bg-gradient-to-r from-[#e8d8c3] to-[#d4b895] hover:from-[#d4b895] hover:to-[#e8d8c3] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#e8d8c3] focus:ring-offset-[#031222] uppercase tracking-wider disabled:opacity-50 flex items-center justify-center"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-[#001128] border-t-transparent rounded-full animate-spin" />
                ) : (
                  'สมัครสมาชิก'
                )}
              </button>
            </div>
          </form>

          {/* Footer Link */}
          <div className="mt-8 pt-5 border-t border-white/5 text-center">
            <p className="text-sm text-white/60 font-light">
              มีบัญชีผู้ใช้งานแล้ว?{' '}
              <Link href="/login" className="font-semibold text-[#e8d8c3] hover:text-[#d4b895] transition-colors ml-1">
                เข้าสู่ระบบที่นี่
              </Link>
            </p>
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