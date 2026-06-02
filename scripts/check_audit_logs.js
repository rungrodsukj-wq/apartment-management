const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://zjtiiyzowyrqzubpucxm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqdGlpeXpvd3lycXp1YnB1c3htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODM4MTksImV4cCI6MjA5MjU1OTgxOX0.OSJrGLgYkTNQ95tbs0QNo6JqgU7XXzBThsCEZqENHgE'
);

(async () => {
  const { data, error } = await supabase.from('audit_logs').select('id, performed_by_name').limit(1);
  console.log('error:', error);
  console.log('data:', data);
})();
