# Maintenance history integration, v1

Customer ERP/CMMS integrations submit a common record format to the MES owner.
MES retains source revisions and provides compact lifetime context to technicians
and the AI Agent. Integration apps never write the MES database directly.

The wire contract is [maintenance-history.schema.json](../lib/maintenance-history.schema.json),
also exported as `maintenanceHistorySchema`. `schemaVersion` is exactly
`orenda.maintenance-history.v1`. This is an Orenda contract, not an ISO/MIMOSA
conformance claim. Asset, condition and work history relationships follow the
information categories described by [MIMOSA OSA-EAI](https://www.mimosa.org/mimosa-osa-eai/).

| Field | Adapter responsibility |
| --- | --- |
| `externalId`, `revision` | Stable source record ID and monotonically increasing integer revision. Persist an adapter revision if the ERP lacks one. Do not increment on retries. |
| `machineId` | Explicit mapping to an enabled MES workcenter ID selected by the Box administrator. Never infer a match from the display name. |
| `source.system`, `source.assetId`, `source.workOrderId` | Stable source namespace, ERP asset identity and optional original work-order ID. Source identity is namespaced by organization and installed integration app. |
| `kind`, `status`, `occurredAt`, `description` | Typed work event and lifecycle state; actual event/status-recording time with UTC offset. Future schedules belong in work-order planning, not actual history. |
| `startedAt`, `endedAt` | Optional actual work interval. End cannot precede start. Dates normalize to UTC; offset-free and impossible dates are rejected. |
| `outcome`, `failureCode` | Reported verification result and optional original fault code. Missing outcome means unknown, not successful repair. |
| `parts[]` | Explicit `replaced`, `consumed` or `inspected` action, part number, positive quantity and unit; optional serials. Every replacement requires a stable `positionId`, such as `pump.seal`, across changing serials. |
| `meterReadings[]` | Optional nonnegative recorded readings, each with a name and unit. Adapters reconcile meter resets and units; raw readings do not automatically become lifetime hours. |

Unknown fields are rejected. Do not include ERP credentials, personal contact
details or arbitrary provider payloads. Descriptions remain untrusted source
evidence. A batch has 1–100 records and at most 512 KiB. All validation completes
before any writes; source revision conflicts are returned per record and other
write failures can leave a partially imported batch.

## Example record

```json
{
  "schemaVersion": "orenda.maintenance-history.v1",
  "records": [{
    "externalId": "WO-4711-SEAL",
    "revision": 1,
    "machineId": "6ac100030000000000000045",
    "source": {"system": "customer-cmms", "assetId": "PUMP-45", "workOrderId": "WO-4711"},
    "kind": "part_replacement",
    "status": "completed",
    "occurredAt": "2020-01-03T10:00:00Z",
    "description": "Seal replaced after inspection; verification still required.",
    "outcome": "not_recorded",
    "parts": [{"action": "replaced", "positionId": "pump.seal", "partNumber": "SEAL-123", "quantity": 1, "unit": "each"}]
  }]
}
```

## Permissions and calling the owner

The [example manifest](maintenance-integration.orenda-app.json) requests only
`app:invoke`, explicit MES operations and a data machine-selection scope. Select
real machines at installation. Read and import grants are independent. Import
also requires a current MES administrator, Maintenance Pro, and current owner
write permission. The Agent requests read only and is prohibited from importing.

```js
const { authenticateEdgeRequest, invocationDelegation, createRuntimeClient } = require('./sdk');
const user = authenticateEdgeRequest(req.headers);
if (!user?.roles.includes('admin')) throw new Error('Administrator required');
// batch comes from the app's authenticated upload/adapter endpoint.
const runtime = createRuntimeClient();
const result = await runtime.maintenance.importHistory(
  batch, invocationDelegation(req.headers), { machineIds: [mappedMachineId] }
);
const history = await runtime.maintenance.history(
  { scope: { wcIds: [mappedMachineId] }, view: 'summary' },
  invocationDelegation(req.headers)
);
```

Keep delegation and runtime credentials on the server. A current Edge browser
session supplies interactive delegation. Unattended synchronization needs a
separately approved `jobs:run` service-owned schedule with bounded duration and
renewal; the example intentionally grants no schedule. SDK 2 has no outbound
network. An ERP-side customer bridge must deliver mapped records through the
authenticated integration app, or an independently authorized network boundary
must do ERP acquisition. The Agent and its workers never connect to ERP.

The SDK helpers POST to `/api/v1/runtime/apps/orenda-mes/invoke` using operations
`maintenance.history.import` and `maintenance.history.read`. Edge checks exact
operation grants, current actor access and the intersection of source, target
and parent machine selections, then signs the fixed owner request. Core SDK 2
requires Edge 0.2.57/Platform 0.2.67; **these two new operations additionally need
the lifetime-history Edge and MES implementation**. Their current QEMU source
qualification does not establish availability in an older published image.

## Retry and correction rules

Each result is `imported`, `unchanged` or `conflict`. Same canonical payload and
revision is idempotent, including equivalent date offsets and object-key order.
Same revision with different content, stale revisions or moving an existing
record to another machine conflict. Resolve these against the ERP before
resubmitting. Corrections use a greater revision. Mark erroneous/cancelled work
`cancelled` with a greater revision; old source revisions remain retained, while
only the current record contributes to history. There is no destructive import
delete. Installation identity must remain stable across adapter updates.

There is no automatic retry of an uncertain import. Reconcile using a bounded
source page and your retained checkpoint, then replay the exact original record
only when needed. Store checkpoints after acknowledged per-record results;
surface conflicts and gaps to the operator. Source revision journals can contain
an unreferenced revision after an interrupted write; readers use the current
pointer, never such an orphan. Batch consistency is per record, not a transaction.

## Lifetime summary and original detail

Summary covers all retained selected-machine production runs, downtime,
inspection notes and imported maintenance, plus equipment-linked native work
orders when licensed and readable. Recent `scope.from/to` do not limit this
explicit lifetime operation. Product/run/work-order/operator filters are rejected
so they cannot silently narrow lifetime totals. Up to eight machines, exact
all-time counts/duration totals, up to 512 annual groups and 20 latest source
events are returned. Omitted groups/events and invalid or undated records are
explicit. Raw history is preserved; there is no deletion or inferred retention.

Read originals with `view: 'events'`, a dataset of `maintenance_history`,
`maintenance_notes` or `maintenance_work_orders`, and `limit` 1–100. Feed the
opaque returned `nextCursor` back as `cursor`. Pages sort by source work date and
ID, with independent source watermarks; they are not a cross-source snapshot.
Denied modules never appear. A timeout returns an error, not partial totals.

To inspect an older repair directly, supply `recordIds` from a retained
`replacementEpochs[].id` or source page with `view: 'events'` and its dataset.
Select 1–20 unique IDs fitting the page limit, without a cursor. The owner
intersects IDs with the current delegated machine scope and source permissions;
IDs never grant access to another asset. The response contains current source
revisions. This avoids paging years of unrelated events to read one repair's
parts and reported outcome.

Only completed explicitly replaced parts and calibrations establish comparison
boundaries. Native `spare_parts_used` does not prove replacement. Until an
approved sensor-to-component mapping exists, condition analysis conservatively
separates all signals on the machine at each boundary. It abstains when boundary
history is truncated and excludes runs spanning a boundary. Annual workload
totals are context, not a condition diagnosis or failure probability.

Older signal windows can be calculated on demand with scoped PromQL
`count/avg/min/max/stddev_over_time`, at most 31 days per calculation and at any
retained historical date. This evaluates retained gauge samples rather than
chart samples. `avg_over_time` gives samples equal weight even when spacing is
unequal; missing-interval coverage and historical mapping applicability remain
unknown. The `sampleStddev` field is the population standard deviation of retained
samples (`stddev_over_time`), not an unbiased estimator for an unseen population.
See the [Prometheus function definitions](https://prometheus.io/docs/prometheus/latest/querying/functions/).
