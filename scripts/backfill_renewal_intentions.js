const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) before running this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching all contracts...');
  const { data: contracts, error: contractsError } = await supabase
    .from('contracts')
    .select('id, main_room_id, temp_room_id, move_to_room_id, tenant_name');

  if (contractsError) {
    throw contractsError;
  }

  console.log('Fetching existing renewal intentions...');
  const { data: intentions, error: intentionsError } = await supabase
    .from('renewal_intentions')
    .select('contract_id');

  if (intentionsError) {
    throw intentionsError;
  }

  const existingContractIds = new Set((intentions || []).map((item) => item.contract_id));
  const missingContracts = (contracts || []).filter((contract) => contract.id && !existingContractIds.has(contract.id));

  console.log(`Found ${contracts?.length ?? 0} active/upcoming contracts.`);
  console.log(`Found ${missingContracts.length} missing renewal intention rows.`);

  if (missingContracts.length === 0) {
    console.log('No backfill required.');
    return;
  }

  const today = new Date();
  const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const inserts = missingContracts.map((contract) => ({
    contract_id: contract.id,
    room_id: contract.main_room_id || contract.temp_room_id || contract.move_to_room_id || null,
    tenant_name: contract.tenant_name || '',
    intention: 'not_asked',
    survey_month: surveyMonth,
    note: '',
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('renewal_intentions')
    .insert(inserts)
    .select('id, contract_id');

  if (insertError) {
    throw insertError;
  }

  console.log(`Inserted ${inserted?.length ?? 0} renewal intention row(s).`);
}

run().catch((error) => {
  console.error('Backfill failed:', error.message || error);
  process.exit(1);
});
