# Managed measurement export

SDK contract 1.3, Edge Manager 0.2.80 and the coordinated DevicePlatform 0.2.92 introduce `prometheus:publish`. Request it in the app manifest. Box owners approve it during the standard market install. The Box creates its own scrape credential at startup and Prometheus already has the job. There is no per-app host installation.

Use `runtime.metrics.publish([{name: 'axis_a1_degrees', value: -5.34}])` in JavaScript, or `await runtime.publish_channels([{"name":"axis_a1_degrees","value":-5.34}])` with the Python package under `python/`. Publish a full snapshot at least every ten seconds. A null value reports a bad or unavailable channel. An empty array clears this app's channels. Up to 128 channels are accepted per snapshot and 512 distinct names per hour. Readings expire after 30 seconds. The server derives the app ID from its per-install runtime credential.

Query `orenda_app_channel_value{app_id="orenda-opcua",channel="axis_a1_degrees"}`. The accompanying `orenda_app_channel_good` and `orenda_app_channels_ready` gauges distinguish poor-quality data and a stale publisher. A successful publish returns the accepted count and the last time the authenticated Box scraper collected a fresh snapshot. This timestamp describes the scrape request. The SDK grants no Prometheus query or administrative privileges.
