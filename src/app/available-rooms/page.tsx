'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { isOverlap, isRoomAvailable } from '../../lib/availability';

const pad = (value: number) => String(value).padStart(2, '0');

export default function AvailableRoomsPage() {
    const [rooms, setRooms] = useState<any[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);
    const [waitlists, setWaitlists] = useState<any[]>([]);
    const [intentions, setIntentions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);

    // Default to next month
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2);

    useEffect(() => {
        if (new Date().getMonth() + 2 > 12) {
            setSelectedYear(new Date().getFullYear() + 1);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        const [{ data: rData }, { data: cData }, { data: wData }, { data: iData }] = await Promise.all([
            supabase.from('rooms').select('*').order('room_number'),
            supabase.from('contracts').select('*').neq('status', 'cancelled'),
            supabase.from('waitlists').select('*').neq('status', 'จัดสรรห้องแล้ว'),
            supabase.from('renewal_intentions').select('*'),
        ]);

        if (rData) setRooms(rData);
        if (cData) setContracts(cData);
        if (wData) setWaitlists(wData);
        if (iData) setIntentions(iData);
        setLoading(false);
    }

    // เปลี่ยนฟังก์ชันคำนวณวันสิ้นสุด โดยกำหนดเป็นแบบเลข Local Time
    const calculateEndDate = (year: number, month: number) => {
        // เดือนใน Date ของ JS จะเป็น 0-indexed (ม.ค. = 0) ดังนั้นต้อง -1 
        const end = new Date(year + 1, month - 1, 1); // ตั้งต้นเป็นวันที่ 1 ของเดือนเดิมในปีถัดไป
        end.setDate(end.getDate() - 1); // ถอยหลัง 1 วัน จะได้วันสุดท้ายของเดือนก่อนหน้าพอดี
        return end.toISOString().split('T')[0];
    };

    // แก้ไขฟังก์ชันแปลงวันที่ไทย เพื่อป้องกันปัญหา Timezone เพี้ยนจาก String ISO
    const formatDateTH = (dateStr: string) => {
        if (!dateStr || dateStr === '2000-01-01' || dateStr === '2099-12-31') return null;
        
        // แยกชิ้นส่วนข้อความ "YYYY-MM-DD" ออกมาสร้างด้วยตัวเลข
        const [y, m, d] = dateStr.split('-').map(Number);
        const localDate = new Date(y, m - 1, d); // ใช้ Local Time ของเครื่องเสมอ
        
        return localDate.toLocaleDateString('th-TH', {
            day: 'numeric', month: 'short', year: '2-digit'
        });
    };

    const roomsL = rooms.filter(r => r.building === 'L');

    const checkStart = `${selectedYear}-${pad(selectedMonth)}-01`;
    // ส่งเลข ปี และ เดือน เข้าไปคำนวณแทนการส่ง String ISO
    const checkEnd = calculateEndDate(selectedYear, selectedMonth);

    const lockedRoomIds = useMemo(() => {
        const locked = new Set<string>();

        const byContract: Record<string, any> = {};
        intentions.forEach(i => { if (i.contract_id) byContract[i.contract_id] = i; });

        const nonLockIntents = ['not_renew', 'renew_no_room'];

        for (const c of contracts) {
            const roomIds = [c.main_room_id, c.temp_room_id, c.move_to_room_id].filter(Boolean) as string[];
            if (roomIds.length === 0) continue;

            const endDate = c.contract_end_date || c.main_end_date || c.temp_end_date || c.move_end_date;
            if (!endDate) continue;
            if (endDate < checkStart) continue;

            const intent = byContract[c.id];
            if (!intent || !nonLockIntents.includes(intent.intention)) {
                roomIds.forEach(rid => locked.add(rid));
            }
        }

        for (const intent of intentions) {
            if (intent.room_id) {
                if (!intent.intention || !nonLockIntents.includes(intent.intention)) locked.add(intent.room_id);
            }
        }

        return locked;
    }, [intentions, contracts, checkStart]);

    const overlappingWaitlists = waitlists.filter(w => {
        if (!w.start_date) return false;
        
        const waitlistDate = new Date(w.start_date);
        const targetDate = new Date(checkStart);
        
        // 🎯 แปลงให้อยู่ในรูป "จำนวนเดือนสะสม" เพื่อเทียบเดือนและปี
        const wValue = waitlistDate.getFullYear() * 12 + waitlistDate.getMonth(); // เดือนของคิวจอง
        const tValue = targetDate.getFullYear() * 12 + targetDate.getMonth();   // เดือนของรอบบิลที่เลือกดู
        
        // ให้คืนค่า true เฉพาะคิวจองที่ตรงกับเดือนและปีของรอบบิลที่เลือกพอดีเท่านั้น
        return wValue === tValue;
    });

    const matrixData = useMemo(() => {
        const rowTypes = [
            { key: 'One Bedroom', display: 'ONE BEDROOM' },
            { key: 'One Bedroom Exclusive', display: 'ONE BED EXCLUSIVE' },
            { key: 'One Bedroom Suite', display: 'ONE BED SUITE' },
            { key: 'Triple Bedroom', display: 'TRIPLE BEDROOM' }
        ];

        const availableRooms = roomsL.filter(r => isRoomAvailable(contracts, intentions, r.id, checkStart, checkEnd) && !lockedRoomIds.has(r.id));

        return rowTypes.map(rt => {
            const rOfType = roomsL.filter(r => r.room_type === rt.key);
            const wOfType = overlappingWaitlists.filter(w => w.room_type === rt.key);

            const getCellData = (kitchen: string | null, view: string | null) => {
                const isUnspecifiedColumn = kitchen === null && view === null;
                
                if (isUnspecifiedColumn) {
                    const total = rOfType.filter(r => !r.kitchen_type && !r.view_direction).length;
                    const physicalAvailable = availableRooms.filter(r => r.room_type === rt.key && !r.kitchen_type && !r.view_direction).length;
                    
                    const waitlistMatches = wOfType.filter(w => {
                        const k = w.kitchen_type;
                        const v = w.view_preference;
                        const isFullySpecific = (k === 'ครัวหน้า' || k === 'ครัวหลัง') && (v === 'ทิศตะวันตก' || v === 'ทิศตะวันออก');
                        return !isFullySpecific;
                    }).length;

                    const net = physicalAvailable - waitlistMatches;
                    return { total, available: physicalAvailable, waitlist: waitlistMatches, net };
                }

                const total = rOfType.filter(r => (r.kitchen_type || null) === kitchen && (r.view_direction || null) === view).length;
                const physicalAvailable = availableRooms.filter(r => r.room_type === rt.key && (r.kitchen_type || null) === kitchen && (r.view_direction || null) === view).length;
                
                const waitlistMatches = wOfType.filter(w => (w.kitchen_type || null) === kitchen && (w.view_preference || null) === view).length;
                
                const net = physicalAvailable - waitlistMatches;
                return { total, available: physicalAvailable, waitlist: waitlistMatches, net };
            };

            const totalAvailable = availableRooms.filter(r => r.room_type === rt.key).length;
            const netQuota = totalAvailable - wOfType.length; 

            return {
                ...rt,
                waitlistCount: wOfType.length,
                totalAvailable,
                netQuota,
                frontWest: getCellData('ครัวหน้า', 'ทิศตะวันตก'),
                frontEast: getCellData('ครัวหน้า', 'ทิศตะวันออก'),
                backWest: getCellData('ครัวหลัง', 'ทิศตะวันตก'),
                backEast: getCellData('ครัวหลัง', 'ทิศตะวันออก'),
                unspecified: getCellData(null, null),
            };
        });
    }, [rooms, contracts, waitlists, checkStart, checkEnd, roomsL, lockedRoomIds]);

    const monthsTH = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear + 1, currentYear + 2];

    const totalAvailablePhysical = matrixData.reduce((acc, row) => acc + row.totalAvailable, 0);
    const totalWaitlists = matrixData.reduce((acc, row) => acc + row.waitlistCount, 0);
    const totalNetQuota = matrixData.reduce((acc, row) => acc + row.netQuota, 0);

    return (
        <>
            {/* Import Google Font K2D */}
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://fonts.googleapis.com/css2?family=K2D:wght@300;400;500;600;700;800&display=swap');
            ` }} />

            {/* Set Font Family to the main wrapper */}
            <div className="min-h-full flex flex-col bg-transparent" style={{ fontFamily: "'K2D', sans-serif" }}>
                <div className="flex-1 p-8 md:p-10">

                    {/* Date Picker Card */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 mb-8 max-w-2xl">
                        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-[#4F81FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            เลือกรอบบิลเดือนที่ลูกค้าต้องการเข้าพัก
                        </h2>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 mb-2">เดือน</label>
                                <select
                                    className="w-full bg-slate-50 border border-black rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 outline-none transition-all cursor-pointer font-medium"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                >
                                    {monthsTH.map((m, i) => (
                                        <option key={i} value={i + 1}>{m}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 mb-2">ปี (ค.ศ.)</label>
                                <select
                                    className="w-full bg-slate-50 border border-black rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 outline-none transition-all cursor-pointer font-medium"
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                                >
                                    {years.map((y) => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-4 bg-slate-50 p-3 rounded-lg border border-slate-100 inline-block">
                            <span className="font-semibold text-slate-600">ระยะเวลาคำนวณ 1 ปี:</span> {formatDateTH(checkStart)} - {formatDateTH(checkEnd)}
                        </p>
                    </div>

                    {loading ? (
                        <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div></div>
                    ) : (
                        <>
                            {/* New Redesigned Locked rooms notice */}
                            {lockedRoomIds.size > 0 && (
                                <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-slate-200 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative overflow-hidden">
                                    {/* Accent Line */}
                                    <div className="absolute top-0 left-0 w-2 h-full bg-amber-400"></div>
                                    
                                    <div className="flex items-start sm:items-center gap-4 pl-3">
                                        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center shrink-0 border border-amber-100 shadow-inner">
                                            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-slate-800 flex flex-wrap items-center gap-2">
                                                ห้องถูกระงับการคำนวณชั่วคราว 
                                                <span className="bg-amber-100 text-amber-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
                                                    {lockedRoomIds.size} ห้อง
                                                </span>
                                            </h3>
                                            <p className="text-sm text-slate-500 mt-0.5">
                                                ระบบยังไม่นำมาคำนวณ เนื่องจากลูกบ้านยังไม่แจ้งความประสงค์ หรือกำลังดำเนินการต่อสัญญา
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <a href="/renewal-check" className="shrink-0 inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold px-6 py-3 rounded-xl transition-all shadow-sm w-full sm:w-auto justify-center group">
                                        จัดการสถานะสัญญา
                                        <svg className="w-4 h-4 text-slate-400 group-hover:text-[#4F81FF] group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                    </a>
                                </div>
                            )}

                            {/* KPI Widgets */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-6 opacity-10">
                                        <svg className="w-16 h-16 text-[#4F81FF]" fill="currentColor" viewBox="0 0 20 20"><path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z"></path><path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd"></path></svg>
                                    </div>
                                    <span className="text-sm font-bold text-slate-500 mb-2 relative z-10">ห้องว่างทั้งหมด (Physical)</span>
                                    <div className="relative z-10 flex items-baseline gap-2">
                                        <span className="text-4xl font-black text-[#4F81FF]">{totalAvailablePhysical}</span>
                                        <span className="text-sm font-medium text-slate-400">ห้อง</span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setShowWaitlistModal(true)}
                                    className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col relative overflow-hidden text-left hover:bg-slate-50 transition-colors cursor-pointer"
                                    aria-expanded={showWaitlistModal}
                                    title="ดูรายละเอียดคิวจองล่วงหน้า"
                                >
                                    <div className="absolute top-0 right-0 p-6 opacity-10">
                                        <svg className="w-16 h-16 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"></path><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"></path></svg>
                                    </div>
                                    <span className="text-sm font-bold text-slate-500 mb-2 relative z-10">คิวจองล่วงหน้า (Waitlists)</span>
                                    <div className="relative z-10 flex items-baseline gap-2">
                                        <span className="text-4xl font-black text-amber-500">{totalWaitlists}</span>
                                        <span className="text-sm font-medium text-slate-400">คิว</span>
                                    </div>
                                </button>

                                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-6 opacity-10">
                                        <svg className={`w-16 h-16 ${totalNetQuota < 0 ? 'text-red-500' : 'text-emerald-500'}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd"></path></svg>
                                    </div>
                                    <span className="text-sm font-bold text-slate-500 mb-2 relative z-10">คงเหลือสุทธิ (Net Available)</span>
                                    <div className="relative z-10 flex items-baseline gap-2">
                                        <span className={`text-4xl font-black ${totalNetQuota < 0 ? 'text-red-500' : totalNetQuota === 0 ? 'text-slate-500' : 'text-emerald-500'}`}>
                                            {totalNetQuota}
                                        </span>
                                        <span className="text-sm font-medium text-slate-400">ห้อง</span>
                                    </div>
                                </div>
                            </div>

                            {showWaitlistModal && (
                                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                                    <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[80vh] overflow-auto shadow-2xl">
                                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                                            <h2 className="text-lg font-bold text-gray-900">รายละเอียดคิวจองล่วงหน้า</h2>
                                            <button onClick={() => setShowWaitlistModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                                        </div>

                                        <div className="p-4">
                                            <div className="mb-3 text-sm text-slate-500">รอบบิล: {monthsTH[selectedMonth - 1]} {selectedYear} — แสดง {overlappingWaitlists.length} คิว</div>
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full text-left text-sm text-slate-700 border-collapse">
                                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold">
                                                        <tr>
                                                            <th className="p-3 border-b border-slate-200">#</th>
                                                            <th className="p-3 border-b border-slate-200">ชื่อ</th>
                                                            <th className="p-3 border-b border-slate-200">ประเภทห้อง</th>
                                                            <th className="p-3 border-b border-slate-200">ครัว</th>
                                                            <th className="p-3 border-b border-slate-200">วิว</th>
                                                            <th className="p-3 border-b border-slate-200">วันที่เริ่ม</th>
                                                            <th className="p-3 border-b border-slate-200">วันที่สิ้นสุด</th>
                                                            <th className="p-3 border-b border-slate-200">สถานะ</th>
                                                            <th className="p-3 border-b border-slate-200">เมนู</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {overlappingWaitlists.map((w, idx) => (
                                                            <tr key={w.id} className="hover:bg-slate-50">
                                                                <td className="p-3 border-b border-slate-100 align-top">{idx + 1}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">
                                                                    <div className="font-bold">{w.name || '-'}</div>
                                                                    <div className="text-xs text-slate-400">ID: {w.id}</div>
                                                                </td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{w.room_type || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{w.kitchen_type || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{w.view_preference || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{formatDateTH(w.start_date) || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{formatDateTH(w.end_date) || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">{w.status || '-'}</td>
                                                                <td className="p-3 border-b border-slate-100 align-top">
                                                                    <a href={`/allocate/${w.id}`} className="text-sm font-bold text-blue-600 hover:underline">จัดสรร</a>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {overlappingWaitlists.length === 0 && (
                                                            <tr><td colSpan={9} className="p-6 text-center text-slate-400">ไม่มีคิวที่ตรงกับเงื่อนไขในรอบนี้</td></tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <h2 className="text-lg font-bold text-[#0A2647] mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-[#4F81FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                สรุปห้องว่าง (หักคิวจองล่วงหน้าแล้ว)
                            </h2>

                            <div className="bg-white rounded-[2rem] shadow-lg border border-slate-200 overflow-hidden mb-10">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-left text-sm text-slate-700 border-collapse border border-slate-200">
                                        <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase tracking-wider">
                                            <tr>
                                                <th rowSpan={3} className="p-4 bg-gradient-to-br from-slate-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center align-middle rounded-tl-[1.5rem]">
                                                    TYPE ROOM
                                                </th>
                                                <th rowSpan={3} className="p-4 bg-gradient-to-br from-amber-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center align-middle max-w-[150px]">
                                                    โควต้าจองไม่ระบุห้อง<br />(Waitlists ทั้งหมด)
                                                </th>
                                                <th colSpan={2} className="p-3 bg-gradient-to-br from-sky-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center">
                                                    ครัวหน้า
                                                </th>
                                                <th colSpan={2} className="p-3 bg-gradient-to-br from-rose-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center">
                                                    ครัวหลัง
                                                </th>
                                                <th rowSpan={3} className="p-4 bg-gradient-to-br from-purple-100 to-white text-slate-800 font-bold text-center align-middle rounded-tr-[1.5rem] border-slate-200">
                                                    ไม่ระบุ<br />ครัว/ทิศ
                                                </th>
                                            </tr>
                                            <tr>
                                                <th colSpan={2} className="p-2 bg-slate-100 text-slate-600 text-xs font-bold border-r border-slate-200 text-center">
                                                    View
                                                </th>
                                                <th colSpan={2} className="p-2 bg-slate-100 text-slate-600 text-xs font-bold border-r border-slate-200 text-center">
                                                    View
                                                </th>
                                            </tr>
                                            <tr>
                                                <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                    SALAYA ONE RESIDENCES<br />(ตะวันตก)
                                                </th>
                                                <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                    ซอยตั้งสิน<br />(ตะวันออก)
                                                </th>
                                                <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                    SALAYA ONE RESIDENCES<br />(ตะวันตก)
                                                </th>
                                                <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                    ซอยตั้งสิน<br />(ตะวันออก)
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white">
                                            {matrixData.map((row) => {
                                                const renderCell = (cell: any) => {
                                                    const isNegative = cell.net < 0;
                                                    const isZero = cell.net === 0;
                                                    const valueClass = isNegative ? 'text-red-500' : isZero ? 'text-slate-400' : 'text-[#4F81FF]';
                                                    return (
                                                        <td className="p-4 text-center align-top border border-slate-200">
                                                            <div className={`text-base font-black ${valueClass}`}>
                                                                {cell.net} <span className="text-xs font-normal text-slate-500">ห้อง</span>
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 mt-1">
                                                                (ว่าง {cell.available} / ทั้งหมด {cell.total})
                                                            </div>
                                                            {cell.waitlist > 0 && (
                                                                <div className="mt-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-700">
                                                                    -{cell.waitlist} waitlist
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                };

                                                return (
                                                    <tr key={row.key} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="p-4 font-bold text-slate-800 border border-slate-200 bg-slate-50/80 rounded-l-3xl">{row.display}</td>
                                                        <td className="p-4 border border-slate-200 text-center bg-slate-50/80">
                                                            <div className={`text-base font-black ${row.netQuota < 0 ? 'text-red-500' : row.netQuota === 0 ? 'text-slate-400' : 'text-emerald-600'}`}>
                                                                {row.netQuota} <span className="text-xs font-normal text-slate-500">ห้อง</span>
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                                (ว่าง {row.totalAvailable} / หักจองไม่ระบุห้อง {row.waitlistCount})
                                                            </div>
                                                        </td>
                                                        {renderCell(row.frontWest)}
                                                        {renderCell(row.frontEast)}
                                                        {renderCell(row.backWest)}
                                                        {renderCell(row.backEast)}
                                                    <td className="p-4 text-center align-top border border-slate-200 rounded-r-3xl bg-slate-50/30">
                                                        {row.unspecified.waitlist > 0 ? (
                                                            <div className="flex flex-col items-center justify-center h-full">
                                                                <div className="bg-purple-100 border border-purple-200 px-3 py-2 rounded-xl w-full">
                                                                    <div className="text-sm font-black text-purple-700">
                                                                        {row.unspecified.waitlist} <span className="text-xs font-normal text-purple-600">คิว</span>
                                                                    </div>
                                                                    <div className="text-[10px] text-purple-600 mt-1 font-bold">
                                                                        รอแอดมินจับคู่ห้องให้
                                                                    </div>
                                                                </div>
                                                                <div className="text-[10px] text-slate-400 mt-2">
                                                                    (นำไปหักลบในยอดรวมแล้ว)
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="text-slate-300 font-medium mt-2">-</div>
                                                        )}
                                                    </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}