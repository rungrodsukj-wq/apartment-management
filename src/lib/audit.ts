'use client';

import { supabase } from './supabase';
import { UserProfile } from '../context/AuthContext';

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'password_change';

export interface AuditPayload {
  table_name: string;
  action: AuditAction;
  resource_id: string | null;
  resource_type: string;
  performed_by_id: string | null;
  performed_by_name: string | null;
  performed_at: string;
  description: string;
  changes?: string | null;
}

export async function logAudit(
  profile: UserProfile | null,
  tableName: string,
  action: AuditAction,
  resourceId: string | null,
  description: string,
  changes?: Record<string, any> | string | null
) {
  const payload: AuditPayload = {
    table_name: tableName,
    action,
    resource_id: resourceId,
    resource_type: tableName,
    performed_by_id: profile?.id ?? null,
    performed_by_name: profile?.user_name ?? null,
    performed_at: new Date().toISOString(),
    description,
    changes: typeof changes === 'string' ? changes : changes ? JSON.stringify(changes) : null,
  };

  const { error } = await supabase.from('audit_logs').insert([payload]);
  if (error) {
    // ถ้าไม่มีตาราง audit_logs หรือเกิด error ไม่ให้ล่มทั้งระบบ
    console.warn('Audit log not saved:', error.message);
  }
}

export function describeChanges(payload: Record<string, any>) {
  const keys = Object.keys(payload).filter((key) => key !== 'updated_at' && key !== 'created_at');
  if (keys.length === 0) return 'ไม่มีการเปลี่ยนแปลงที่ระบุได้';
  return `แก้ไข ${keys.join(', ')}`;
}
