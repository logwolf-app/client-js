# Changelog

## 2.0.0

Needs a Logwolf server with `GET /logs/:id`: the multi-tenancy release or later. Against an older server, `getOne` always resolves to `undefined`.

### Breaking

- **`getOne(id)` asks the server for that event** (`GET /logs/:id`) instead of fetching the latest page and searching it. It now finds an event of any age; it used to miss anything older than the newest 20. It resolves to `undefined` when the key's project has no event with that id, and throws on any other failure, as the other methods do. It needs a key with the `read` scope.
- **`getAll()` refuses a page the server would.** `pageSize` must be a whole number up to `MAX_PAGE_SIZE` (100) and `page` one up to `MAX_PAGE` (1,000,000). Anything else throws a `ZodError` before a request is made. A fractional or oversized `pageSize` used to be sent as it was.

### Added

- `MAX_PAGE_SIZE` and `MAX_PAGE`, exported.

### Fixed

- `getAll()`'s response was typed as the DOM's `Event[]` before parsing.

## 1.1.1

- Handle base URLs with a path (`https://example.com/api`).

## 1.1.0

Needs a Logwolf server with `POST /logs/batch`.

### Breaking

Released as a minor version, but these change existing code:

- **`capture(event)` queues the event instead of sending it.** It is synchronous and returns `true` if the event was queued, `false` if sampling dropped it. It no longer returns a promise. Call `flush()` before the process exits to send what is queued.
- **The batching options are required:** `flushIntervalMs`, `maxBatchSize`, `maxQueueSize`, `retryDelaysMs` and `requestTimeoutMs`.
- **`apiKey` must be at least 10 characters.**
- **`LogwolfEvent.toJson()` is now `toObject()`.** It returns the encoded object instead of a JSON string.

### Added

- Batched delivery: queued events are sent to `POST /logs/batch` every `flushIntervalMs`, or as soon as `maxBatchSize` are queued.
- Retries: a batch that fails with a network error or a non-2xx status is retried after each delay in `retryDelaysMs`. A 401 or 403 is not retried.
- `requestTimeoutMs` aborts any request that takes longer.
- `maxQueueSize` caps the queue; when it is full, the oldest event is dropped.
- `onDropped(events, reason)`, called when events are dropped, with the reason `queue_full`, `send_failed`, `auth_error_401` or `auth_error_403`.
- `flush()`, which sends the queue now, and `destroy()`, which stops the flush timer.
- `LogwolfEvent.stop()`, which freezes the event's duration. `capture()` and `create()` call it, so an event's duration ends when it is queued, not when it is sent.

## 1.0.0

First release as `@logwolf/client-js`. The code is that of `@jpricardo/logwolf-client-js` 1.0.8; only the package name changed.

To move over, replace the dependency and the imports:

```sh
npm uninstall @jpricardo/logwolf-client-js
npm install @logwolf/client-js
```
