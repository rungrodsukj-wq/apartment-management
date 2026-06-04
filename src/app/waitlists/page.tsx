//src/app/waitlists/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { canEditPage } from '../../lib/permissions';
import { logAudit, describeChanges } from '../../lib/audit';

interface Waitlist {
    id: string;
    name: string;
    room_type: string;
    kitchen_type: string;
    building?: string | null;
    floor?: number | null;
    view_preference: string;
    start_date: string;
    end_date: string;
    special_request: string;
    allocation_note?: string;
    bed_size: string; // เพิ่มฟิลด์ขนาดเตียง
    preferred_floors: number[]; // เพิ่มฟิลด์ชั้นที่ต้องการเป็น Array
    monthly_rent?: number; // เพิ่มราคาค่าเช่าต่อเดือน
    status?: string;
    contract_id?: string | null;
    queue_number?: number;
}

export default function BookingsPage() {
    const { profile } = useAuth();
    const isEditable = canEditPage(profile, 'waitlists');

    const router = useRouter();
    const [items, setItems] = useState<Waitlist[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [filterBuilding, setFilterBuilding] = useState('');
    const [filterFloor, setFilterFloor] = useState('');
    const [filterRoomType, setFilterRoomType] = useState('');
    const [filterKitchen, setFilterKitchen] = useState('');
    const [filterView, setFilterView] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [startDate, setStartDate] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        room_type: 'One Bedroom',
        kitchen_type: 'ครัวหลัง',
        view_preference: 'ทิศตะวันออก',
        bed_size: '3.5 ฟุต', // ค่าเริ่มต้นเตียง
        preferred_floors: [] as number[], // ค่าเริ่มต้นชั้น (Array ว่าง)
        start_date: '',
        end_date: '',
        special_request: '',
        monthly_rent: '' as string | number
    });

    const searchParams = useSearchParams();

    useEffect(() => {
        fetchWaitlist();
    }, []);

    useEffect(() => {
        if (isEditable && searchParams.get('quickAction') === 'newWaitlist') {
            const tenantName = searchParams.get('tenantName');
            const contractId = searchParams.get('contractId');
            
            const initializeForm = async () => {
                let newData = { 
                    name: '', 
                    room_type: 'One Bedroom',
                    kitchen_type: 'ครัวหลัง', 
                    view_preference: 'ทิศตะวันออก',
                    bed_size: '3.5 ฟุต', 
                    preferred_floors: [],
                    start_date: '', 
                    end_date: '', 
                    special_request: '',
                    monthly_rent: ''
                };
                
                if (tenantName) {
                    newData.name = decodeURIComponent(tenantName);
                }
                
                if (contractId) {
                    // ดึง contract จาก database
                    const { data: contractData } = await supabase
                        .from('contracts')
                        .select('*')
                        .eq('id', contractId)
                        .single();
                    
                    if (contractData?.contract_end_date) {
                        // ตั้ง start_date = วันถัดจากวันที่สัญญาหมด
                        const endDate = new Date(contractData.contract_end_date);
                        const startDate = new Date(endDate);
                        startDate.setDate(startDate.getDate() + 1);
                        const startDateStr = startDate.toISOString().split('T')[0];
                        
                        // คำนวณ end_date ให้เป็น 1 ปีหลังจาก start_date
                        const calcEndDate = new Date(startDate);
                        calcEndDate.setFullYear(startDate.getFullYear() + 1);
                        calcEndDate.setDate(calcEndDate.getDate() - 1);
                        const endDateStr = calcEndDate.toISOString().split('T')[0];
                        
                        newData.start_date = startDateStr;
                        newData.end_date = endDateStr;
                    }
                }
                
                // อัปเดต formData และเปิด modal พร้อมกัน
                setEditingId(null);
                setFormData(newData);
                setIsModalOpen(true);
            };
            
            initializeForm();
        }
    }, [searchParams, isEditable]);

    const calculateEndDate = (startDate: string) => {
        if (!startDate) return '';
        const start = new Date(startDate);
        const end = new Date(start);
        end.setFullYear(start.getFullYear() + 1);
        end.setDate(end.getDate() - 1);
        return end.toISOString().split('T')[0];
    };

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedDate = e.target.value;
        if (!selectedDate) return;

        const [year, month] = selectedDate.split('-');
        const forcedStart = `${year}-${month}-01`;

        const newEnd = calculateEndDate(forcedStart);
        setFormData({ ...formData, start_date: forcedStart, end_date: newEnd });
    };

    const handleRoomTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value;
        let newKitchenType = formData.kitchen_type;
        
        // ถ้าไม่ใช่ One Bedroom Exclusive ให้ล็อคเป็นครัวหลัง
        if (['One Bedroom', 'Triple Bedroom', 'One Bedroom Suite'].includes(newType)) {
            newKitchenType = 'ครัวหลัง';
        }

        // กำหนดค่า view_preference เองตามประเภทห้องที่เลือก
        let newView = formData.view_preference;
        if (newType === 'One Bedroom') {
            newView = 'ทิศตะวันออก';
        } else if (newType === 'Triple Bedroom') {
            newView = newView || 'ทิศตะวันตก';
        } else {
            // หากไม่มีค่าเดิม ให้ตั้งค่าเริ่มต้นเป็นทิศตะวันออก
            newView = newView || 'ทิศตะวันออก';
        }

        setFormData({
            ...formData,
            room_type: newType,
            kitchen_type: newKitchenType,
            view_preference: newView
        });
    };

    // ฟังก์ชันจัดการการติ๊กเลือกชั้น
    // ฟังก์ชันจัดการการติ๊กเลือกชั้น
    const handleFloorToggle = (floor: number) => {
        setFormData(prev => {
            const currentFloors = prev.preferred_floors || [];
            const newFloors = currentFloors.includes(floor)
                ? currentFloors.filter(f => f !== floor)
                : [...currentFloors, floor].sort((a, b) => a - b);

            return { ...prev, preferred_floors: newFloors };
        });
    };

    // 🌟 ฟังก์ชันใหม่: สำหรับปุ่ม "เลือกทั้งหมด"
    const allFloors = [2, 3, 4, 5, 6, 7];
    const isAllSelected = formData.preferred_floors.length === allFloors.length;

    const handleSelectAllFloors = () => {
        setFormData(prev => ({
            ...prev,
            // ถ้าเลือกครบแล้วให้เคลียร์ออกทั้งหมด ถ้ายังไม่ครบให้ใส่ไปทุกชั้น
            preferred_floors: isAllSelected ? [] : [...allFloors]
        }));
    };

    async function fetchWaitlist() {
        setLoading(true);
        // ดึงข้อมูลทั้งหมดเพื่อคำนวณคิวที่แท้จริง
        const { data } = await supabase
            .from('waitlists')
            .select('*')
            // 👇 ให้คิวที่จองก่อนขึ้นก่อน
            .order('created_at', { ascending: true });

        if (data) {
            // กำหนดหมายเลขคิวจากลำดับทั้งหมด (เพื่อไม่ให้คิวเลื่อนเมื่อคนก่อนหน้าได้ห้องแล้ว)
            const dataWithQueue = data.map((item: any, index: number) => ({
                ...item,
                queue_number: index + 1
            }));

            // กรองเฉพาะคนที่ยังไม่จัดสรรห้อง
            const activeItems = dataWithQueue.filter((item: any) => item.status !== 'จัดสรรห้องแล้ว');
            setItems(activeItems);
        }
        setLoading(false);
    }

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({
            name: '', room_type: 'One Bedroom',
            kitchen_type: 'ครัวหลัง', view_preference: 'ทิศตะวันออก',
            bed_size: '3.5 ฟุต', preferred_floors: [],
            start_date: '', end_date: '', special_request: '',
            monthly_rent: ''
        });
    };

    const handleAddNew = () => {
        setEditingId(null);
        setFormData({
            name: '', 
            room_type: 'One Bedroom',
            kitchen_type: 'ครัวหลัง', 
            view_preference: 'ทิศตะวันออก',
            bed_size: '3.5 ฟุต', 
            preferred_floors: [],
            start_date: '', 
            end_date: '', 
            special_request: '',
            monthly_rent: ''
        });
        setIsModalOpen(true);
    };

    const handleEdit = (item: Waitlist) => {
        setEditingId(item.id);
        setFormData({
            name: item.name,
            room_type: item.room_type,
            kitchen_type: item.kitchen_type,
            view_preference: item.view_preference,
            bed_size: item.bed_size || '3.5 ฟุต',
            preferred_floors: item.preferred_floors || [],
            start_date: item.start_date,
            end_date: item.end_date,
            special_request: item.special_request || '',
            monthly_rent: item.monthly_rent !== undefined && item.monthly_rent !== null ? item.monthly_rent : ''
        });
        setIsModalOpen(true);
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const payload = {
            ...formData,
            monthly_rent: formData.monthly_rent !== '' ? Number(formData.monthly_rent) : null
        };

        if (editingId) {
            const { error } = await supabase.from('waitlists').update(payload).eq('id', editingId);
            if (error) {
                alert(`เกิดข้อผิดพลาด: ${error.message}`);
            } else {
                await logAudit(profile, 'waitlists', 'update', editingId, 'แก้ไขรายการจอง', describeChanges(payload));
                closeModal();
                fetchWaitlist();
            }
        } else {
            const contractId = searchParams.get('contractId');
            if (contractId) {
                (payload as any).contract_id = contractId;
            }
            const { data, error } = await supabase.from('waitlists').insert([payload]).select('id');
            if (error) {
                alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
            } else {
                const newId = data?.[0]?.id ?? null;
                if (newId) await logAudit(profile, 'waitlists', 'create', newId, 'เพิ่มรายการจอง', payload);
                // หากเข้ามาจาก renewal-check พร้อม contractId ให้บันทึกความตั้งใจว่า
                // เป็น 'renew_no_room' (ผู้เช่าต้องการต่อแต่ยังไม่ระบุห้อง)
                if (contractId) {
                    try {
                        const { data: existing } = await supabase.from('renewal_intentions').select('*').eq('contract_id', contractId).limit(1);
                        const today = new Date();
                        const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

                        if (existing && existing.length > 0) {
                            const upd = { intention: 'renew_no_room', note: existing[0].note ?? '', updated_at: new Date().toISOString() };
                            const { error: upErr } = await supabase.from('renewal_intentions').update(upd).eq('id', existing[0].id);
                            if (!upErr) await logAudit(profile, 'renewal_intentions', 'update', existing[0].id, 'อัปเดตความตั้งใจเป็น renew_no_room (หลังเพิ่ม waitlist)', describeChanges(upd));
                        } else {
                            const rec = { contract_id: contractId, room_id: null, tenant_name: payload.name, intention: 'renew_no_room', survey_month: surveyMonth, note: '' };
                            const { data: ins, error: insErr } = await supabase.from('renewal_intentions').insert([rec]).select('id');
                            const newIntId = ins?.[0]?.id ?? null;
                            if (!insErr && newIntId) await logAudit(profile, 'renewal_intentions', 'create', newIntId, 'เพิ่มความตั้งใจเป็น renew_no_room (หลังเพิ่ม waitlist)', rec);
                        }
                    } catch (e) {
                        console.warn('Failed to upsert renewal intention after waitlist create', e);
                    }
                }

                closeModal();
                fetchWaitlist();
            }
        }
    }

    async function deleteItem(id: string) {
        if (confirm('ยืนยันการลบรายการจองนี้?')) {
            const { error } = await supabase.from('waitlists').delete().eq('id', id);
            if (!error) {
                await logAudit(profile, 'waitlists', 'delete', id, 'ลบรายการจอง', null);
                fetchWaitlist();
            } else {
                alert('ไม่สามารถลบรายการได้: ' + error.message);
            }
        }
    }

    const uniqueBuildings = useMemo(
        () => Array.from(new Set(items.map(item => item.building || '').filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
        [items]
    );

    const uniqueFloors = useMemo(
        () => Array.from(new Set(items.map(item => item.floor).filter((f): f is number => f !== null && f !== undefined))).sort((a, b) => Number(a) - Number(b)),
        [items]
    );

    const uniqueRoomTypes = useMemo(
        () => Array.from(new Set(items.map(item => item.room_type).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [items]
    );

    const uniqueKitchens = useMemo(
        () => Array.from(new Set(items.map(item => item.kitchen_type).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [items]
    );

    const uniqueViews = useMemo(
        () => Array.from(new Set(items.map(item => item.view_preference).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [items]
    );

    const filteredItems = useMemo(() => {
        return items.filter(item => {
            if (searchQuery.trim()) {
                const term = searchQuery.trim().toLowerCase();
                const nameMatches = item.name?.toLowerCase().includes(term);
                const queueMatches = item.queue_number !== undefined && item.queue_number !== null && String(item.queue_number).includes(term);
                if (!nameMatches && !queueMatches) return false;
            }

            if (startDate) {
                if (!item.start_date) return false;
                const s = new Date(item.start_date);
                s.setHours(0,0,0,0);
                const target = new Date(startDate);
                target.setHours(0,0,0,0);
                if (s.getTime() !== target.getTime()) return false;
            }

            if (filterBuilding && item.building !== filterBuilding) return false;
            if (filterFloor && String(item.floor ?? '') !== filterFloor) return false;
            if (filterRoomType && item.room_type !== filterRoomType) return false;
            if (filterKitchen && item.kitchen_type !== filterKitchen) return false;
            if (filterView && item.view_preference !== filterView) return false;

            return true;
        });
    }, [items, searchQuery, startDate, filterBuilding, filterFloor, filterRoomType, filterKitchen, filterView]);

    const isKitchenDisabled = ['One Bedroom', 'Triple Bedroom', 'One Bedroom Suite'].includes(formData.room_type);
    const isViewDisabled = formData.room_type === 'One Bedroom';

    const formatDateTH = (dateStr?: string | null) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return '-';
        return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).format(date);
    };

    const formatDateDMY = (dateStr?: string | null) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return '-';
        return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    };

    return (
        <div className="min-h-full flex flex-col bg-transparent">
            {/* Content Area */}
            <div className="flex-1 p-8 md:p-10">
                <div className="flex justify-between items-end mb-8">
                
                    {isEditable && (
                        <button onClick={handleAddNew} className="bg-[#4F81FF] hover:bg-[#3D6CE5] text-white px-6 py-3 rounded-2xl font-medium shadow-lg shadow-blue-500/25 flex items-center gap-2 transition-all active:scale-95">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                            เพิ่มรายการจอง
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">📋</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">คิวรอจัดสรร</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{filteredItems.length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                </div>

                <h2 className="text-lg font-bold text-[#0A2647] mb-4">รายการล่าสุด</h2>

                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm grid grid-cols-1 lg:grid-cols-[repeat(6,minmax(0,1fr))] gap-3 mb-6 items-center">
                    <div className="flex items-center gap-3 col-span-2 lg:col-span-2">
                        <label className="text-sm font-bold text-slate-600 whitespace-nowrap">ประเภทห้อง</label>
                        <select value={filterRoomType} onChange={(e) => setFilterRoomType(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none w-full">
                            <option value="">ทุกประเภทห้อง</option>
                            {uniqueRoomTypes.map((type, i) => (
                                <option key={i} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-3 col-span-1 lg:col-span-1">
                        <label className="text-sm font-bold text-slate-600">ครัว</label>
                        <select value={filterKitchen} onChange={(e) => setFilterKitchen(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none w-full">
                            <option value="">ทุกประเภทครัว</option>
                            {uniqueKitchens.map((kitchen, i) => (
                                <option key={i} value={kitchen}>{kitchen}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-3 col-span-1 lg:col-span-1">
                        <label className="text-sm font-bold text-slate-600">ทิศ</label>
                        <select value={filterView} onChange={(e) => setFilterView(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none w-full">
                            <option value="">ทุกทิศ (View)</option>
                            {uniqueViews.map((view, i) => (
                                <option key={i} value={view}>{view}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-2 border border-slate-100 shadow-sm flex flex-col md:flex-row items-start md:items-center gap-4 mb-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-1 w-full">
                        <label className="text-sm font-bold text-slate-600 whitespace-nowrap">ค้นหา</label>
                        <input
                            type="text"
                            className="w-full sm:max-w-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none"
                            placeholder="ค้นหาชื่อหรือเลขคิว"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <label className="text-sm font-bold text-slate-600 whitespace-nowrap">วันที่เริ่มสัญญา</label>
                        <input
                            type="date"
                            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none"
                            value={startDate ?? ''}
                            onChange={e => {
                                const v = e.target.value;
                                if (!v) return setStartDate(null);
                                // enforce day = 01
                                const [y, m] = v.split('-');
                                setStartDate(`${y}-${m}-01`);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => { setStartDate(null); }}
                            className="bg-white text-slate-600 border border-slate-200 px-3 py-2 rounded-xl text-sm"
                        >ล้าง</button>
                    </div>

                    <div className="ml-auto text-sm text-slate-500">
                        {startDate ? formatDateDMY(startDate) : 'ยังไม่เลือกวันที่'}
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div></div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {filteredItems.map((item) => (
                            <div key={item.id} className="bg-white rounded-2xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)] border border-slate-100 transition-all group">

                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0 font-bold text-lg hidden md:flex">
                                    {item.queue_number}
                                </div>

                                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                                    <div className="md:col-span-3">
                                        <h3 className="text-base font-bold text-slate-800">{item.name}</h3>
                                        {item.special_request ? (
                                            <span className="text-xs text-orange-500 font-medium truncate block mt-0.5">✨ {item.special_request}</span>
                                        ) : (
                                            <span className="text-xs text-slate-400 block mt-0.5">ไม่มีรีเควสพิเศษ</span>
                                        )}
                                    </div>

                                    <div className="md:col-span-4 flex flex-wrap gap-2">
                                        <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">🚪 {item.room_type}</span>
                                        <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">🍳 {item.kitchen_type}</span>
                                        {item.view_preference && (
                                            <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">🌅 {item.view_preference}</span>
                                        )}
                                        {item.bed_size && (
                                            <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">🛏️ เตียง {item.bed_size}</span>
                                        )}
                                        {item.preferred_floors && item.preferred_floors.length > 0 && (
                                            <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">🏢 ชั้น {item.preferred_floors.join(', ')}</span>
                                        )}
                                    </div>

                                    <div className="md:col-span-2">
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">ค่าเช่าต่อเดือน</p>
                                        <span className="text-xs font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg inline-block">
                                            {item.monthly_rent ? `${item.monthly_rent.toLocaleString('th-TH')} บาท` : '-'}
                                        </span>
                                    </div>

                                    <div className="md:col-span-3">
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">ระยะเวลาสัญญา</p>
                                        <p className="text-xs text-slate-700 font-medium bg-slate-50 inline-block px-3 py-1.5 rounded-lg border border-slate-100">
                                            {formatDateTH(item.start_date)} - {formatDateTH(item.end_date)}
                                        </p>
                                    </div>
                                </div>

                                {isEditable && (
                                    <div className="flex flex-col gap-2 md:pl-6 md:border-l border-slate-100 pt-3 md:pt-0 border-t md:border-t-0 mt-3 md:mt-0">
                                        {item.allocation_note && (
                                            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 leading-relaxed">
                                                {item.allocation_note}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleEdit(item)} className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-[#4F81FF] transition-colors" title="แก้ไข">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                            </button>
                                            <button onClick={() => deleteItem(item.id)} className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-red-500 transition-colors" title="ลบ">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                            </button>
                                            <button onClick={() => router.push(`/allocate/${item.id}`)} className="bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 px-4 py-2 rounded-xl text-sm font-semibold ml-2 transition-all flex items-center gap-2">
                                                จัดสรรห้อง <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {filteredItems.length === 0 && (
                            <div className="text-center py-20 text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center">
                                <div className="text-5xl mb-4">📭</div>
                                <p className="font-medium text-lg text-slate-600">ยังไม่มีรายการจอง</p>
                                <p className="text-sm mt-1">กดปุ่ม "เพิ่มรายการจอง" ด้านบนเพื่อเริ่มใช้งาน</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal Form */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl transform transition-all">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-[#0A2647]">
                                {editingId ? 'แก้ไขข้อมูลการจอง' : 'สร้างรายการจองใหม่'}
                            </h2>
                            <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors">
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-5 max-h-[80vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-5">
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
                                    <input type="text" required className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="ระบุชื่อลูกค้า..." />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ประเภทห้อง</label>
                                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer" value={formData.room_type} onChange={handleRoomTypeChange}>
                                        <option value="One Bedroom">One Bedroom</option>
                                        <option value="One Bedroom Exclusive">One Bedroom Exclusive</option>
                                        <option value="Triple Bedroom">Triple Bedroom</option>
                                        <option value="One Bedroom Suite">One Bedroom Suite</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ประเภทครัว</label>
                                    <select
                                        disabled={isKitchenDisabled}
                                        className={`w-full border border-slate-200 rounded-xl p-3.5 text-sm outline-none transition-all ${isKitchenDisabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-50 text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white cursor-pointer'}`}
                                        value={formData.kitchen_type}
                                        onChange={(e) => setFormData({ ...formData, kitchen_type: e.target.value })}
                                    >
                                        <option value="ครัวหน้า">ครัวหน้า</option>
                                        <option value="ครัวหลัง">ครัวหลัง</option>
                                        <option value="ไม่ระบุ">ไม่ระบุ</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ขนาดเตียง</label>
                                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer" value={formData.bed_size} onChange={(e) => setFormData({ ...formData, bed_size: e.target.value })}>
                                        <option value="3.5 ฟุต">3.5 ฟุต</option>
                                        <option value="7 ฟุต">7 ฟุต</option>
                                        <option value="ไม่ระบุ">ไม่ระบุ</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ทิศที่ต้องการ</label>
                                    {formData.room_type === 'One Bedroom' ? (
                                        <select disabled className="w-full bg-slate-100 text-slate-400 border border-slate-200 rounded-xl p-3.5 text-sm outline-none transition-all cursor-not-allowed" value="ทิศตะวันออก">
                                            <option value="ทิศตะวันออก">ทิศตะวันออก</option>
                                        </select>
                                    ) : (
                                        <select className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-3.5 text-sm focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer" value={formData.view_preference} onChange={(e) => setFormData({ ...formData, view_preference: e.target.value })}>
                                            <option value="ทิศตะวันออก">ทิศตะวันออก</option>
                                            <option value="ทิศตะวันตก">ทิศตะวันตก</option>
                                            <option value="ไม่ระบุ">ไม่ระบุ</option>
                                        </select>
                                    )}
                                </div>

                                {/* ส่วนเลือกชั้นที่ต้องการ แบบ Checkbox */}
                                <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-4">

                                    {/* 🌟 ปรับส่วน Header เป็น Flexbox เพื่อให้อยู่บรรทัดเดียวกัน */}
                                    <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                                            ชั้นที่ต้องการ (2-7) <span className="text-[10px] font-normal normal-case text-slate-400 ml-1">สามารถเลือกได้มากกว่า 1 ชั้น</span>
                                        </label>

                                        {/* 🌟 ปุ่มเลือกทั้งหมด (ย้ายมาต่อท้ายข้อความ) */}
                                        <label className="flex items-center gap-1.5 cursor-pointer group bg-white border border-slate-200 px-2.5 py-1 rounded-md hover:bg-slate-50 transition-all">
                                            <input
                                                type="checkbox"
                                                className="w-3.5 h-3.5 text-[#4F81FF] rounded border-slate-300 focus:ring-[#4F81FF] cursor-pointer"
                                                checked={isAllSelected}
                                                onChange={handleSelectAllFloors}
                                            />
                                            <span className={`text-[11px] font-bold ${isAllSelected ? 'text-[#4F81FF]' : 'text-slate-600'}`}>
                                                เลือกทั้งหมด
                                            </span>
                                        </label>
                                    </div>

                                    <div className="flex flex-wrap gap-3">
                                        {/* ปุ่มชั้น 2-7 */}
                                        {allFloors.map((floor) => (
                                            <label key={floor} className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all border ${formData.preferred_floors.includes(floor) ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-100'}`}>
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 text-[#4F81FF] rounded border-slate-300 focus:ring-[#4F81FF] cursor-pointer"
                                                    checked={formData.preferred_floors.includes(floor)}
                                                    onChange={() => handleFloorToggle(floor)}
                                                />
                                                <span className={`text-sm font-medium ${formData.preferred_floors.includes(floor) ? 'text-[#4F81FF]' : 'text-slate-600'}`}>
                                                    ชั้น {floor}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">เริ่มสัญญา (เริ่มวันที่ 1 เสมอ)</label>
                                    <input type="date" required className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all" value={formData.start_date} onChange={handleStartDateChange} />
                                    <p className="mt-2 text-xs text-slate-500">{formData.start_date ? formatDateTH(formData.start_date) : 'วันที่ไทยจะแสดงเมื่อเลือกวันเริ่มต้น'}</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">สิ้นสุดสัญญา (อัตโนมัติ 1 ปี)</label>
                                    <input type="date" required className="w-full bg-slate-100 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-500 outline-none cursor-not-allowed" value={formData.end_date} readOnly />
                                    <p className="mt-2 text-xs text-slate-500">{formData.end_date ? formatDateTH(formData.end_date) : 'วันที่ไทยจะแสดงเมื่อวันเริ่มต้นถูกเลือกแล้ว'}</p>
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ค่าเช่าต่อเดือน (บาท)</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all"
                                        value={
                                            formData.monthly_rent
                                                ? Number(formData.monthly_rent).toLocaleString("en-US")
                                                : ""
                                        }
                                        onChange={(e) => {
                                            const value = e.target.value.replace(/,/g, "").replace(/\D/g, "");

                                            setFormData({
                                                ...formData,
                                                monthly_rent: value,
                                            });
                                        }}
                                        placeholder="เช่น 17,000, 18,000..."
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ความต้องการพิเศษอื่นๆ</label>
                                    <textarea rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all resize-none" value={formData.special_request} onChange={(e) => setFormData({ ...formData, special_request: e.target.value })} placeholder="เช่น ใกล้บันไดหนีไฟ, ห้องมุม..." />
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4 mt-2 border-t border-slate-100">
                                <button type="button" onClick={closeModal} className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all">ยกเลิก</button>
                                <button type="submit" className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/30 transition-all">
                                    {editingId ? 'บันทึกการเปลี่ยนแปลง' : 'ยืนยันการเพิ่มคิว'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}