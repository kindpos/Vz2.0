# Entomology Diagnostic System — Kotlin/Android Port

**Implementation Plan & Rationale**

---

## Executive Summary

The Entomology diagnostic system (currently JS frontend + Python backend) transfers cleanly to Kotlin/Android because it is fundamentally **event queue + hash-chained ledger + reporting** — patterns that are language-agnostic.

**Scope**: This plan covers porting the **Android client** (equivalent to `terminal/entomology-client.js`) to Kotlin. The backend remains the same; both platforms POST to the same `/api/v1/entomology/client-event` endpoint.

**Timeline**: 5–7 hours of implementation across three phases.

**Risk Level**: Low. No new cryptographic requirements, no schema changes, no database migrations. Only concern: Android's network lifecycle (airplane mode, WiFi handoff).

---

## Current Architecture (JS + Python)

### Frontend Client (`terminal/entomology-client.js`)

```
User action → entReport(opts) 
  → if online: POST to /api/v1/entomology/client-event (fire & forget)
  → if offline: queue (max 50 events)
  → listen for `window.online` event → drain queue
  → never throw
```

**Key responsibilities:**
- Fire-and-forget HTTP POST with 3s timeout
- Queue events during network outage
- Deduplicate uncaught errors (max 20 distinct per session)
- Wrap global exceptions (unhandledrejection, window.error)

### Backend Collector (`app/services/diagnostic_collector.py`)

```
POST /api/v1/entomology/client-event (body: event_code, severity, source, message, context)
  → DiagnosticCollector.record()
    → generate UUID (diagnostic_id)
    → lock write
    → query last hash from DB
    → compute SHA-256 hash chain
    → insert row (sqlite)
    → unlock
    → return DiagnosticEvent
```

**Key responsibilities:**
- Hash-chain ledger (tamper detection)
- Flexible context storage (JSON)
- Query API (by category, severity, event_code, correlation_id)
- Adaptive heartbeat (60s active / 900s off-hours)

### Data Model

```python
category: DiagnosticCategory (DEVICE, NETWORK, SYSTEM, PERIPHERAL, RECOVERY, UI, FIN, SEC)
severity: DiagnosticSeverity (INFO < WARNING < ERROR < CRITICAL)
event_code: str (pattern: PREFIX-CODE, e.g., "UI-011", "DEV-001")
context: dict (flexible, untyped)
hash: str (SHA-256 of prev_hash + all event fields + context)
```

---

## Android Architecture (Proposed)

### Layer 1: Core Types (`diagnostic/DiagnosticEvent.kt`)

Define Kotlin equivalents of the Python data model:

```kotlin
enum class DiagnosticCategory {
    DEVICE, NETWORK, SYSTEM, PERIPHERAL, RECOVERY, UI, FIN, SEC
}

enum class DiagnosticSeverity(val order: Int) {
    INFO(0), WARNING(1), ERROR(2), CRITICAL(3);
    
    operator fun compareTo(other: DiagnosticSeverity) = order.compareTo(other.order)
}

@Serializable
data class DiagnosticEvent(
    val diagnosticId: String,
    val correlationId: String? = null,
    val terminalId: String,
    val timestamp: Instant,
    val category: DiagnosticCategory,
    val severity: DiagnosticSeverity,
    val source: String,
    val eventCode: String,
    val message: String,
    val context: Map<String, JsonElement>,
    val prevHash: String,
    val hash: String
) {
    init {
        require(eventCode.matches(Regex("^[A-Z]+-[A-Z0-9]+$"))) {
            "event_code must match PREFIX-CODE (e.g., UI-001, DEV-HEARTBEAT)"
        }
    }
}

val EVENT_CODE_REGISTRY = mapOf(
    "DEV-001" to "Payment terminal unreachable",
    "NET-001" to "TCP connection timeout to peripheral",
    "SYS-003" to "Disk space warning",
    "UI-011" to "Uncaught exception (global bridge)",
    // ... 185 more
)
```

