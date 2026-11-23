const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeClient } = require('../lib');

test('OPC UA, PROFINET and EtherCAT adapters use one measurement request shape', async () => {
  const sources = [
    { name:'fixture-opcua', channels:[{name:'axis_position_degrees',value:-5.34}] },
    { name:'fixture-profinet', channels:[{name:'pump_1_running',value:1}, {name:'pump_2_running',value:0}] },
    { name:'fixture-ethercat', channels:[{name:'drive_speed_rpm',value:1450}, {name:'drive_temperature_celsius',value:null}] }
  ];
  for (const source of sources) {
    const requests = [];
    const sdk = createRuntimeClient({baseUrl:'http://fixture/runtime', token:source.name,
      fetchImpl:async (url, options) => {
        requests.push({url, method:options.method, credential:options.headers.Authorization, payload:JSON.parse(options.body)});
        return {ok:true, json:async () => ({accepted:source.channels.length,lastScrape:null})};
      }});
    assert.equal((await sdk.metrics.publish(source.channels)).accepted,source.channels.length);
    assert.deepEqual(requests,[{url:'http://fixture/runtime/prometheus/channels',method:'POST',
      credential:'Bearer '+source.name,payload:{channels:source.channels}}]);
  }
});
