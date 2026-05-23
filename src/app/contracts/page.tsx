//src/app/contracts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function BookingsManagePage() {
    const [bookings, setBookings] = useState<any[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<any>(null);

    const [waitlists, setWaitlists] = useState<any[]>([]);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        const { data: cData } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        const { data: wData } = await supabase.from('waitlists').select('*');

        if (cData) setBookings(cData);
        if (rData) setRooms(rData);
        if (wData) setWaitlists(wData);
        setLoading(false);
    }

    const getRoomNumber = (roomId: string) => {
        if (!roomId) return '-';
        const room = rooms.find(r => r.id === roomId);
        if (!room) return 'ไม่ทราบ';
        return `${room.room_number} ${room.room_type ? `(${room.room_type})` : ''}`;
    };

    const handleEditClick = (booking: any) => {
        setEditForm({
            ...booking,
            // TODO: removed field - temp_room_id (has_temp_room removed)
        });
        setIsEditModalOpen(true);
    };

    const handleAddClick = () => {
        setEditForm({
            name: '',
            status: 'active',
            actual_check_in_date: '',
            contract_start_date: '',
            contract_end_date: '',
            room_id: '',
        });
        setIsEditModalOpen(true);
    };

    const handleCancelBooking = async (bookingId: string) => {
        const confirmCancel = window.confirm('คุณแน่ใจหรือไม่ว่าต้องการ "ยกเลิก" Booking นี้?');
        if (!confirmCancel) return;

        const today = new Date().toISOString().split('T')[0];
        const actualCheckOutDate = window.prompt('กรุณาระบุ "วันที่ลูกค้าย้ายออกจริง" (YYYY-MM-DD):', today);

        if (!actualCheckOutDate) return;

        const { error } = await supabase
            .from('bookings')
            .update({ status: 'cancelled', actual_check_out_date: actualCheckOutDate })
            .eq('id', bookingId);

        if (error) {
            alert('เกิดข้อผิดพลาดในการยกเลิก: ' + error.message);
        } else {
            alert('ยกเลิก Booking เรียบร้อยแล้ว');
            fetchData();
        }
    };

    const handleRenewBooking = async (oldBooking: any) => {
        const confirmRenew = window.confirm(`ต้องการ "ต่อสัญญา" ให้คุณ ${oldBooking.name} ใช่หรือไม่?`);
        if (!confirmRenew) return;

        const newStartDate = new Date(oldBooking.contract_end_date);
        newStartDate.setDate(newStartDate.getDate() + 1);
        const newStartDateStr = newStartDate.toISOString().split('T')[0];

        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
        const newEndDateStr = newEndDate.toISOString().split('T')[0];

        const { error: insertError } = await supabase
            .from('bookings')
            .insert([{
                name: oldBooking.name,
                // TODO: removed field - parent_contract_id
                room_id: oldBooking.room_id,
                actual_check_in_date: newStartDateStr,
                contract_start_date: newStartDateStr,
                contract_end_date: newEndDateStr,
                status: 'active'
            }]);

        if (insertError) {
            alert('เกิดข้อผิดพลาด: ' + insertError.message);
        } else {
            await supabase.from('bookings').update({ status: 'completed' }).eq('id', oldBooking.id);
            alert('สร้าง Booking ใหม่เรียบร้อย!');
            fetchData();
        }
    };

    // TODO: removed field - move_start_date, main_end_date (handleMoveStartDateChange removed entirely)

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();

        // TODO: removed field - temp_room_id (temp room validation removed)

        const payload = {
            name: editForm.name,
            status: editForm.status,
            contract_start_date: editForm.contract_start_date,
            contract_end_date: editForm.contract_end_date,
            actual_check_in_date: editForm.actual_check_in_date,
            room_id: editForm.room_id,
        };

        if (editForm.id) {
            const { error } = await supabase.from('bookings').update(payload).eq('id', editForm.id);
            if (error) {
                alert('เกิดข้อผิดพลาด: ' + error.message);
            } else {
                setIsEditModalOpen(false);
                fetchData();
            }
        } else {
            const { error } = await supabase.from('bookings').insert([payload]);
            if (error) {
                alert('เกิดข้อผิดพลาด: ' + error.message);
            } else {
                alert('เพิ่ม Booking ใหม่เรียบร้อยแล้ว');
                setIsEditModalOpen(false);
                fetchData();
            }
        }
    };

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedDate = e.target.value;
        if (!selectedDate) {
            setEditForm({ ...editForm, contract_start_date: '' });
            return;
        }

        // บังคับให้เป็นวันที่ 1 ของเดือนเสมอ
        const [year, month] = selectedDate.split('-');
        const forcedStart = `${year}-${month}-01`;

        // คำนวณวันสิ้นสุด (1 ปีลบ 1 วัน เช่น 1 ม.ค. 67 -> 31 ธ.ค. 67)
        const start = new Date(forcedStart);
        const end = new Date(start);
        end.setFullYear(start.getFullYear() + 1);
        end.setDate(end.getDate() - 1);
        const newEnd = end.toISOString().split('T')[0];

        setEditForm({
            ...editForm,
            contract_start_date: forcedStart,
            actual_check_in_date: forcedStart, // เด้งวันเข้าอยู่ให้เป็นวันเดียวกัน
            contract_end_date: newEnd          // เด้งวันสิ้นสุด 1 ปี
        });
    };

    const isOverlap = (start1: string, end1: string, start2: string, end2: string) => {
        if (!start1 || !end1 || !start2 || !end2) return false;
        return new Date(start1) < new Date(end2) && new Date(start2) < new Date(end1);
    };

    const isRoomAvailable = (roomId: string, checkStart: string, checkEnd: string, currentBookingId: string) => {
        if (!checkStart || !checkEnd) return true;
        for (const c of bookings) {
            if (c.id === currentBookingId || c.status === 'cancelled') continue;
            if (c.room_id === roomId && isOverlap(checkStart, checkEnd, c.contract_start_date, c.contract_end_date)) return false;
            // TODO: removed field - temp_room_id, temp_start_date, temp_end_date (overlap check removed)
            // TODO: removed field - move_to_room_id, move_start_date, move_end_date (overlap check removed)
        }
        return true;
    };

    const getRoomOccupancyIntervals = (roomId: string, currentBookingId: string) => {
        const intervals: { start: Date, end: Date }[] = [];
        bookings.forEach(c => {
            if (c.id === currentBookingId || c.status === 'cancelled') return;
            if (c.room_id === roomId) {
                const s = c.actual_check_in_date || c.contract_start_date;
                const e = c.actual_check_out_date || c.contract_end_date;
                if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
            }
        });
        return intervals;
    };

    const getRoomAvailabilityText = (roomId: string, targetDateStr: string, currentBookingId: string) => {
        const intervals = getRoomOccupancyIntervals(roomId, currentBookingId);

        intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
        const merged: { start: Date, end: Date }[] = [];
        intervals.forEach(curr => {
            if (merged.length === 0) {
                merged.push({ ...curr });
            } else {
                const prev = merged[merged.length - 1];
                if (curr.start <= prev.end) {
                    if (curr.end > prev.end) prev.end = curr.end;
                } else {
                    merged.push({ ...curr });
                }
            }
        });

        let availableFrom: Date;
        let availableUntil: Date | null = null;
        const target = new Date(targetDateStr || new Date().toISOString());

        const overlapping = merged.find(i => target >= i.start && target < i.end);

        if (overlapping) {
            availableFrom = new Date(overlapping.end);
            const next = merged.find(i => i.start > availableFrom);
            availableUntil = next ? new Date(next.start) : null;
        } else {
            const prev = [...merged].reverse().find(i => i.end <= target);
            availableFrom = prev ? new Date(prev.end) : new Date(0);
            const next = merged.find(i => i.start > target);
            availableUntil = next ? new Date(next.start) : null;
        }

        const formatD = (d: Date) => d.toLocaleDateString('en-GB');
        const fromStr = availableFrom.getTime() === 0 || availableFrom <= new Date() ? 'ปัจจุบัน' : formatD(availableFrom);
        const untilStr = availableUntil ? formatD(availableUntil) : 'ไม่มีกำหนด';

        return `${fromStr} - ${untilStr}`;
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'active':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">ACTIVE</span>;
            case 'completed':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200/60">COMPLETED</span>;
            case 'cancelled':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 border border-red-200/60">CANCELLED</span>;
            default:
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">{status.toUpperCase()}</span>;
        }
    };

    // Input field shared class
    const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all";
    const labelCls = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2";

    return (
        <div className="min-h-full flex flex-col bg-[#F0F4F8]">
            <div className="flex-1 p-8 md:p-10">

                {/* Header */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-[28px] font-bold text-[#0A2647] tracking-tight">จัดการ Booking</h1>
                        <p className="text-sm text-slate-500 mt-1">จัดการ Booking และการจัดสรรห้องของลูกบ้านทั้งหมด</p>
                    </div>
                    <button onClick={handleAddClick} className="bg-[#4F81FF] hover:bg-[#3D6CE5] text-white px-6 py-3 rounded-2xl font-medium shadow-lg shadow-blue-500/25 flex items-center gap-2 transition-all active:scale-95">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        เพิ่ม Booking ใหม่
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center text-2xl">📄</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Booking ทั้งหมด</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{bookings.length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">🟢</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Booking Active</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{bookings.filter(c => c.status === 'active').length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center text-2xl">⚠️</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">ต้องดำเนินการ</p>
                            <p className="text-2xl font-bold text-[#0A2647]">
                                {bookings.filter(c => !c.room_id && c.status !== 'cancelled').length}{' '}
                                <span className="text-sm font-medium text-slate-500">รายการ</span>
                            </p>
                        </div>
                    </div>
                </div>

                <h2 className="text-lg font-bold text-[#0A2647] mb-4">รายการ Booking</h2>

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {bookings.map((booking) => {
                            // TODO: removed field - main_start_date, temp_room_id (needsTempRoom logic removed)
                            const missingRoom = !booking.room_id;

                            return (
                                <div
                                    key={booking.id}
                                    className={`bg-white rounded-2xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)] border border-slate-100 transition-all group ${booking.status === 'cancelled' ? 'opacity-60' : ''}`}
                                >
                                    {/* Avatar */}
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0 font-bold text-lg hidden md:flex">
                                        {booking.name?.charAt(0) || '?'}
                                    </div>

                                    {/* Content grid */}
                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">

                                        {/* Name + status */}
                                        <div className="md:col-span-3">
                                            <h3 className="text-base font-bold text-slate-800">{booking.name}</h3>
                                            <div className="mt-1">{getStatusBadge(booking.status)}</div>
                                        </div>

                                        {/* Timeline tags */}
                                        <div className="md:col-span-5 flex flex-wrap gap-2">
                                            {/* TODO: removed field - temp_room_id (needsTempRoom alert removed) */}
                                            {/* TODO: removed field - temp_room_id (temp room display tag removed) */}
                                            {missingRoom ? (
                                                <span className="bg-amber-50 text-amber-700 border border-amber-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                    ⚠️ ยังไม่ระบุห้อง
                                                </span>
                                            ) : (
                                                <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                    🔑 {getRoomNumber(booking.room_id)}
                                                </span>
                                            )}
                                        </div>

                                        {/* Check-in date */}
                                        <div className="md:col-span-4">
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">วันเข้าพักจริง</p>
                                            <p className="text-xs text-slate-700 font-medium bg-slate-50 inline-block px-3 py-1.5 rounded-lg border border-slate-100">
                                                {booking.actual_check_in_date
                                                    ? new Date(booking.actual_check_in_date).toLocaleDateString('en-GB')
                                                    : '-'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-2 md:pl-6 md:border-l border-slate-100 pt-3 md:pt-0 border-t md:border-t-0 mt-3 md:mt-0">
                                        <button
                                            onClick={() => handleEditClick(booking)}
                                            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-[#4F81FF] transition-colors"
                                            title="แก้ไข"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                        </button>

                                        {booking.status !== 'cancelled' && (
                                            <>
                                                <button
                                                    onClick={() => handleRenewBooking(booking)}
                                                    className="bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 px-4 py-2 rounded-xl text-sm font-semibold ml-1 transition-all flex items-center gap-1.5"
                                                >
                                                    ต่อสัญญา <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                </button>
                                                <button
                                                    onClick={() => handleCancelBooking(booking.id)}
                                                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                                    title="ยกเลิก Booking"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {bookings.length === 0 && (
                            <div className="text-center py-20 text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center">
                                <div className="text-5xl mb-4">📭</div>
                                <p className="font-medium text-lg text-slate-600">ยังไม่มี Booking</p>
                                <p className="text-sm mt-1">Booking จะปรากฏที่นี่หลังจากจัดสรรห้องเรียบร้อยแล้ว</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Edit Modal ─── */}
            {isEditModalOpen && editForm && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

                        {/* Modal header */}
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">{editForm.id ? 'แก้ไข Booking' : 'เพิ่ม Booking ใหม่'}</h2>
                                {editForm.id && (() => {
                                    const pref = waitlists.find(w => w.name === editForm.name) || {};
                                    return (
                                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                            <p className="text-sm text-slate-500">
                                                ผู้เช่า: <span className="text-[#4F81FF] font-bold">{editForm.name}</span>
                                            </p>
                                            {pref.room_type && (
                                                <span className="text-[11px] font-semibold bg-slate-50 text-slate-600 px-3 py-1 rounded-lg border border-slate-200/60">
                                                    {pref.room_type} | ครัว{pref.kitchen_type} | วิว{pref.view_preference}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="flex items-center gap-3">
                                {/* Status selector styled like tags */}
                                <select
                                    className={`border rounded-xl py-2 pl-3 pr-8 text-xs font-bold outline-none cursor-pointer transition-colors
                                        ${editForm.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            editForm.status === 'completed' ? 'bg-slate-50 text-slate-500 border-slate-200' :
                                                'bg-red-50 text-red-600 border-red-200'}`}
                                    value={editForm.status}
                                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                                >
                                    <option value="active">🟢 Active</option>
                                    <option value="completed">⚪ Completed</option>
                                    <option value="cancelled">🔴 Cancelled</option>
                                </select>

                                <button
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Modal body */}
                        <form id="edit-booking-form" onSubmit={handleSaveEdit} className="p-8 space-y-6 overflow-y-auto flex-1">

                            {/* Section 1: Customer details & Contract dates */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">1</span>
                                    ข้อมูลผู้เช่า & ระยะเวลาสัญญา
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                                    <div className="md:col-span-2">
                                        <label className={labelCls}>ชื่อผู้เช่า (Name) <span className="text-red-500">*</span></label>
                                        <input type="text" className={inputCls} required
                                            value={editForm.name || ''}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            placeholder="ระบุชื่อ-นามสกุลผู้เช่า"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    <div>
                                        <label className={labelCls}>วันเข้าพักจริง (Check-in)</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.actual_check_in_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, actual_check_in_date: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันเริ่มสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_start_date || ''}
                                            onChange={handleStartDateChange} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันสิ้นสุดสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_end_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, contract_end_date: e.target.value })} />
                                    </div>
                                </div>
                            </div>

                            {/* TODO: removed field - temp_room_id, temp_start_date, temp_end_date (Section 2: Temp room removed entirely) */}

                            {/* Section 2: Room */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">2</span>
                                    ห้องพัก (Room)
                                </p>
                                <div className="grid grid-cols-1 gap-5">
                                    <div>
                                        <label className={labelCls}>เลือกห้องพัก</label>
                                        {(!editForm.contract_start_date || !editForm.contract_end_date) ? (
                                            <div className="bg-amber-50 text-amber-700 p-4 rounded-xl text-sm border border-amber-200 flex items-center justify-center gap-2 font-medium">
                                                <span>⚠️</span> กรุณาระบุวันที่เข้าพักและสิ้นสุดสัญญา เพื่อค้นหาห้องว่าง
                                            </div>
                                        ) : (() => {
                                            const customerPref = waitlists.find(w => w.name === editForm.name);
                                            const availableRooms = rooms.filter(r => isRoomAvailable(r.id, editForm.contract_start_date, editForm.contract_end_date, editForm.id));

                                            if (availableRooms.length === 0) {
                                                return (
                                                    <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-200 flex items-center justify-center gap-2 font-medium">
                                                        <span>❌</span> ไม่มีห้องว่างในช่วงเวลานี้
                                                    </div>
                                                );
                                            }

                                            const renderRoomCard = (r: any) => {
                                                const availText = getRoomAvailabilityText(r.id, editForm.contract_start_date, editForm.id);
                                                return (
                                                    <div
                                                        key={r.id}
                                                        onClick={() => setEditForm({ ...editForm, room_id: r.id })}
                                                        className={`cursor-pointer border-2 rounded-xl p-3.5 transition-all group ${editForm.room_id === r.id ? 'border-[#4F81FF] bg-blue-50/50 shadow-md transform scale-[1.02]' : 'border-slate-100 bg-white hover:border-[#4F81FF]/40 hover:shadow-sm'}`}
                                                    >
                                                        <div className="flex justify-between items-start mb-3">
                                                            <span className={`font-black text-lg ${editForm.room_id === r.id ? 'text-[#4F81FF]' : 'text-slate-700 group-hover:text-[#4F81FF]'}`}>
                                                                ห้อง {r.room_number}
                                                            </span>
                                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${editForm.room_id === r.id ? 'bg-[#4F81FF] text-white shadow-sm' : 'bg-slate-100 text-transparent border border-slate-200 group-hover:border-[#4F81FF]/40'}`}>
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col gap-1.5">
                                                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                                <span>🛏️</span> <span className="truncate">{r.room_type || '-'}</span>
                                                            </div>
                                                            <div className="flex gap-1.5">
                                                                <div className="flex-1 flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                                    <span>🍳</span> ครัว{r.kitchen_type || '-'}
                                                                </div>
                                                                <div className="flex-1 flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                                    <span>🧭</span> วิว{r.view_direction || '-'}
                                                                </div>
                                                            </div>
                                                            <div className="mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 flex items-center gap-1.5 w-fit">
                                                                <span>📅</span> ว่าง: {availText}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            };

                                            if (!customerPref) {
                                                return (
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[280px] overflow-y-auto p-1">
                                                        {availableRooms.map(renderRoomCard)}
                                                    </div>
                                                );
                                            }

                                            const perfectMatchRooms = availableRooms.filter(r => {
                                                const isMatch = (prefVal: any, roomVal: any) => {
                                                    if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
                                                    return prefVal === roomVal;
                                                };
                                                return isMatch(customerPref.room_type, r.room_type)
                                                    && isMatch(customerPref.kitchen_type, r.kitchen_type)
                                                    && isMatch(customerPref.view_preference, r.view_direction);
                                            });
                                            const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

                                            return (
                                                <div className="max-h-[320px] overflow-y-auto p-1 space-y-5">
                                                    {perfectMatchRooms.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                                <span>⭐️</span> ตรงสเปกลูกค้า ({perfectMatchRooms.length})
                                                            </h4>
                                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                                {perfectMatchRooms.map(renderRoomCard)}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {otherRooms.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                                <span>🏢</span> ห้องว่างอื่นๆ ({otherRooms.length})
                                                            </h4>
                                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 opacity-90">
                                                                {otherRooms.map(renderRoomCard)}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    {/* TODO: removed field - main_start_date, main_end_date (Main room date inputs removed) */}
                                </div>
                            </div>

                            {/* TODO: removed field - move_to_room_id, move_start_date, move_end_date (Section 4: Move room removed entirely) */}
                        </form>

                        {/* Modal footer */}
                        <div className="px-8 py-5 border-t border-slate-100 flex gap-4 shrink-0">
                            <button
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="submit"
                                form="edit-booking-form"
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/30 transition-all"
                            >
                                บันทึกการเปลี่ยนแปลง
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}