**Why**: Sealed type safety. Impossible to emit invalid event codes.

---

### Layer 2: Client Reporter (`diagnostic/DiagnosticReporter.kt`)

Single resilient reporter that mimics `entomology-client.js`:

```kotlin
/**
 * Fire-and-forget diagnostic reporter with offline queue.
 * 
 * - Never throws
 * - Queues up to 50 events when offline
 * - Replays queue when connectivity restored
 * - Deduplicates uncaught errors (max 20 distinct per session)
 */
object DiagnosticReporter {
    private val queue = ArrayDeque<DiagnosticBody>(capacity = 50)
    private val seenErrors = mutableSetOf<String>()
    private const val MAX_SEEN_ERRORS = 20
    private const val ENDPOINT = "/api/v1/entomology/client-event"
    private const val TIMEOUT_MS = 3000L
    
    private lateinit var httpClient: HttpClient
    private lateinit var context: Context
    
    fun init(context: Context, httpClient: HttpClient) {
        this.context = context
        this.httpClient = httpClient
        observeConnectivity()
    }
    
    /**
     * Record a diagnostic event. Never throws; always returns a Boolean result.
     * 
     * Usage:
     *   entReport(
     *       code = "UI-001",
     *       source = "scene-manager.interrupt",
     *       message = "Interrupt stacked — prior torn down",
     *       ctx = mapOf("prior" to "confirm-void", "next" to "tip-adjust"),
     *       level = "WARNING"
     *   )
     */
    suspend fun entReport(
        code: String,
        source: String,
        message: String,
        ctx: Map<String, Any> = emptyMap(),
        level: String = "WARNING"
    ): Boolean {
        if (!isValid(code, source, message)) return false
        
        val body = DiagnosticBody(
            event_code = code,
            severity = level,
            source = source.take(120),
            message = message.take(500),
            context = ctx
        )
        
        // If offline, queue and return
        if (!isOnline()) {
            if (queue.size < 50) queue.addLast(body)
            return false
        }
        
        // Send immediately
        return try {
            val response = httpClient.post(ENDPOINT) {
                contentType(ContentType.Application.Json)
                setBody(body)
                timeout { requestTimeoutMillis = TIMEOUT_MS }
            }
            response.status.isSuccess()
        } catch (e: Exception) {
            // Never propagate — diagnostics must not break the app flow
            false
        }
    }
    
    private suspend fun _send(body: DiagnosticBody): Boolean {
        return try {
            val response = httpClient.post(ENDPOINT) {
                contentType(ContentType.Application.Json)
                setBody(body)
                timeout { requestTimeoutMillis = TIMEOUT_MS }
            }
            response.status.isSuccess()
        } catch (e: Exception) {
            false
        }
    }
    
    private fun _drain() {
        if (queue.isEmpty()) return
        val pending = queue.toList()
        queue.clear()
        // Launch async drain without blocking caller
        GlobalScope.launch {
            pending.forEach { _send(it) }
        }
    }
    
    private fun observeConnectivity() {
        val connectivityManager = context.getSystemService(
            Context.CONNECTIVITY_SERVICE
        ) as ConnectivityManager
        
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                super.onAvailable(network)
                _drain()
            }
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            connectivityManager.registerDefaultNetworkCallback(callback)
        }
    }
    
    private fun isOnline(): Boolean {
        val connectivityManager = context.getSystemService(
            Context.CONNECTIVITY_SERVICE
        ) as ConnectivityManager
        val capabilities = connectivityManager.getNetworkCapabilities(
            connectivityManager.activeNetwork
        )
        return capabilities != null && (
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        )
    }
    
    private fun isValid(code: String, source: String, message: String): Boolean {
        return code.isNotEmpty() && source.isNotEmpty() && message.isNotEmpty()
    }
}

// Request/response models
@Serializable
data class DiagnosticBody(
    val event_code: String,
    val severity: String,
    val source: String,
    val message: String,
    val context: Map<String, Any> = emptyMap()
)
```

