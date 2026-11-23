# Managed measurement export

Any acquisition protocol can produce measurements through `createRuntimeClient().metrics.publish(channels)`. The app owns its controller, fieldbus, sensor or file-format driver. Its JavaScript SDK client sends selected observations to the Box. The runtime knows the calling installation and routes its series to the stock Prometheus instance.

| Driver input | Stable channel name | Published value |
| --- | --- | --- |
| OPC UA axis position with Good quality | `robot_a1_degrees` | `-5.34` |
| PROFINET cyclic input for a pump | `pump_1_running` | `1` |
| EtherCAT process data for a drive | `drive_2_speed_rpm` | `1450` |
| Lost input or invalid sample | same configured name | `null` |

A channel name identifies one signal within the installation. Separate applications can reuse the same names because Edge supplies `app_id`. If one application reads several machines, persist a unique name per machine and signal. Include engineering units when the reading has units. Use stable identifiers from configuration independently of array positions and device enumeration order.

```js
const { createRuntimeClient } = require('@orenda/box-sdk');
const runtime = createRuntimeClient();

async function publishReadings(readings) {
  const channels = readings.map(({ name, value, valid }) => ({
    name,
    value: valid && typeof value === 'boolean' ? Number(value)
      : valid && Number.isFinite(value) ? value : null
  }));
  return runtime.metrics.publish(channels);
}
```

A native driver can pass a batch to its JavaScript parent over a private pipe. Publish the latest complete set on a bounded timer independent of the wire cycle. Apply scaling, units and the protocol's validity flags inside the adapter. A register address, OPC UA NodeId or EtherCAT object index belongs in the adapter's configuration. Keep changes of state that require delivery as events in the application. This snapshot API serves numeric telemetry.

Transport permissions remain separate. A driver using a Box network interface or a host-owned hardware service must use the corresponding supported acquisition and permission mechanism.

## Contract and collection

SDK contract 1.3, Edge Manager 0.2.80 and the coordinated DevicePlatform 0.2.92 introduce `prometheus:publish`. Request it in the app manifest. Box owners approve it during the standard market install. The Box creates its own scrape credential at startup and Prometheus already has the job. There is no per-app host installation.

Use `runtime.metrics.publish([{name: 'axis_a1_degrees', value: -5.34}])` with `createRuntimeClient()` from `@orenda/box-sdk`. Publish a full snapshot at least every ten seconds. A null value reports a bad or unavailable channel. An empty array clears this app's channels. Up to 128 channels are accepted per snapshot and 512 distinct names per hour. Readings expire after 30 seconds. The server derives the app ID from its per-install runtime credential.

Query `orenda_app_channel_value{app_id="orenda-opcua",channel="axis_a1_degrees"}`. The accompanying `orenda_app_channel_good` and `orenda_app_channels_ready` gauges distinguish poor-quality data and a stale publisher. A successful publish returns the accepted count and the last time the authenticated Box scraper collected a fresh snapshot. This timestamp describes the scrape request. The SDK grants no Prometheus query or administrative privileges.
