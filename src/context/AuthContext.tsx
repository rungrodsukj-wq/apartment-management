// src/context/AuthContext.tsx
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { logAudit } from '../lib/audit';
import { supabase, productionSupabase } from '../lib/supabase';

export type UserRole = 'admin' | 'owner' | 'staff' | 'viewer';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface UserProfile {
  id: string;
  email: string;
  user_name: string;
  role: UserRole;
  status: UserStatus;
  page_permissions: string[];
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<{ error: string | null }>;
  register: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      console.error('Error fetching user profile:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      setProfile(null);
      return null;
    }
    if (data) {
      setProfile(data as UserProfile);
      return data as UserProfile;
    }
    setProfile(null);
    return null;
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  useEffect(() => {
    // โหลด session ปัจจุบัน
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Supabase auth getSession error:', error);
        supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // ฟังการเปลี่ยนแปลง auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const authEvent = String(event);
      if (authEvent.includes('REFRESH')) {
        console.warn('Supabase token refresh event detected:', authEvent);
        if (authEvent.includes('FAILED')) {
          setUser(null);
          setProfile(null);
          supabase.auth.signOut();
          return;
        }
      }

      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function login(usernameOrEmail: string, password: string): Promise<{ error: string | null }> {
    let email = usernameOrEmail;

    // หากไม่ใช่ Email (ไม่มีเครื่องหมาย @) ให้ค้นหา Email จาก username ในตาราง user_profiles
    if (!usernameOrEmail.includes('@')) {
      const { data, error } = await supabase
        .rpc('get_email_by_username', { p_username: usernameOrEmail });

      if (error) {
        console.warn('RPC get_email_by_username failed, attempting direct query fallback:', error);
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('user_name', usernameOrEmail)
          .maybeSingle();

        if (fallbackError || !fallbackData) {
          console.error('Fallback query failed:', fallbackError);
          return { error: 'ไม่พบบัญชีผู้ใช้งานหรือ Username นี้ในระบบ' };
        }
        email = fallbackData.email;
      } else if (!data) {
        return { error: 'ไม่พบบัญชีผู้ใช้งานหรือ Username นี้ในระบบ' };
      } else {
        email = data;
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    if (data.user) {
      const profileData = await fetchProfile(data.user.id);
      if (!profileData) {
        await supabase.auth.signOut();
        setUser(null);
        return { error: 'ไม่พบข้อมูลโปรไฟล์ผู้ใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
      }

      if (profileData.status !== 'active') {
        await supabase.auth.signOut();
        setUser(null);
        return {
          error:
            profileData.status === 'pending'
              ? 'บัญชียังไม่ได้รับการอนุมัติ กรุณารอเจ้าของระบบหรือผู้ดูแลอนุมัติ'
              : 'บัญชีถูกระงับ กรุณาติดต่อผู้ดูแลระบบ',
        };
      }
    }

    return { error: null };
  }

  async function register(email: string, password: string, username: string): Promise<{ error: string | null }> {
    // ตรวจสอบก่อนว่ามี username นี้ถูกใช้ไปแล้วหรือยัง (ผ่าน RPC เพื่อไม่ให้ติด RLS) - เผื่อกรณีเลือกใช้ตัวเดโมอยู่ แต่สมัครสมาชิกจะวิ่งเข้าระบบหลักเสมอ
    const { data: usernameExists } = await productionSupabase
      .rpc('check_username_exists', { p_username: username });

    if (usernameExists) {
      return { error: 'Username นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น' };
    }

    const { error } = await productionSupabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          user_name: username,
          display_name: username
        }
      }
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<{ error: string | null }> {
    if (!user) {
      return { error: 'ไม่พบข้อมูลผู้ใช้งาน' };
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return { error: error.message };
      }

      if (profile) {
        await logAudit(profile, 'user_profiles', 'update', profile.id, 'เปลี่ยนรหัสผ่าน', null);
      }
      return { error: null };
    } catch (err: any) {
      return { error: err?.message || 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน' };
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, register, logout, refreshProfile, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