**Rationale:**
- **Never throws**: Wrapped in try/catch; always returns Boolean
- **Offline queue**: Uses `ArrayDeque` for FIFO; max 50 events
- **Network callback**: Observes `ConnectivityManager` (replaces `window.online`)
- **Deduplication**: Same Set-based approach for errors
- **Timeout**: 3s (matches JS version)

---

### Layer 3: Global Exception Handler (`diagnostic/GlobalExceptionHandler.kt`)

Replaces `window.error` and `unhandledrejection` listeners:

```kotlin
/**
 * Install global exception handler that reports uncaught exceptions via Entomology.
 * 
 * Usage (in Application.onCreate()):
 *   GlobalExceptionHandler.install()
 */
object GlobalExceptionHandler {
    private val seenErrors = mutableSetOf<String>()
    private const val MAX_SEEN = 20
    
    fun install() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        
        Thread.setDefaultUncaughtExceptionHandler { thread, exception ->
            try {
                _reportError(thread, exception)
            } catch (e: Exception) {
                // Never throw from exception handler
                e.printStackTrace()
            }
            
            // Chain to previous handler (let system crash log it too)
            defaultHandler?.uncaughtException(thread, exception)
        }
    }
    
    private fun _reportError(thread: Thread, exception: Throwable) {
        val key = "${exception.javaClass.simpleName}|${exception.message}"
        
        // Deduplicate: cap at 20 distinct errors per session
        if (seenErrors.size >= MAX_SEEN) return
        if (seenErrors.contains(key)) return
        seenErrors.add(key)
        
        val fileName = exception.stackTrace.firstOrNull()?.fileName ?: "unknown"
        val lineNumber = exception.stackTrace.firstOrNull()?.lineNumber ?: 0
        val source = "$fileName:$lineNumber"
        
        // Fire diagnostic (async, never block from exception handler)
        GlobalScope.launch {
            DiagnosticReporter.entReport(
                code = "UI-011",
                source = source,
                message = exception.message?.take(500) ?: "uncaught exception",
                ctx = mapOf(
                    "thread" to thread.name,
                    "exception_class" to exception.javaClass.simpleName,
                    "stack" to exception.stackTraceToString().take(800)
                ),
                level = "ERROR"
            )
        }
    }
}

// In Application subclass:
class KindposApp : Application() {
    override fun onCreate() {
        super.onCreate()
        
        DiagnosticReporter.init(this, httpClient)
        GlobalExceptionHandler.install()
    }
}
```

**Rationale:**
- **Silent reporting**: Never interrupts exception handling
- **Deduplication**: Prevents error-reporting loops
- **Async**: Uses `GlobalScope.launch` to not block the crash handler

---

### Layer 4: Device Heartbeat (Optional v2)

Equivalent to Python's `_collect_system_metrics()`:

