// src/app/users/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useAuth, UserProfile, UserRole, UserStatus } from '../../context/AuthContext';
import { canManageUsers } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { logAudit, describeChanges } from '../../lib/audit';

const roleLabels: Record<UserRole, string> = {
  admin: 'ผู้ดูแลระบบสูงสุด',
  owner: 'เจ้าของหอพัก',
  staff: 'พนักงาน',
  viewer: 'ผู้เข้าชมข้อมูล',
};

const statusLabels: Record<UserStatus, string> = {
  pending: 'รออนุมัติ',
  active: 'ปกติ',
  disabled: 'ระงับการใช้งาน',
};

const pageList = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'rooms', name: 'ผังห้องพัก' },
  // { key: 'available_rooms', name: 'ห้องจองได้' },
  { key: 'waitlists', name: 'จองไม่ระบุห้อง' },
  { key: 'bookings', name: 'การจองระบุห้อง' },
  { key: 'renewal_check', name: 'สอบถามต่อสัญญา' },
];

const buildPagePermission = (pageKey: string, mode: 'view' | 'edit' | 'delete') => `${pageKey}:${mode}`;

const hasPagePermission = (perms: string[] = [], pageKey: string, mode: 'view' | 'edit' | 'delete') => {
  if (mode === 'view') {
    return (
      perms.includes(pageKey) ||
      perms.includes(buildPagePermission(pageKey, 'view')) ||
      perms.includes(buildPagePermission(pageKey, 'edit'))
    );
  }
  if (mode === 'edit') {
    return perms.includes(buildPagePermission(pageKey, 'edit'));
  }
  // delete
  if (mode === 'delete') {
    return perms.includes(buildPagePermission(pageKey, 'delete'));
  }
  return false;
};

