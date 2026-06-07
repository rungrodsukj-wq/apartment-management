// Shared availability helpers
export const isOverlap = (start1: string, end1: string, start2: string, end2: string) => {
    if (!start1 || !end1 || !start2 || !end2) return false;
    // Treat date ranges as inclusive: ranges that touch should count as overlapping.
    const s1 = new Date(start1).getTime();
    const e1 = new Date(end1).getTime();
    const s2 = new Date(start2).getTime();
    const e2 = new Date(end2).getTime();
    return s1 <= e2 && s2 <= e1;
};

export const getContractIntention = (intentions: any[], contractId?: string | null) => {
    if (!contractId) return null;
    const intention = intentions?.find((i: any) => i.contract_id === contractId);
    return intention?.intention ?? null;
};

export const isRoomAvailable = (
    contracts: any[],
    intentions: any[],
    roomId: string,
    checkStart: string,
    checkEnd: string,
    currentContractId?: string
) => {
    if (!checkStart || !checkEnd) return true;

    for (const c of contracts) {
        if (currentContractId && c.id === currentContractId) continue;
        if (c.status === 'cancelled') continue;

        const periods = [
            c.main_room_id === roomId && c.main_start_date && c.main_end_date ? { start: c.main_start_date, end: c.main_end_date } : null,
            c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date ? { start: c.temp_start_date, end: c.temp_end_date } : null,
            c.move_to_room_id === roomId && c.move_start_date && c.move_end_date ? { start: c.move_start_date, end: c.move_end_date } : null,
        ].filter(Boolean) as { start: string; end: string }[];

        for (const period of periods) {
            if (isOverlap(checkStart, checkEnd, period.start, period.end)) return false;
        }

        const contractEnd = c.contract_end_date || c.main_end_date || c.temp_end_date || c.move_end_date;
        if (contractEnd) {
            try {
                if (new Date(contractEnd) >= new Date(checkStart)) {
                    const intention = getContractIntention(intentions, c.id);
                    const nonLockIntents = ['not_renew', 'renew_no_room'];
                    if (!nonLockIntents.includes(intention)) return false;
                }
            } catch (e) {
                const intention = getContractIntention(intentions, c.id);
                const nonLockIntents = ['not_renew', 'renew_no_room'];
                if (!nonLockIntents.includes(intention)) return false;
            }
        }
    }

    return true;
};

export const getRoomFreeWindow = (contracts: any[], roomId: string, searchStart: string, searchEnd: string) => {
    const occupied = contracts
        .filter((c: any) => c.status !== 'cancelled')
        .flatMap((c: any) => {
            const periods: { start: string; end: string }[] = [];
            if (c.main_room_id === roomId && c.main_start_date && c.main_end_date)
                periods.push({ start: c.main_start_date, end: c.main_end_date });
            if (c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date)
                periods.push({ start: c.temp_start_date, end: c.temp_end_date });
            if (c.move_to_room_id === roomId && c.move_start_date && c.move_end_date)
                periods.push({ start: c.move_start_date, end: c.move_end_date });
            return periods;
        })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    let freeStart = '2000-01-01';
    let freeEnd = '2099-12-31';

    for (const occ of occupied) {
        if (new Date(occ.end) < new Date(searchStart)) {
            const d = new Date(occ.end);
            d.setDate(d.getDate() + 1);
            freeStart = d.toISOString().split('T')[0];
        } else if (new Date(occ.start) > new Date(searchEnd)) {
            const d = new Date(occ.start);
            d.setDate(d.getDate() - 1);
            freeEnd = d.toISOString().split('T')[0];
            break;
        }
    }

    return { start: freeStart, end: freeEnd };
};

export const getRoomOccupancyIntervals = (contracts: any[], roomId: string) => {
    const intervals: { start: Date; end: Date }[] = [];

    contracts.forEach((c: any) => {
        if (c.main_room_id === roomId) {
            const s = c.main_start_date || c.actual_check_in_date || c.contract_start_date;
            const e = c.contract_end_date || c.main_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
        if (c.temp_room_id === roomId) {
            const s = c.temp_start_date;
            const e = c.temp_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
        if (c.move_to_room_id === roomId) {
            const s = c.move_start_date;
            const e = c.contract_end_date || c.move_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
    });

    return intervals;
};

export const getRoomAvailability = (contracts: any[], roomId: string, targetDateStr: string) => {
    const intervals = getRoomOccupancyIntervals(contracts, roomId);

    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
    const merged: { start: Date; end: Date }[] = [];
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
    const target = new Date(targetDateStr);

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

    return { availableFrom, availableUntil };
};

export const getNextAvailableDate = (contracts: any[], roomId: string, requestedStart: string) => {
    const intervals = getRoomOccupancyIntervals(contracts, roomId);
    let currentStart = new Date(requestedStart);

    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

    for (const interval of intervals) {
        if (currentStart >= interval.start && currentStart < interval.end) {
            currentStart = new Date(interval.end);
        }
    }

    const yyyy = currentStart.getFullYear();
    const mm = String(currentStart.getMonth() + 1).padStart(2, '0');
    const dd = String(currentStart.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

export const getRoomAvailabilityText = (contracts: any[], roomId: string, targetDateStr: string) => {
    const { availableFrom, availableUntil } = getRoomAvailability(contracts, roomId, targetDateStr);

    const formatD = (d: Date) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    const fromStr = availableFrom.getTime() === 0 || availableFrom <= new Date() ? 'ปัจจุบัน' : formatD(availableFrom);
    const untilStr = availableUntil ? formatD(availableUntil) : 'ไม่มีกำหนด';

    return `ว่าง : ${fromStr} - ${untilStr}`;
};
