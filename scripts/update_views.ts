import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zjtiiyzowyrqzubpucxm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqdGlpeXpvd3lycXp1YnB1Y3htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODM4MTksImV4cCI6MjA5MjU1OTgxOX0.OSJrGLgYkTNQ95tbs0QNo6JqgU7XXzBThsCEZqENHgE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Updating rooms...');
    const { data: rooms1, error: e1 } = await supabase.from('rooms').update({ view_direction: 'ทิศตะวันออก' }).eq('view_direction', 'ซอยตั้งสิน');
    if (e1) console.error('Error updating rooms (ซอยตั้งสิน):', e1);
    
    const { data: rooms2, error: e2 } = await supabase.from('rooms').update({ view_direction: 'ทิศตะวันตก' }).eq('view_direction', 'คอนโด');
    if (e2) console.error('Error updating rooms (คอนโด):', e2);

    console.log('Updating waitlists...');
    const { data: w1, error: e3 } = await supabase.from('waitlists').update({ view_preference: 'ทิศตะวันออก' }).eq('view_preference', 'ซอยตั้งสิน');
    if (e3) console.error('Error updating waitlists (ซอยตั้งสิน):', e3);

    const { data: w2, error: e4 } = await supabase.from('waitlists').update({ view_preference: 'ทิศตะวันตก' }).eq('view_preference', 'คอนโด');
    if (e4) console.error('Error updating waitlists (คอนโด):', e4);

    console.log('Done.');
}

run();
