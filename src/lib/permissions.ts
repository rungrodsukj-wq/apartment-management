// src/lib/permissions.ts
import { UserRole, UserProfile } from '../context/AuthContext';

export function canEdit(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return role === 'admin' || role === 'owner' || role === 'staff';
}

export function canManageUsers(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return role === 'admin' || role === 'owner';
}

const ADMIN_ONLY_PAGES = ['users', 'activity'];

export function isAdmin(role: UserRole | undefined | null): boolean {
  return role === 'admin';
}

const buildPagePermission = (pageKey: string, mode: 'view' | 'edit') => `${pageKey}:${mode}`;

export function hasPagePermission(
  profile: UserProfile | undefined | null,
  pageKey: string,
  mode: 'view' | 'edit'
): boolean {
  if (!profile) return false;
  if (ADMIN_ONLY_PAGES.includes(pageKey)) {
    return profile.role === 'admin' || profile.role === 'owner';
  }
  if (profile.role === 'admin' || profile.role === 'owner') return true;
  if (mode === 'view' && profile.role === 'viewer') return true;

  const perms = profile.page_permissions || [];

  if (mode === 'view') {
    return (
      perms.includes(pageKey) ||
      perms.includes(buildPagePermission(pageKey, 'view')) ||
      perms.includes(buildPagePermission(pageKey, 'edit'))
    );
  }

  return perms.includes(buildPagePermission(pageKey, 'edit'));
}

export function canAccessPage(profile: UserProfile | undefined | null, pageKey: string): boolean {
  return hasPagePermission(profile, pageKey, 'view');
}

export function canEditPage(profile: UserProfile | undefined | null, pageKey: string): boolean {
  return hasPagePermission(profile, pageKey, 'edit');
}