export default function UsersManagementPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(null);

  // ดึงข้อมูลผู้ใช้งานทั้งหมด
  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      // หากผู้ใช้ปัจจุบันเป็น owner ให้กรองไม่ให้เห็นผู้ใช้ที่เป็น admin
      if (profile?.role === 'owner') {
        setUsers((data as UserProfile[]).filter((u) => u.role !== 'admin'));
      } else {
        setUsers(data as UserProfile[]);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (profile && canManageUsers(profile.role)) {
      fetchUsers();
    }
  }, [profile]);

  // ป้องกันการเข้าถึงสำหรับผู้ไม่มีสิทธิ์
  if (!profile || !canManageUsers(profile.role)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold text-[#0A2647] mb-2">ไม่มีสิทธิ์เข้าถึง</h2>
        <p className="text-slate-500">เฉพาะผู้ดูแลระบบหรือเจ้าของหอพักเท่านั้นที่สามารถจัดการข้อมูลผู้ใช้ได้</p>
      </div>
    );
  }

  // อัพเดทบทบาท (Role)
  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    setActionLoading(userId);
    let initialPerms: string[] = [];
    
    if (newRole === 'staff') {
      // Staff ได้สิทธิ์แก้ไขและดูทั้งหมด
      initialPerms = pageList.flatMap(page => [
        buildPagePermission(page.key, 'view'),
        buildPagePermission(page.key, 'edit'),
      ]);
    }
    // viewer ไม่มี page_permissions (ดูได้ทั้งหมดจากบทบาท แต่แก้ไขไม่ได้)
    
    const updatePayload = { role: newRole, page_permissions: initialPerms };
    const { error } = await supabase
      .from('user_profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (!error) {
      await logAudit(profile, 'user_profiles', 'update', userId, 'อัปเดตบทบาทผู้ใช้', describeChanges(updatePayload));
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole, page_permissions: initialPerms } : u))
      );
      // หากกำลังแก้ไข permission ของคนนี้อยู่ให้ปิดหรืออัพเดท
      if (selectedStaff?.id === userId) {
        setSelectedStaff(null);
      }
    }
    setActionLoading(null);
  };

  // อัพเดทสถานะ (Status)
  const handleUpdateStatus = async (userId: string, newStatus: UserStatus) => {
    setActionLoading(userId);
    const updatePayload = { status: newStatus };
    const { error } = await supabase
      .from('user_profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (!error) {
      await logAudit(profile, 'user_profiles', 'update', userId, 'อัปเดตสถานะผู้ใช้', describeChanges(updatePayload));
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, status: newStatus } : u))
      );
    }
    setActionLoading(null);
  };

  // อัพเดทสิทธิ์หน้าของ Staff
  const handleTogglePermission = async (
    staffId: string,
    pageKey: string,
    mode: 'view' | 'edit' | 'delete',
    currentPerms: string[]
  ) => {
    let newPerms = [...currentPerms];
    const viewKey = buildPagePermission(pageKey, 'view');
    const editKey = buildPagePermission(pageKey, 'edit');
    const deleteKey = buildPagePermission(pageKey, 'delete');
    const hasView = hasPagePermission(newPerms, pageKey, 'view');
    const hasEdit = hasPagePermission(newPerms, pageKey, 'edit');

    if (mode === 'view') {
      if (hasView) {
        newPerms = newPerms.filter((p) => p !== pageKey && p !== viewKey && p !== editKey);
      } else {
        if (!newPerms.includes(viewKey)) newPerms.push(viewKey);
      }
    } else if (mode === 'edit') {
      if (hasEdit) {
        newPerms = newPerms.filter((p) => p !== editKey);
      } else {
        if (!newPerms.includes(viewKey)) newPerms.push(viewKey);
        if (!newPerms.includes(editKey)) newPerms.push(editKey);
      }
    } else if (mode === 'delete') {
      // toggle delete permission; ensure view exists when granting delete
      const hasDelete = hasPagePermission(newPerms, pageKey, 'delete');
      if (hasDelete) {
        newPerms = newPerms.filter((p) => p !== deleteKey);
      } else {
        if (!newPerms.includes(viewKey)) newPerms.push(viewKey);
        if (!newPerms.includes(deleteKey)) newPerms.push(deleteKey);
      }
    }

    const updatePayload = { page_permissions: newPerms };
    const { error } = await supabase
      .from('user_profiles')
      .update(updatePayload)
      .eq('id', staffId);

    if (!error) {
      await logAudit(profile, 'user_profiles', 'update', staffId, 'อัปเดตสิทธิ์การเข้าถึงของพนักงาน', describeChanges(updatePayload));
      setUsers((prev) =>
        prev.map((u) => (u.id === staffId ? { ...u, page_permissions: newPerms } : u))
      );
      if (selectedStaff?.id === staffId) {
        setSelectedStaff((prev) => (prev ? { ...prev, page_permissions: newPerms } : null));
      }
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0A2647]">จัดการสิทธิ์และผู้ใช้งาน</h1>
          <p className="text-slate-500 mt-1">อนุมัติผู้ใช้งานใหม่ กำหนดบทบาท และสิทธิ์การเข้าถึงแต่ละหน้า</p>
        </div>
        <button
          onClick={fetchUsers}
          className="self-start px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-2xl shadow-sm hover:bg-slate-50 active:bg-slate-100 transition-all flex items-center gap-2 cursor-pointer"
        >
          🔄 Refresh
        </button>
      </div>

      {loading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* List Section */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold text-sm">
                      <th className="py-4 px-6">ผู้ใช้งาน</th>
                      <th className="py-4 px-6">บทบาท</th>
                      <th className="py-4 px-6">สถานะ</th>
                      <th className="py-4 px-6 text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          ไม่พบข้อมูลผู้ใช้งานในระบบ
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => {
                        const isSelf = user.id === profile.id;
                        const isUserAdmin = user.role === 'admin';
                        const isPending = user.status === 'pending';
                        const avatarChar = (user.user_name || 'U').charAt(0).toUpperCase();
                        const isStaff = user.role === 'staff';

                        return (
                          <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                                  {avatarChar}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-800 truncate flex items-center gap-1.5">
                                    {user.user_name}
                                    {isSelf && (
                                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                                        ตัวคุณ
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-400 truncate">{user.email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              {isSelf || (profile.role === 'owner' && isUserAdmin) ? (
                                <span className="text-sm text-slate-700 font-medium">{roleLabels[user.role]}</span>
                              ) : (
                                <select
                                  value={user.role}
                                  onChange={(e) => handleUpdateRole(user.id, e.target.value as UserRole)}
                                  disabled={actionLoading === user.id}
                                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#4F81FF]"
                                >
                                  <option value="owner">{roleLabels.owner}</option>
                                  <option value="staff">{roleLabels.staff}</option>
                                  <option value="viewer">{roleLabels.viewer}</option>
                                </select>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              <span
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                                  user.status === 'active'
                                    ? 'bg-green-50 text-green-700 border border-green-100'
                                    : user.status === 'pending'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-100 animate-pulse'
                                    : 'bg-red-50 text-red-700 border border-red-100'
                                }`}
                              >
                                {statusLabels[user.status]}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {isStaff && (
                                  <button
                                    onClick={() => setSelectedStaff(user)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                      selectedStaff?.id === user.id
                                        ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                    ⚙️ จัดการสิทธิ์หน้า
                                  </button>
                                )}

                                {!isSelf && !(profile.role === 'owner' && isUserAdmin) && (
                                  <>
                                    {isPending ? (
                                      <button
                                        onClick={() => handleUpdateStatus(user.id, 'active')}
                                        disabled={actionLoading === user.id}
                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow active:scale-95 transition-all cursor-pointer"
                                      >
                                        Approve
                                      </button>
                                    ) : user.status === 'active' ? (
                                      <button
                                        onClick={() => handleUpdateStatus(user.id, 'disabled')}
                                        disabled={actionLoading === user.id}
                                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                                      >
                                        ระงับการใช้งาน
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleUpdateStatus(user.id, 'active')}
                                        disabled={actionLoading === user.id}
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                                      >
                                        เปิดใช้งานใหม่
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Granular Permission Panel (for Selected Staff) */}
          <div className="lg:col-span-1">
            {selectedStaff ? (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-6 sticky top-6">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg text-[#0A2647]">สิทธิ์การเข้าถึงเมนู</h3>
                    <button
                      onClick={() => setSelectedStaff(null)}
                      className="text-slate-400 hover:text-slate-600 text-sm"
                    >
                      ปิด ✕
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    กำหนดหน้าเว็บที่ <span className="font-bold text-slate-600">{selectedStaff.user_name}</span> สามารถเปิดดูและใช้งานได้
                  </p>
                </div>

                <div className="space-y-3">
                  {pageList.map((page) => {
                    const canView = hasPagePermission(selectedStaff.page_permissions || [], page.key, 'view');
                    const canEdit = hasPagePermission(selectedStaff.page_permissions || [], page.key, 'edit');
                    return (
                      <div
                        key={page.key}
                        className={`rounded-2xl border px-4 py-3 transition-all ${
                          canView
                            ? 'bg-indigo-50/50 border-indigo-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{page.name}</div>
                            <div className="text-[11px] text-slate-500 mt-1">{canEdit ? 'แก้ไขได้และดูได้' : canView ? 'ดูได้อย่างเดียว' : 'ยังไม่ได้รับสิทธิ์'}</div>
                          </div>

                          <div className="flex items-center gap-3">
                            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm cursor-pointer hover:border-slate-300">
                              <input
                                type="checkbox"
                                checked={canView}
                                onChange={() =>
                                  handleTogglePermission(
                                    selectedStaff.id,
                                    page.key,
                                    'view',
                                    selectedStaff.page_permissions || []
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                              />
                              ดูได้
                            </label>

                            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm cursor-pointer hover:border-slate-300">
                              <input
                                type="checkbox"
                                checked={canEdit}
                                onChange={() =>
                                  handleTogglePermission(
                                    selectedStaff.id,
                                    page.key,
                                    'edit',
                                    selectedStaff.page_permissions || []
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                              />
                              แก้ไขได้
                            </label>
                            
                              {(page.key === 'waitlists' || page.key === 'bookings') && (
                                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm cursor-pointer hover:border-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={hasPagePermission(selectedStaff.page_permissions || [], page.key, 'delete')}
                                    onChange={() =>
                                      handleTogglePermission(
                                        selectedStaff.id,
                                        page.key,
                                        'delete',
                                        selectedStaff.page_permissions || []
                                      )
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                  />
                                  ลบได้
                                </label>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-3xl border border-dashed border-slate-200 p-8 text-center text-slate-400 sticky top-6">
                <span className="text-4xl block mb-3">⚙️</span>
                เลือกพนักงาน (Staff) ในตารางเพื่อตั้งค่าสิทธิ์การเข้าใช้งานแต่ละหน้าเว็บ
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
