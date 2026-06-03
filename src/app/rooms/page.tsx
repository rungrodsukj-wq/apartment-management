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
    floor: number | null; // เพิ่มบรรทัดนี้
    building?: string | null;
    room_type: string;
    kitchen_type: string;
    view_direction: string;
}

export default function RoomsPage() {
    const { profile } = useAuth();
    const userCanEdit = canEditPage(profile, 'rooms');
    const [rooms, setRooms] = useState<Room[]>([]);
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

        // 2. ลอจิกดึงตัวเลขชั้นจากหมายเลขห้อง
        let calculatedFloor = null;
        // ดึงเฉพาะตัวเลขออกมา เช่น "L202" จะได้ "202", "S1005" จะได้ "1005"
        const numberMatch = formData.room_number.match(/\d+/); 
        
        if (numberMatch) {
            const numStr = numberMatch[0];
            if (numStr.length >= 3) {
                // ถ้ามี 3 หลักขึ้นไป ให้ตัด 2 หลักท้ายออก (เช่น 202 -> 2, 1005 -> 10)
                calculatedFloor = parseInt(numStr.slice(0, -2), 10);
            } else {
                // กรณีพิมพ์แค่เลขชั้นมาตรงๆ (เช่น 2)
                calculatedFloor = parseInt(numStr, 10);
            }
        }

        // 3. รวมค่า floor เข้าไปในข้อมูลที่จะส่งไป Database
        const payload = {
            ...formData,
            floor: calculatedFloor
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
        <div className="flex-1 p-8 md:p-10">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-8">
                {userCanEdit && (
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-[#4F81FF] hover:bg-[#3D6CE5] text-white px-6 py-3 rounded-2xl font-medium shadow-lg shadow-blue-500/25 flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    เพิ่มห้องพักใหม่
                </button>
                )}
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                    <div className="w-14 h-14 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center text-2xl">🏢</div>
                    <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">จำนวนห้องทั้งหมด</p>
                        <p className="text-2xl font-bold text-[#0A2647]">{rooms.length} <span className="text-sm font-medium text-slate-500">ห้อง</span></p>
                    </div>
                </div>
            </div>

            {/* Main Content / Table */}
            {loading ? (
                <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div></div>
            ) : (
                <div className="bg-white rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center gap-4">
                        <span className="text-sm font-bold text-slate-500">กรองห้องพัก:</span>
                        <select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
                            <option value="">ทุกตึก</option>
                            {uniqueBuildings.map((building, i) => (
                                <option key={i} value={building}>{building}</option>
                            ))}
                        </select>
                        <select value={filterFloor} onChange={(e) => setFilterFloor(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[100px]">
                            <option value="">ทุกชั้น</option>
                            {uniqueFloors.map((floor, i) => (
                                <option key={i} value={String(floor)}>ชั้น {floor}</option>
                            ))}
                        </select>
                        <select value={filterRoomType} onChange={(e) => setFilterRoomType(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[140px]">
                            <option value="">ทุกประเภทห้อง</option>
                            {uniqueRoomTypes.map((type, i) => (
                                <option key={i} value={type}>{type}</option>
                            ))}
                        </select>
                        <select value={filterKitchen} onChange={(e) => setFilterKitchen(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
                            <option value="">ทุกประเภทครัว</option>
                            {uniqueKitchens.map((kitchen, i) => (
                                <option key={i} value={kitchen}>{kitchen}</option>
                            ))}
                        </select>
                        <select value={filterView} onChange={(e) => setFilterView(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
                            <option value="">ทุกทิศ (View)</option>
                            {uniqueViews.map((view, i) => (
                                <option key={i} value={view}>{view}</option>
                            ))}
                        </select>
                        <span className="text-xs text-slate-400 font-medium ml-auto">พบ {filteredRooms.length} ห้อง</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600">
                            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="p-5 pl-8">หมายเลขห้อง</th>
                                    <th className="p-5">ตึก</th>
                                    <th className="p-5">ชั้น</th>
                                    <th className="p-5">ประเภทห้อง</th>
                                    <th className="p-5">ประเภทครัว</th>
                                    <th className="p-5">ทิศ / วิว</th>
                                    <th className="p-5 pr-8 text-right">จัดการ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredRooms.map(room => (
                                    <tr key={room.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-5 pl-8">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-[#F0F4F8] text-[#0A2647] flex items-center justify-center font-bold text-base group-hover:bg-[#4F81FF] group-hover:text-white transition-colors">
                                                    {room.room_number.charAt(0)}
                                                </div>
                                                <span className="font-bold text-[#0A2647] text-lg">{room.room_number}</span>
                                            </div>
                                        </td>
                                        <td className="p-5 font-medium text-slate-600">
                                            {room.building || '-'}
                                        </td>
                                        <td className="p-5 font-medium text-slate-600">
                                            {room.floor ? `ชั้น ${room.floor}` : '-'}
                                        </td>
                                        <td className="p-5">
                                            <span className="bg-slate-50 text-slate-600 border border-slate-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                🛏️ {room.room_type || '-'}
                                            </span>
                                        </td>
                                        <td className="p-5">
                                            <span className="bg-amber-50 text-amber-600 border border-amber-100/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                🍳 {room.kitchen_type || 'ไม่ระบุ'}
                                            </span>
                                        </td>
                                        <td className="p-5">
                                            {room.view_direction ? (
                                                <span className="bg-sky-50 text-sky-600 border border-sky-100/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                    🌅 {room.view_direction}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-xs italic">ไม่ได้ระบุทิศ</span>
                                            )}
                                        </td>
                                        <td className="p-5 pr-8 text-right space-x-2">
                                            {userCanEdit && (
                                            <>
                                            <button onClick={() => handleOpenModal(room)} className="p-2 rounded-xl text-slate-400 hover:bg-blue-50 hover:text-[#4F81FF] transition-colors" title="แก้ไข">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                            </button>
                                            <button onClick={() => handleDelete(room.id, room.room_number)} className="p-2 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="ลบ">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                            </button>
                                            </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {rooms.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="p-10 text-center">
                                            <div className="flex flex-col items-center text-slate-400">
                                                <div className="text-5xl mb-4">📭</div>
                                                <p className="font-medium text-lg text-slate-600">ยังไม่มีข้อมูลห้องพัก</p>
                                                <p className="text-sm mt-1">กดปุ่ม "เพิ่มห้องพักใหม่" ด้านบนเพื่อเริ่มต้น</p>
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
                    <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl transform transition-all">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-[#0A2647]">
                                {editId ? `แก้ไขห้องพัก: ${formData.room_number}` : 'เพิ่มห้องพักใหม่'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors">
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-5">
                            <div className="grid grid-cols-2 gap-5">
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">หมายเลขห้อง <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all"
                                        value={formData.room_number}
                                        onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                                        placeholder="เช่น 101, A205"
                                    />
                                    <p className="text-xs text-slate-400 mt-1.5">* ระบบจะคำนวณและบันทึก "ชั้น" ให้อัตโนมัติจากหมายเลขห้อง</p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">ประเภทห้อง</label>
                                    <select
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer"
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
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all cursor-pointer"
                                        value={formData.view_direction}
                                        onChange={(e) => setFormData({ ...formData, view_direction: e.target.value })}
                                    >
                                                <>
                                            <option value="ทิศตะวันออก">ทิศตะวันออก</option>
                                            <option value="ทิศตะวันตก">ทิศตะวันตก</option>
                                        </>
                                    </select>
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4 mt-2 border-t border-slate-100">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all">ยกเลิก</button>
                                <button type="submit" className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/30 transition-all">
                                    {editId ? 'บันทึกการเปลี่ยนแปลง' : 'ยืนยันเพิ่มห้อง'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}