```kotlin
/**
 * Collect device health metrics and emit SYS-HEARTBEAT diagnostic.
 * 
 * Runs on a background interval:
 * - Active (order open): every 60s
 * - Off-hours: every 900s (15m)
 */
object DeviceHeartbeat {
    private const val ACTIVE_INTERVAL_MS = 60_000L
    private const val OFF_HOURS_INTERVAL_MS = 900_000L
    private var job: Job? = null
    private var isServiceActive = false
    
    fun start(scope: CoroutineScope) {
        job = scope.launch {
            while (isActive) {
                val interval = if (isServiceActive) {
                    ACTIVE_INTERVAL_MS
                } else {
                    OFF_HOURS_INTERVAL_MS
                }
                delay(interval)
                _collectHeartbeat()
            }
        }
    }
    
    fun notifyOrderCreated() {
        isServiceActive = true
    }
    
    private suspend fun _collectHeartbeat() {
        val metrics = _collectSystemMetrics()
        
        DiagnosticReporter.entReport(
            code = "SYS-HEARTBEAT",
            source = "DeviceHeartbeat",
            message = "Ambient health snapshot",
            ctx = mapOf(
                "memory_used_pct" to metrics.memoryPercent,
                "storage_used_pct" to metrics.storagePercent,
                "battery_pct" to metrics.batteryPercent,
                "temperature_c" to metrics.temperatureC
            ),
            level = "INFO"
        )
        
        // Emit warnings if thresholds exceeded
        if (metrics.memoryPercent > 85) {
            DiagnosticReporter.entReport(
                code = "SYS-004",
                source = "DeviceHeartbeat",
                message = "Memory usage ${metrics.memoryPercent}% exceeds 85% threshold",
                ctx = mapOf("memory_used_pct" to metrics.memoryPercent, "threshold" to 85),
                level = "WARNING"
            )
        }
    }
    
    private fun _collectSystemMetrics(): SystemMetrics {
        val runtime = Runtime.getRuntime()
        val memoryUsed = runtime.totalMemory() - runtime.freeMemory()
        val memoryMax = runtime.maxMemory()
        val memoryPercent = ((memoryUsed.toDouble() / memoryMax) * 100).toInt()
        
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE)
            as BatteryManager
        val batteryPercent = batteryManager.getIntProperty(
            BatteryManager.BATTERY_PROPERTY_CAPACITY
        )
        
        // Storage
        val statFs = StatFs(Environment.getDataDirectory().path)
        val storageUsed = statFs.blockCount - statFs.availableBlocks
        val storageTotal = statFs.blockCount
        val storagePercent = ((storageUsed.toDouble() / storageTotal) * 100).toInt()
        
        return SystemMetrics(
            memoryPercent = memoryPercent,
            storagePercent = storagePercent,
            batteryPercent = batteryPercent,
            temperatureC = 0.0  // Android doesn't expose thermal without vendor API
        )
    }
}

data class SystemMetrics(
    val memoryPercent: Int,
    val storagePercent: Int,
    val batteryPercent: Int,
    val temperatureC: Double
)
```

