const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeClient,maintenanceHistorySchema}=require('../lib');
test('SDK maintenance integration uses explicit typed owner operations and preserves caller revision/id without replay',async()=>{
  const calls=[];const client=createRuntimeClient({baseUrl:'http://127.0.0.1:8088/api/v1/runtime',token:'synthetic-test-token',fetchImpl:async(url,input)=>{calls.push({url,input});return {ok:true,json:async()=>({results:[{status:'imported'}]})};}});
  const batch={schemaVersion:'orenda.maintenance-history.v1',records:[{externalId:'ERP-WO-42',revision:1,machineId:'a'.repeat(24)}]};
  await client.maintenance.importHistory(batch,'test-delegation',{machineIds:['a'.repeat(24)]});
  const sent=JSON.parse(calls[0].input.body);assert.equal(sent.operation,'maintenance.history.import');assert.deepEqual(sent.params,batch);assert.equal(calls.length,1);
  await client.maintenance.history({scope:{wcIds:['a'.repeat(24)]}},'test-delegation');
  assert.equal(JSON.parse(calls[1].input.body).operation,'maintenance.history.read');
  assert.equal(maintenanceHistorySchema.$id,'urn:orenda:maintenance-history:v1');assert.equal(maintenanceHistorySchema.additionalProperties,false);
});
