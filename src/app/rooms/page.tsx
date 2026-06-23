'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canEditPage, canEdit } from '../../lib/permissions';
import { logAudit, describeChanges } from '../../lib/audit';

// 1. เพิ่ม floor ใน Interface
interface Room {
    id: string;
    room_number: string;
    floor: number | null; 
    building?: string | null;
    room_type: string;
    kitchen_type: string;
    view_direction: string;
}

interface ContractInfo {
    id: string;
    tenant_name: string;
    status: string | null;
    main_room_id: string | null;
    temp_room_id: string | null;
    move_to_room_id: string | null;
    contract_start_date: string;
    contract_end_date: string;
    main_start_date: string | null;
    main_end_date: string | null;
    temp_start_date: string | null;
    temp_end_date: string | null;
    move_start_date: string | null;
    move_end_date: string | null;
}

const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '?';
    const [y, m, d] = dateStr.split('-');
    return `${d}-${m}-${y}`;
};

export default function RoomsPage() {
    const { profile } = useAuth();
    const userCanEdit = canEditPage(profile, 'rooms');
    const [rooms, setRooms] = useState<Room[]>([]);
    const [contracts, setContracts] = useState<ContractInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);

    const [filterBuilding, setFilterBuilding] = useState('');
    const [filterFloor, setFilterFloor] = useState('');
    const [filterRoomType, setFilterRoomType] = useState('');
    const [filterKitchen, setFilterKitchen] = useState('');
    const [filterView, setFilterView] = useState('');

    const [formData, setFormData] = useState({
        room_number: '',
        room_type: 'One Bedroom',
        kitchen_type: 'ครัวหลัง',
        view_direction: 'ทิศตะวันออก'
    });

    const searchParams = useSearchParams();

    useEffect(() => {
        fetchRooms();
        fetchContracts();
    }, []);

    useEffect(() => {
        if (canEdit(profile?.role) && searchParams.get('quickAction') === 'newRoom') {
            handleOpenModal();
        }
    }, [searchParams, profile?.role]);

    useEffect(() => {
        let newKitchen = formData.kitchen_type;
        let newView = formData.view_direction;
        let changed = false;

        const strictKitchenTypes = ['One Bedroom', 'Triple Bedroom', 'One Bedroom Suite'];
        
        if (strictKitchenTypes.includes(formData.room_type)) {
            if (newKitchen !== 'ครัวหลัง') {
                newKitchen = 'ครัวหลัง';
                changed = true;
            }
        }

        if (formData.room_type === 'One Bedroom') {
            if (newView !== 'ทิศตะวันออก') {
                newView = 'ทิศตะวันออก';
                changed = true;
            }
        } else if (formData.room_type === 'One Bedroom Suite') {
            if (newView === 'ทิศตะวันตก') {
                newView = 'ทิศตะวันออก';
                changed = true;
            }
        }

        if (changed) {
            setFormData(prev => ({ ...prev, kitchen_type: newKitchen, view_direction: newView }));
        }
    }, [formData.room_type]);

    async function fetchRooms() {
        setLoading(true);
        const { data, error } = await supabase
            .from('rooms')
            .select('*')
            .order('room_number', { ascending: true });

        if (data) setRooms(data);
        if (error) console.error(error);
        setLoading(false);
    }

    async function fetchContracts() {
        const { data, error } = await supabase
            .from('contracts')
            .select('id, tenant_name, status, main_room_id, temp_room_id, move_to_room_id, contract_start_date, contract_end_date, main_start_date, main_end_date, temp_start_date, temp_end_date, move_start_date, move_end_date')
            .neq('status', 'completed')
            .neq('status', 'cancelled');
        if (data) setContracts(data);
        if (error) console.error(error);
    }

    const handleOpenModal = (room?: Room) => {
        if (room) {
            setEditId(room.id);
            setFormData({
                room_number: room.room_number,
                room_type: room.room_type,
                kitchen_type: room.kitchen_type,
                view_direction: room.view_direction
            });
        } else {
            setEditId(null);
            setFormData({
                room_number: '',
                room_type: 'One Bedroom',
                kitchen_type: 'ครัวหลัง',
                view_direction: 'ทิศตะวันออก'
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 2. ลอจิกดึงตัวเลขชั้นและ building จากหมายเลขห้อง
        let calculatedFloor = null;
        let calculatedBuilding = null;

        const buildingMatch = formData.room_number.match(/^[A-Za-z]+/);
        if (buildingMatch) {
            calculatedBuilding = buildingMatch[0];
        }

        const numberMatch = formData.room_number.match(/\d+/); 
        
        if (numberMatch) {
            const numStr = numberMatch[0];
            if (numStr.length >= 3) {
                calculatedFloor = parseInt(numStr.slice(0, -2), 10);
            } else {
                calculatedFloor = parseInt(numStr, 10);
            }
        }

        // 3. รวมค่า floor และ building เข้าไปในข้อมูลที่จะส่งไป Database
        const payload = {
            ...formData,
            floor: calculatedFloor,
            building: calculatedBuilding
        };

        if (editId) {
            const { error } = await supabase
                .from('rooms')
                .update(payload)
                .eq('id', editId);

            if (error) {
                alert('เกิดข้อผิดพลาดในการแก้ไข: ' + error.message);
            } else {
                await logAudit(profile, 'rooms', 'update', editId, 'แก้ไขข้อมูลห้อง', describeChanges(payload));
            }
        } else {
            const { data, error } = await supabase
                .from('rooms')
                .insert([payload])
                .select('id');

            if (error) {
                alert('เกิดข้อผิดพลาดในการเพิ่มข้อมูล: ' + error.message);
            } else {
                const newId = data?.[0]?.id ?? null;
                if (newId) await logAudit(profile, 'rooms', 'create', newId, 'เพิ่มข้อมูลห้อง', payload);
            }
        }

        setIsModalOpen(false);
        fetchRooms();
    };

    const handleDelete = async (id: string, roomNumber: string) => {
        if (confirm(`คุณแน่ใจหรือไม่ที่จะลบห้อง ${roomNumber}? ข้อมูลนี้ไม่สามารถกู้คืนได้`)) {
            const { error } = await supabase.from('rooms').delete().eq('id', id);
            if (error) {
                alert('ไม่สามารถลบได้ อาจมีข้อมูลผูกอยู่กับห้องนี้');
            } else {
                await logAudit(profile, 'rooms', 'delete', id, 'ลบข้อมูลห้อง', null);
                fetchRooms();
            }
        }
    };

    const strictKitchenTypes = ['One Bedroom', 'Triple Bedroom', 'One Bedroom Suite'];

    const uniqueBuildings = useMemo(
        () => Array.from(new Set(rooms.map(r => r.building || '').filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
        [rooms]
    );

    const uniqueFloors = useMemo(
        () => Array.from(new Set(rooms.map(r => r.floor).filter((f): f is number => f !== null && f !== undefined))).sort((a, b) => Number(a) - Number(b)),
        [rooms]
    );

    const uniqueKitchens = useMemo(
        () => Array.from(new Set(rooms.map(r => r.kitchen_type).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [rooms]
    );

    const uniqueRoomTypes = useMemo(
        () => Array.from(new Set(rooms.map(r => r.room_type).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [rooms]
    );

    const uniqueViews = useMemo(
        () => Array.from(new Set(rooms.map(r => r.view_direction).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
        [rooms]
    );

    const filteredRooms = useMemo(
        () => rooms.filter(room => {
            const matchBuilding = filterBuilding === '' || room.building === filterBuilding;
            const matchFloor = filterFloor === '' || String(room.floor ?? '') === filterFloor;
            const matchRoomType = filterRoomType === '' || room.room_type === filterRoomType;
            const matchKitchen = filterKitchen === '' || room.kitchen_type === filterKitchen;
            const matchView = filterView === '' || room.view_direction === filterView;
            return matchBuilding && matchFloor && matchRoomType && matchKitchen && matchView;
        }),
        [rooms, filterBuilding, filterFloor, filterRoomType, filterKitchen, filterView]
    );

    return (
        <>
            {/* Import Google Font K2D */}
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://fonts.googleapis.com/css2?family=K2D:wght@300;400;500;600;700;800&display=swap');
            ` }} />

            {/* Set Font Family to the main wrapper */}
            <div className="flex-1 p-8 md:p-10 min-h-full bg-transparent" style={{ fontFamily: "'K2D', sans-serif" }}>
                
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-8">
                    {userCanEdit && (
                    <button
                        onClick={() => handleOpenModal()}
                        className="bg-gradient-to-r from-[#4F81FF] to-[#3D6CE5] hover:from-[#3D6CE5] hover:to-[#2A52BE] text-white px-7 py-3.5 rounded-2xl font-bold shadow-lg shadow-blue-500/30 dark:from-[#EADBC8] dark:to-[#DAC0A3] dark:hover:from-[#DAC0A3] dark:hover:to-[#C8AE91] dark:text-[#041C32] dark:shadow-blue-950/40 flex items-center gap-2.5 transition-all active:scale-95 whitespace-nowrap"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        เพิ่มห้องพักใหม่
                    </button>
                    )}
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex items-center gap-5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-6 opacity-5">
                            <svg className="w-16 h-16 text-[#0A2647]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd"></path></svg>
                        </div>
                        <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center text-3xl border border-indigo-100/50 shadow-inner z-10">
                            🏢
                        </div>
                        <div className="z-10">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">รวมทุกตึก</p>
                            <p className="text-3xl font-black text-[#0A2647]">{rooms.length} <span className="text-sm font-medium text-slate-500">ห้อง</span></p>
                        </div>
                    </div>


                    {uniqueBuildings.map((building, index) => {
                        // นับจำนวนห้องเฉพาะในตึกนี้
                        const buildingRoomCount = rooms.filter(r => r.building === building).length;
                        
                        return (
                            <div key={index} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex items-center gap-5 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-6 opacity-5">
                                    
                                    <svg className="w-16 h-16 text-[#4F81FF]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd"></path></svg>
                                </div>
                                <div className="w-16 h-16 bg-blue-50 text-[#4F81FF] rounded-2xl flex items-center justify-center text-2xl font-black border border-blue-100/50 shadow-inner z-10">
                                    {building || '-'}
                                </div>
                                <div className="z-10">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">ตึก {building || 'ไม่ระบุ'}</p>
                                    <p className="text-3xl font-black text-[#0A2647]">{buildingRoomCount} <span className="text-sm font-medium text-slate-500">ห้อง</span></p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Filters Section */}
                <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-slate-100 mb-6 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2 px-2 text-sm font-bold text-[#4F81FF]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                        ตัวกรอง
                    </div>
                    <select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px] cursor-pointer hover:bg-slate-100 transition-colors">
                        <option value="">ทุกตึก</option>
                        {uniqueBuildings.map((building, i) => (
                            <option key={i} value={building}>{building}</option>
                        ))}
                    </select>
                    <select value={filterFloor} onChange={(e) => setFilterFloor(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[100px] cursor-pointer hover:bg-slate-100 transition-colors">
                        <option value="">ทุกชั้น</option>
                        {uniqueFloors.map((floor, i) => (
                            <option key={i} value={String(floor)}>ชั้น {floor}</option>
                        ))}
                    </select>
                    <select value={filterRoomType} onChange={(e) => setFilterRoomType(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[140px] cursor-pointer hover:bg-slate-100 transition-colors">
                        <option value="">ทุกประเภทห้อง</option>
                        {uniqueRoomTypes.map((type, i) => (
                            <option key={i} value={type}>{type}</option>
                        ))}
                    </select>
                    <select value={filterKitchen} onChange={(e) => setFilterKitchen(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px] cursor-pointer hover:bg-slate-100 transition-colors">
                        <option value="">ทุกประเภทครัว</option>
                        {uniqueKitchens.map((kitchen, i) => (
                            <option key={i} value={kitchen}>{kitchen}</option>
                        ))}
                    </select>
                    <select value={filterView} onChange={(e) => setFilterView(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px] cursor-pointer hover:bg-slate-100 transition-colors">
                        <option value="">ทุกทิศ (View)</option>
                        {uniqueViews.map((view, i) => (
                            <option key={i} value={view}>{view}</option>
                        ))}
                    </select>
                    <div className="ml-auto bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold border border-blue-100">
                        พบ {filteredRooms.length} ห้อง
                    </div>
                </div>

                {/* Main Content / Table */}
                {loading ? (
                    <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div></div>
                ) : (
                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                                <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800 text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="p-5 pl-8">หมายเลขห้อง</th>
                                        <th className="p-5">ตึก</th>
                                        <th className="p-5">ชั้น</th>
                                        <th className="p-5">ประเภทห้อง</th>
                                        <th className="p-5">ประเภทครัว</th>
                                        <th className="p-5">ทิศ / วิว</th>
                                        <th className="p-5">ผู้เช่าปัจจุบัน</th>
                                        <th className="p-5">ผู้เช่าที่จะเข้า</th>
                                        <th className="p-5 pr-8 text-right">จัดการ</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredRooms.map(room => {
                                        const todayStr = new Date().toISOString().slice(0, 10);

                                        // ผู้เช่าปัจจุบัน: contract ที่ครอบคลุมวันนี้ (ผ่าน main_room_id หรือ temp_room_id)
                                        const currentContracts = contracts.filter(c => {
                                            const inMain = c.main_room_id === room.id &&
                                                (c.main_start_date || c.contract_start_date) <= todayStr &&
                                                (c.main_end_date || c.contract_end_date) >= todayStr;
                                            const inTemp = c.temp_room_id === room.id &&
                                                c.temp_start_date && c.temp_end_date &&
                                                c.temp_start_date <= todayStr &&
                                                c.temp_end_date >= todayStr;
                                            const inMove = c.move_to_room_id === room.id &&
                                                c.move_start_date && c.move_end_date &&
                                                c.move_start_date <= todayStr &&
                                                c.move_end_date >= todayStr;
                                            return inMain || inTemp || inMove;
                                        });

                                        // ผู้เช่าที่จะเข้า: contract ที่จะเริ่มในอนาคต
                                        const incomingContracts = contracts.filter(c => {
                                            const mainFuture = c.main_room_id === room.id &&
                                                (c.main_start_date || c.contract_start_date) > todayStr;
                                            const tempFuture = c.temp_room_id === room.id &&
                                                c.temp_start_date && c.temp_start_date > todayStr;
                                            const moveFuture = c.move_to_room_id === room.id &&
                                                c.move_start_date && c.move_start_date > todayStr;
                                            // ไม่นับถ้าเป็นผู้เช่าปัจจุบันอยู่แล้ว
                                            const isAlreadyCurrent = currentContracts.some(cc => cc.id === c.id);
                                            return !isAlreadyCurrent && (mainFuture || tempFuture || moveFuture);
                                        });

                                        return (
                                        <tr key={room.id} className="hover:bg-slate-50/50 transition-colors group">
                                            <td className="p-5 pl-8">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-11 h-11 rounded-2xl bg-slate-50 border border-slate-100 text-[#0A2647] flex items-center justify-center font-black text-lg group-hover:bg-[#4F81FF] group-hover:text-white group-hover:border-[#4F81FF] transition-all shadow-sm">
                                                        {room.room_number.charAt(0)}
                                                    </div>
                                                    <span className="font-black text-[#0A2647] text-lg">{room.room_number}</span>
                                                </div>
                                            </td>
                                            <td className="p-5 font-bold text-slate-700">
                                                {room.building || '-'}
                                            </td>
                                            <td className="p-5 font-bold text-slate-700">
                                                {room.floor ? `ชั้น ${room.floor}` : '-'}
                                            </td>
                                            {/* คอลัมน์: ประเภทห้อง */}
                                            <td className="p-5">
                                                <span className="inline-flex items-center bg-slate-50 text-slate-600 border border-slate-200 text-xs px-3 py-1.5 rounded-lg font-bold">
                                                    <svg className="w-3.5 h-3.5 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
                                                    </svg>
                                                    {room.room_type || '-'}
                                                </span>
                                            </td>

                                            {/* คอลัมน์: ประเภทครัว */}
                                            <td className="p-5">
                                                <span className="inline-flex items-center bg-amber-50 text-amber-600 border border-amber-200/60 text-xs px-3 py-1.5 rounded-lg font-bold">
                                                    <svg className="w-3.5 h-3.5 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"></path>
                                                    </svg>
                                                    {room.kitchen_type || 'ไม่ระบุ'}
                                                </span>
                                            </td>

                                            {/* คอลัมน์: ทิศ / วิว */}
                                            <td className="p-5">
                                                {room.view_direction ? (
                                                    <span className="inline-flex items-center bg-sky-50 text-sky-600 border border-sky-200/60 text-xs px-3 py-1.5 rounded-lg font-bold">
                                                        <svg className="w-3.5 h-3.5 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
                                                        </svg>
                                                        {room.view_direction}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic font-medium">ไม่ได้ระบุทิศ</span>
                                                )}
                                            </td>

                                            {/* คอลัมน์: ผู้เช่าปัจจุบัน */}
                                            <td className="p-5">
                                                {currentContracts.length > 0 ? (
                                                    <div className="flex flex-col gap-2">
                                                        {currentContracts.map(c => {
                                                            const startDate =
                                                                (c.main_room_id === room.id ? (c.main_start_date || c.contract_start_date) : null) ||
                                                                (c.temp_room_id === room.id ? c.temp_start_date : null) ||
                                                                (c.move_to_room_id === room.id ? c.move_start_date : null) ||
                                                                c.contract_start_date;
                                                            const endDate =
                                                                (c.main_room_id === room.id ? (c.main_end_date || c.contract_end_date) : null) ||
                                                                (c.temp_room_id === room.id ? c.temp_end_date : null) ||
                                                                (c.move_to_room_id === room.id ? c.move_end_date : null) ||
                                                                c.contract_end_date;
                                                            return (
                                                                <div key={c.id} className="flex flex-col gap-0.5">
                                                                    <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-xs px-2.5 py-1.5 rounded-lg font-bold">
                                                                        <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                                                                        {c.tenant_name}
                                                                    </span>
                                                                    {(startDate || endDate) && (
                                                                        <span className="text-[10px] text-slate-400 font-medium pl-1">
                                                                            {formatDate(startDate)} → {formatDate(endDate)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 text-xs font-medium">ว่าง</span>
                                                )}
                                            </td>

                                            {/* คอลัมน์: ผู้เช่าที่จะเข้า (Incoming) */}
                                            <td className="p-5">
                                                {incomingContracts.length > 0 ? (
                                                    <div className="flex flex-col gap-2">
                                                        {incomingContracts.map(c => {
                                                            const startDate =
                                                                (c.main_room_id === room.id ? (c.main_start_date || c.contract_start_date) : null) ||
                                                                (c.temp_room_id === room.id ? c.temp_start_date : null) ||
                                                                (c.move_to_room_id === room.id ? c.move_start_date : null) ||
                                                                c.contract_start_date;
                                                            const endDate =
                                                                (c.main_room_id === room.id ? (c.main_end_date || c.contract_end_date) : null) ||
                                                                (c.temp_room_id === room.id ? c.temp_end_date : null) ||
                                                                (c.move_to_room_id === room.id ? c.move_end_date : null) ||
                                                                c.contract_end_date;
                                                            return (
                                                                <div key={c.id} className="flex flex-col gap-0.5">
                                                                    <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200/70 text-xs px-2.5 py-1.5 rounded-lg font-bold">
                                                                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                                        {c.tenant_name}
                                                                    </span>
                                                                    {(startDate || endDate) && (
                                                                        <span className="text-[10px] text-slate-400 font-medium pl-1">
                                                                            {formatDate(startDate)} → {formatDate(endDate)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 text-xs font-medium">-</span>
                                                )}
                                            </td>

                                            <td className="p-5 pr-8 text-right space-x-2">
                                                {userCanEdit && (
                                                <>
                                                <button onClick={() => handleOpenModal(room)} className="p-2 rounded-xl text-slate-400 hover:bg-blue-100 hover:text-[#4F81FF] transition-colors" title="แก้ไข">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                                </button>
                                                <button onClick={() => handleDelete(room.id, room.room_number)} className="p-2 rounded-xl text-slate-400 hover:bg-red-100 hover:text-red-500 transition-colors" title="ลบ">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                </button>
                                                </>
                                                )}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {rooms.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="p-16 text-center">
                                                <div className="flex flex-col items-center text-slate-400">
                                                    <div className="text-6xl mb-4 opacity-50">📭</div>
                                                    <p className="font-bold text-xl text-slate-600">ยังไม่มีข้อมูลห้องพัก</p>
                                                    <p className="text-sm mt-2 text-slate-400">กดปุ่ม "เพิ่มห้องพักใหม่" ด้านบนเพื่อเริ่มต้น</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Modal Form */}
                {isModalOpen && (
                    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                        <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl transform transition-all border border-slate-100">
                            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/60">
                                <h2 className="text-xl font-black text-[#0A2647] flex items-center gap-3">
                                    <span className="w-8 h-8 rounded-full bg-[#4F81FF]/10 text-[#4F81FF] flex items-center justify-center text-base">
                                        {editId ? '✏️' : '✨'}
                                    </span>
                                    {editId ? `แก้ไขห้องพัก: ${formData.room_number}` : 'เพิ่มห้องพักใหม่'}
                                </h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors border border-slate-200">
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-8 space-y-6">
                                <div className="grid grid-cols-2 gap-5">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">หมายเลขห้อง <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            required
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all placeholder:text-slate-400"
                                            value={formData.room_number}
                                            onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                                            placeholder="เช่น L201, S205"
                                        />
                                        <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1 font-medium">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                            ระบบจะคำนวณและบันทึก "ชั้น" ให้อัตโนมัติจากหมายเลขห้อง
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ประเภทห้อง</label>
                                        <select
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer"
                                            value={formData.room_type}
                                            onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                                        >
                                            <option value="One Bedroom">One Bedroom</option>
                                            <option value="One Bedroom Exclusive">One Bedroom Exclusive</option>
                                            <option value="Triple Bedroom">Triple Bedroom</option>
                                            <option value="One Bedroom Suite">One Bedroom Suite</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ประเภทครัว</label>
                                        <select
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                            value={formData.kitchen_type}
                                            onChange={(e) => setFormData({ ...formData, kitchen_type: e.target.value })}
                                        >
                                            {strictKitchenTypes.includes(formData.room_type) ? (
                                                <option value="ครัวหลัง">ครัวหลัง</option>
                                            ) : (
                                                <>
                                                    <option value="ครัวหน้า">ครัวหน้า</option>
                                                    <option value="ครัวหลัง">ครัวหลัง</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ทิศ / วิว</label>
                                        <select
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer"
                                            value={formData.view_direction}
                                            onChange={(e) => setFormData({ ...formData, view_direction: e.target.value })}
                                        >
                                            <option value="ทิศตะวันออก">ทิศตะวันออก</option>
                                            <option value="ทิศตะวันตก">ทิศตะวันตก</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="flex gap-4 pt-4 mt-4 border-t border-slate-100">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all">ยกเลิก</button>
                                    <button type="submit" className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-[#4F81FF] to-[#3D6CE5] hover:from-[#3D6CE5] hover:to-[#2A52BE] rounded-2xl shadow-lg shadow-blue-500/30 transition-all">
                                        {editId ? 'บันทึกการเปลี่ยนแปลง' : 'ยืนยันเพิ่มห้อง'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}