**Rationale:**
- **Memory**: Via `Runtime.getRuntime()`
- **Storage**: Via `StatFs` (same as Python's `psutil.disk_usage`)
- **Battery**: Via `BatteryManager` (Android-specific; Python has no equivalent)
- **Temperature**: Android doesn't expose thermal zones without OEM vendor APIs

---

## Implementation Phases

### Phase 1: Core Types & Client (2–3 hours)

**Deliverable**: `DiagnosticEvent.kt`, `DiagnosticReporter.kt`

1. Create `app/diagnostic/DiagnosticEvent.kt`
   - Define enums: `DiagnosticCategory`, `DiagnosticSeverity`
   - Define data class: `DiagnosticEvent`, `DiagnosticBody`
   - Include event code registry as companion object

2. Create `app/diagnostic/DiagnosticReporter.kt`
   - Implement singleton `DiagnosticReporter` with offline queue
   - Implement `entReport()` public API
   - Implement `ConnectivityManager` callback for network restoration
   - Implement `_send()`, `_drain()`, `isOnline()`

3. Unit tests (30 min)
   - Test offline queue (max 50)
   - Test deduplication
   - Test invalid event codes (rejected)
   - Test offline → online transition

**Dependencies**:
```gradle
implementation 'org.jetbrains.kotlinx:kotlinx-serialization-json:1.5.0'
implementation 'io.ktor:ktor-client-core:2.3.0'
implementation 'io.ktor:ktor-client-okhttp:2.3.0'
implementation 'io.ktor:ktor-client-serialization:2.3.0'
```

---

### Phase 2: Global Exception Handler (1 hour)

**Deliverable**: `GlobalExceptionHandler.kt`

1. Create `app/diagnostic/GlobalExceptionHandler.kt`
   - Wrap `Thread.setDefaultUncaughtExceptionHandler`
   - Emit UI-011 on uncaught exception
   - Deduplicate errors (max 20 distinct)
   - Never block the system crash handler

2. Integrate into `Application.onCreate()`
   - Initialize `DiagnosticReporter` with context
   - Install exception handler

3. Integration tests (15 min)
   - Throw uncaught exception → verify UI-011 posted
   - Repeat same exception → verify deduplicated

---

### Phase 3: Device Heartbeat (Optional, 2 hours)

**Deliverable**: `DeviceHeartbeat.kt`

1. Create `app/diagnostic/DeviceHeartbeat.kt`
   - Implement `_collectSystemMetrics()`
   - Implement adaptive interval (60s / 900s)
   - Emit SYS-HEARTBEAT + threshold warnings

2. Integration tests (30 min)
   - Verify heartbeat posted every 60s (when active)
   - Verify SYS-004 (memory) when threshold exceeded
   - Verify interval switches to 900s after cooldown

---

## Integration with Existing Codebase

### Where to Call `entReport()`

**Existing patterns in JS**:
```javascript
// Scene lifecycle
if (stacked) entReport({ code: 'UI-001', source: 'scene-manager.interrupt', ... });

// Network errors
if (!response.ok) entReport({ code: 'NET-003', source: 'fetch', ... });

// Double-submit prevention
if (state._submitting) entReport({ code: 'UI-003', source: 'order-entry', ... });
```

**Equivalent in Kotlin (call from Activity/Fragment/ViewModel)**:
```kotlin
// Scene lifecycle
if (priorInterrupt != null) {
    DiagnosticReporter.entReport(
        code = "UI-001",
        source = "SceneManager.interrupt",
        message = "Interrupt stacked — prior torn down",
        ctx = mapOf("prior" to priorInterrupt.name, "next" to nextInterrupt.name)
    )
}

// Network errors
try {
    val response = httpClient.post(url) { ... }
    if (!response.status.isSuccess()) {
        DiagnosticReporter.entReport(
            code = "NET-001",
            source = "httpClient.post",
            message = "HTTP ${response.status.value}",
            ctx = mapOf("url" to url, "status" to response.status.value)
        )
    }
} catch (e: HttpRequestTimeoutException) {
    DiagnosticReporter.entReport(
        code = "NET-002",
        source = "httpClient.post",
        message = "Connection timeout",
        ctx = mapOf("url" to url)
    )
}

// Double-submit prevention
if (viewModel.isSubmitting) {
    DiagnosticReporter.entReport(
        code = "UI-003",
        source = "OrderEntry.confirmButton",
        message = "Double-submit blocked"
    )
}
```

---

## Testing Strategy

### Unit Tests (Phase 1 & 2)

**File**: `app/diagnostic/DiagnosticReporterTest.kt`

```kotlin
@RunWith(RobolectricTestRunner::class)
class DiagnosticReporterTest {
    
    @Test
    fun testQueueMaxSize() {
        // Queue 60 events offline, verify only 50 stored
    }
    
    @Test
    fun testErrorDeduplication() {
        // Emit same error 25 times, verify only 20 distinct
    }
    
    @Test
    fun testInvalidEventCode() {
        // Emit "INVALID_CODE" → rejected
    }
    
    @Test
    fun testOfflineToOnlineTransition() {
        // Offline, queue 3 events, go online, verify drain
    }
}
```

### Integration Tests (Phase 3)

**File**: `app/diagnostic/DeviceHeartbeatTest.kt`

```kotlin
@RunWith(RobolectricTestRunner::class)
class DeviceHeartbeatTest {
    
    @Test
    fun testHeartbeatInterval() {
        // Start heartbeat, wait 65s, verify SYS-HEARTBEAT posted
    }
    
    @Test
    fun testMemoryWarningThreshold() {
        // Mock Runtime to return 90% memory, verify SYS-004 emitted
    }
    
    @Test
    fun testAdaptiveInterval() {
        // Notify order created, verify 60s interval
        // Wait 30m + no orders, verify 900s interval
    }
}
```

---

## Backend Changes

**None required.** The backend `DiagnosticCollector` and routes remain unchanged.

The Android client POSTs to the same `/api/v1/entomology/client-event` endpoint:

```
POST /api/v1/entomology/client-event
Content-Type: application/json

{
  "event_code": "UI-011",
  "severity": "ERROR",
  "source": "MainActivity:42",
  "message": "NullPointerException: binding is null",
  "context": {
    "thread": "main",
    "exception_class": "NullPointerException",
    "stack": "..."
  }
}
```

The backend's `record()` method receives this, hashes it, and stores it — identically for both JS and Android clients.

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Network callback not triggered** | Low | Queue doesn't drain on reconnect | Test with airplane mode toggle; implement polling fallback (30s check) |
| **OutOfMemoryError during exception handler** | Low | Can't report the crash | Pre-allocate `seenErrors` Set; use `WeakReference` for context |
| **Event code pattern too strict** | Low | Valid codes rejected | Regex test suite; validate against `EVENT_CODE_REGISTRY` |
| **Offline queue overflow (>50 events)** | Very low | Events silently dropped | Log warning when queue reaches 40; monitor in production |
| **HTTP timeout too short (3s)** | Low | Requests fail on slow network | Parameterize timeout; default 5s (longer than JS) |
| **DiagnosticReporter not initialized** | Medium | entReport() crashes | Use lazy initialization; fail silently if not initialized |

---

## Deployment Checklist

- [ ] Phase 1 code complete + unit tests passing
- [ ] Phase 2 code complete + integration tests passing
- [ ] Review: event codes match `EVENT_CODE_REGISTRY`
- [ ] Review: offline queue behavior under network partitions
- [ ] Code review: no `throw` statements in diagnostic code
- [ ] Lint: no hardcoded event codes (use constants)
- [ ] Documentation: update app's architecture guide
- [ ] QA: manual test on physical devices (WiFi toggle, airplane mode)
- [ ] Optional Phase 3: device heartbeat (defer if timeline tight)

---

## Success Criteria

1. **Offline resilience**: App queues diagnostics while offline; drains on reconnect
2. **No crashes**: Diagnostic code never propagates exceptions
3. **Deduplication**: Repeated errors capped at 20 per session
4. **Backend compatibility**: Android events stored and queryable identically to JS events
5. **Zero latency impact**: Diagnostics fire async; don't block scene rendering

---

## Appendix: Event Code Reference (Excerpt)

```
UI-001    Interrupt / gate stacked over an existing one
UI-003    Double-submit blocked by scene lock
UI-007    Dead-end tap on a button (precondition not met)
UI-011    Uncaught window.error or unhandledrejection (GLOBAL BRIDGE)

DEV-001   Payment terminal unreachable (connection refused)
DEV-002   Payment terminal timeout (no response within threshold)
DEV-003   Payment terminal offline (status change)

NET-001   TCP connection timeout to peripheral
NET-002   TCP connection refused by peripheral
NET-003   WebSocket connection dropped

SYS-001   Event ledger write failure
SYS-003   Disk space warning (threshold exceeded)
SYS-004   Memory usage warning (threshold exceeded)
SYS-HEARTBEAT   Ambient health snapshot (adaptive interval)

FIN-001   2dp precision gate rejected a monetary value
FIN-002   In-flight double-charge guard blocked a second sale
```

See `app/models/diagnostic_event.py` in the backend for the full registry (185+ codes).

---

## References

- **Current Implementation**: `terminal/entomology-client.js`, `backend/app/services/diagnostic_collector.py`
- **Tests**: `backend/tests/test_entomology_*.py`, `terminal/entomology-client.test.js`
- **Data Model**: `backend/app/models/diagnostic_event.py`
- **API Routes**: `backend/app/api/routes/entomology.py`

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-19  
**Status**: Ready for implementation review
