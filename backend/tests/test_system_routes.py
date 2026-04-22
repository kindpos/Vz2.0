"""
Tests for `api/routes/system.py` — version endpoint, pytest runner, and the
pure helpers that classify / count pytest output lines.

system.py sat at 29% coverage with no dedicated test file. The route is
manager-gated and spawns a pytest subprocess, so tests exercise:

  - classify_line    — styling classes for the Overseer UI
  - is_test_result   — which lines get counted into pass/fail/skip totals
  - _find_project_root — marker-walking (pytest.ini, fly.preview.toml, repo)
  - _resolve_test_path — direct vs nested tests/ layout
  - GET /api/v1/system/version — unauthenticated, echoes settings.app_version
  - POST /api/v1/system/run-tests — SSE stream, mocked subprocess path
  - require_manager gate — soft (tests) vs strict (production) flows
  - Integration: real pytest on a tmp dir with a single trivial test
"""

import asyncio
import json
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.api.routes import system as system_mod
from app.api.routes import auth as auth_mod
from app.config import settings


# ═════════════════════════════════════════════════════
# 1. classify_line — pure helper, styling only
# ═════════════════════════════════════════════════════

class TestClassifyLine:
    def test_passed_keyword(self):
        assert system_mod.classify_line("test_foo PASSED") == "passed"

    def test_unicode_check_mark(self):
        assert system_mod.classify_line("✓ test_foo") == "passed"

    def test_bracketed_pass_tag(self):
        assert system_mod.classify_line("[PASS] test_foo") == "passed"

    def test_failed_keyword(self):
        assert system_mod.classify_line("test_foo FAILED") == "failed"

    def test_error_keyword(self):
        assert system_mod.classify_line("ERROR collecting tests") == "failed"

    def test_skipped_keyword(self):
        assert system_mod.classify_line("test_foo SKIPPED") == "skipped"

    def test_skip_substring(self):
        assert system_mod.classify_line("SKIP reason=...") == "skipped"

    def test_equals_header(self):
        assert system_mod.classify_line("=== session starts ===") == "header"

    def test_dashes_header(self):
        assert system_mod.classify_line("--- coverage ---") == "header"

    def test_summary_line(self):
        assert system_mod.classify_line("3 passed in 0.12s") == "summary"

    def test_meta_platform(self):
        assert system_mod.classify_line("platform linux -- Python 3.11") == "meta"

    def test_meta_rootdir(self):
        assert system_mod.classify_line("rootdir: /home/user/Vz2.0/backend") == "meta"

    def test_meta_collected(self):
        assert system_mod.classify_line("collected 5 items") == "meta"

    def test_plain_text_is_normal(self):
        assert system_mod.classify_line("some random line") == "normal"

    def test_empty_string_is_normal(self):
        assert system_mod.classify_line("") == "normal"

    def test_passed_wins_over_failed_substring(self):
        """PASSED branch is evaluated before FAILED — a test named
        `test_failed_login` that passes still classifies as 'passed'."""
        assert system_mod.classify_line("test_failed_login PASSED") == "passed"


# ═════════════════════════════════════════════════════
# 2. is_test_result — which lines get counted
# ═════════════════════════════════════════════════════

class TestIsTestResult:
    def test_mid_percent(self):
        assert system_mod.is_test_result("test_x PASSED  [ 57%]") is True

    def test_hundred_percent(self):
        assert system_mod.is_test_result("test_x PASSED  [100%]") is True

    def test_single_digit_padded(self):
        assert system_mod.is_test_result("test_x PASSED [  1%]") is True

    def test_zero_percent(self):
        assert system_mod.is_test_result("test_x PASSED [  0%]") is True

    def test_no_percent(self):
        assert system_mod.is_test_result("collected 5 items") is False

    def test_time_bracket_not_percent(self):
        assert system_mod.is_test_result("[0.12s]") is False

    def test_empty(self):
        assert system_mod.is_test_result("") is False

    # ── Verbose (non-TTY) format — what subprocess.PIPE actually delivers ──
    def test_verbose_passed_no_percent(self):
        """Regression for B3: pytest under subprocess.PIPE suppresses the
        [NN%] marker, so without this match the counters stay at zero."""
        assert system_mod.is_test_result("tests/test_x.py::test_ok PASSED") is True

    def test_verbose_failed_no_percent(self):
        assert system_mod.is_test_result("tests/test_x.py::test_bad FAILED") is True

    def test_verbose_skipped_no_percent(self):
        assert system_mod.is_test_result("tests/test_x.py::test_x SKIPPED") is True

    def test_verbose_skipped_with_reason(self):
        assert system_mod.is_test_result(
            "tests/test_x.py::test_x SKIPPED (needs net)"
        ) is True

    def test_summary_line_not_counted(self):
        """pytest's FAILED summary list starts with 'FAILED <path>::<name>'
        — easy to over-match. The verbose regex anchors on the path so
        these lines don't double-count as a second failure."""
        assert system_mod.is_test_result(
            "FAILED tests/test_x.py::test_bad - AssertionError"
        ) is False

    def test_narrative_with_doublecolon_not_counted(self):
        """A narrative line containing '::' but no PASSED/FAILED/SKIPPED
        doesn't trip the counter."""
        assert system_mod.is_test_result(
            "   at module::function in /some/path"
        ) is False


# ═════════════════════════════════════════════════════
# 3. _find_project_root — marker-walking
# ═════════════════════════════════════════════════════

class TestFindProjectRoot:
    def test_pytest_ini_marker(self, tmp_path):
        root = tmp_path / "repo"
        (root / "app" / "api" / "routes").mkdir(parents=True)
        (root / "pytest.ini").write_text("[pytest]\n")
        fake_file = root / "app" / "api" / "routes" / "system.py"
        fake_file.write_text("")

        assert system_mod._find_project_root(fake_file) == root.resolve()

    def test_fly_preview_toml_marker(self, tmp_path):
        root = tmp_path / "repo"
        (root / "a" / "b").mkdir(parents=True)
        (root / "fly.preview.toml").write_text("")
        fake_file = root / "a" / "b" / "system.py"
        fake_file.write_text("")

        assert system_mod._find_project_root(fake_file) == root.resolve()

    def test_backend_frontend_siblings_marker(self, tmp_path):
        root = tmp_path / "repo"
        (root / "backend" / "app").mkdir(parents=True)
        (root / "frontend").mkdir()
        fake_file = root / "backend" / "app" / "system.py"
        fake_file.write_text("")

        assert system_mod._find_project_root(fake_file) == root.resolve()

    def test_pytest_ini_beats_repo_marker(self, tmp_path):
        """pytest.ini at the inner dir wins over backend+frontend further up —
        the loop returns on the first hit, parent-by-parent."""
        outer = tmp_path / "repo"
        (outer / "backend" / "app").mkdir(parents=True)
        (outer / "frontend").mkdir()
        (outer / "backend" / "pytest.ini").write_text("[pytest]\n")
        fake_file = outer / "backend" / "app" / "system.py"
        fake_file.write_text("")

        # pytest.ini is one parent up from the fake file; repo root is two up.
        # Walker should stop at the first hit.
        assert system_mod._find_project_root(fake_file) == (outer / "backend").resolve()

    def test_no_markers_falls_back(self, tmp_path):
        """With no markers anywhere, fallback path either lands at parents[5]
        or the root of the filesystem. Either way the call must not raise."""
        deep = tmp_path
        for seg in ["a", "b", "c", "d", "e", "f", "g"]:
            deep = deep / seg
        deep.mkdir(parents=True)
        fake_file = deep / "system.py"
        fake_file.write_text("")

        result = system_mod._find_project_root(fake_file)
        # Whatever it returns, it's a valid Path under tmp_path (or an
        # ancestor) — never raises, never returns None.
        assert isinstance(result, Path)

    def test_current_repo_resolves_to_backend(self):
        """Regression lock: the real system.py sits under backend/app/api/routes
        and pytest.ini lives at backend/pytest.ini, so PROJECT_ROOT must be
        the backend/ directory. A layout reshuffle should break this test."""
        real = system_mod._find_project_root()
        assert (real / "pytest.ini").is_file()
        assert (real / "tests").is_dir()


# ═════════════════════════════════════════════════════
# 4. _resolve_test_path — direct vs nested tests/ layout
# ═════════════════════════════════════════════════════

class TestResolveTestPath:
    def test_direct_tests_dir(self, tmp_path):
        """PROJECT_ROOT is the backend package — tests/ sits directly beneath."""
        (tmp_path / "tests").mkdir()
        assert system_mod._resolve_test_path(tmp_path) == tmp_path / "tests"

    def test_nested_backend_tests(self, tmp_path):
        """PROJECT_ROOT is the repo root — tests live at backend/tests/."""
        (tmp_path / "backend" / "tests").mkdir(parents=True)
        assert system_mod._resolve_test_path(tmp_path) == tmp_path / "backend" / "tests"

    def test_no_tests_dir_returns_direct_path(self, tmp_path):
        """Fallback: return the direct path even if it doesn't exist so pytest
        errors out loudly rather than silently running zero tests."""
        result = system_mod._resolve_test_path(tmp_path)
        assert result == tmp_path / "tests"

    def test_direct_preferred_over_nested(self, tmp_path):
        """If both layouts exist (unusual but possible), direct wins — it's
        the cheaper check and matches the pytest.ini-wins convention."""
        (tmp_path / "tests").mkdir()
        (tmp_path / "backend" / "tests").mkdir(parents=True)
        assert system_mod._resolve_test_path(tmp_path) == tmp_path / "tests"

    def test_regression_current_repo_resolves(self):
        """End-to-end: PROJECT_ROOT + _resolve_test_path lands on a real dir
        in the current repo. Guards against the COVERAGE_AUDIT finding that
        the old hardcoded 'core/backend/tests' path pointed nowhere."""
        resolved = system_mod._resolve_test_path(system_mod.PROJECT_ROOT)
        assert resolved.is_dir()
        # Must contain at least one test_*.py file
        assert any(resolved.glob("test_*.py"))


# ═════════════════════════════════════════════════════
# 5. GET /api/v1/system/version
# ═════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def client():
    """Bare AsyncClient against the real app — no ledger override needed
    for /system/version since it reads settings only."""
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_version_returns_app_version(client, monkeypatch):
    monkeypatch.setattr(settings, "app_version", "9.9.9-test")
    resp = await client.get("/api/v1/system/version")
    assert resp.status_code == 200
    assert resp.json() == {"version": "9.9.9-test"}


@pytest.mark.asyncio
async def test_version_needs_no_auth(client, monkeypatch):
    """Unauthenticated callers get the version — it's used for the Overseer
    header badge before any session exists. Flipping auth_enforced=True
    must not gate this endpoint."""
    monkeypatch.setattr(settings, "auth_enforced", True)
    resp = await client.get("/api/v1/system/version")
    assert resp.status_code == 200
    assert "version" in resp.json()


# ═════════════════════════════════════════════════════
# 6. POST /api/v1/system/run-tests — SSE with mocked thread
# ═════════════════════════════════════════════════════

def _make_scripted_thread(lines: list[str]):
    """Return a drop-in replacement for _run_pytest_in_thread that pushes
    a fixed sequence of lines into the queue instead of spawning pytest.

    Each `lines` entry becomes one queue.put. The caller is responsible
    for including a final `__DONE__:N` sentinel to terminate the stream.
    """
    def _fake(queue, loop):
        for line in lines:
            asyncio.run_coroutine_threadsafe(queue.put(line), loop)
    return _fake


async def _consume_sse(client: AsyncClient) -> list[dict]:
    """POST /run-tests and collect all parsed SSE event payloads."""
    events: list[dict] = []
    async with client.stream("POST", "/api/v1/system/run-tests") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        async for raw in resp.aiter_lines():
            if not raw.startswith("data: "):
                continue
            events.append(json.loads(raw[len("data: "):]))
    return events


@pytest.mark.asyncio
async def test_run_tests_happy_path(client, monkeypatch):
    """Two PASSED result lines produce passed=2, exit_code=0, and the
    right event sequence: start → 2× output → complete."""
    scripted = [
        "=== test session starts ===",
        "tests/test_a.py::test_ok PASSED [ 50%]",
        "tests/test_a.py::test_also_ok PASSED [100%]",
        "__DONE__:0",
    ]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)

    # start + 3 output (header + 2 results) + complete
    assert events[0]["type"] == "start"
    assert "timestamp" in events[0]

    output_events = [e for e in events if e["type"] == "output"]
    assert len(output_events) == 3
    assert output_events[0]["style"] == "header"
    assert output_events[0]["is_result"] is False
    assert output_events[1]["is_result"] is True
    assert output_events[2]["is_result"] is True

    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["exit_code"] == 0
    assert complete["passed"] == 2
    assert complete["failed"] == 0
    assert complete["skipped"] == 0


@pytest.mark.asyncio
async def test_run_tests_mixed_results(client, monkeypatch):
    """PASSED + FAILED + SKIPPED — each bumps the right counter, only
    when the line carries the [NN%] marker."""
    scripted = [
        "tests/test_x.py::test_a PASSED [ 25%]",
        "tests/test_x.py::test_b FAILED [ 50%]",
        "tests/test_x.py::test_c SKIPPED [ 75%]",
        "tests/test_x.py::test_d PASSED [100%]",
        "__DONE__:1",
    ]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)
    complete = events[-1]
    assert complete["passed"] == 2
    assert complete["failed"] == 1
    assert complete["skipped"] == 1
    assert complete["exit_code"] == 1


@pytest.mark.asyncio
async def test_run_tests_narrative_lines_dont_count(client, monkeypatch):
    """Lines containing PASSED but no [NN%] marker don't get counted —
    they can show up in assertion messages or fixture setup logs."""
    scripted = [
        "Some log mentioning PASSED but not a test line",
        "collected 5 items",
        "platform linux -- Python 3.11",
        "__DONE__:0",
    ]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)
    complete = events[-1]
    assert complete["passed"] == 0
    assert complete["failed"] == 0
    assert complete["skipped"] == 0

    # Styling still applied
    outs = [e for e in events if e["type"] == "output"]
    assert outs[0]["style"] == "passed"   # PASSED substring → passed style
    assert outs[1]["style"] == "meta"
    assert outs[2]["style"] == "meta"


@pytest.mark.asyncio
async def test_run_tests_error_sentinel(client, monkeypatch):
    """__ERROR__:... lines emit a failed-styled output event with the
    prefix stripped, and the stream continues until __DONE__."""
    scripted = [
        "__ERROR__:ValueError: something broke",
        "__DONE__:1",
    ]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)
    outs = [e for e in events if e["type"] == "output"]
    assert len(outs) == 1
    assert outs[0]["line"] == "ValueError: something broke"
    assert outs[0]["style"] == "failed"
    assert outs[0]["is_result"] is False
    assert events[-1]["exit_code"] == 1


@pytest.mark.asyncio
async def test_run_tests_done_nonzero_exit(client, monkeypatch):
    """__DONE__:N propagates N into complete.exit_code verbatim."""
    for code in (0, 1, 2, 5):
        scripted = [f"__DONE__:{code}"]
        monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))
        events = await _consume_sse(client)
        assert events[-1]["exit_code"] == code, f"expected exit_code={code}"


@pytest.mark.asyncio
async def test_run_tests_done_non_numeric_payload(client, monkeypatch):
    """Regression for the __DONE__ parse bug (B2 in STABILITY_REPORT):
    a non-numeric payload after the first colon must not crash the
    generator. Default to exit_code=1 so the client sees the run end."""
    scripted = ["__DONE__:not-a-number"]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)
    assert events[-1]["type"] == "complete"
    assert events[-1]["exit_code"] == 1


@pytest.mark.asyncio
async def test_run_tests_done_with_extra_colon(client, monkeypatch):
    """`split(":", 1)` keeps a payload with stray colons from getting
    mis-sliced before the int() call."""
    scripted = ["__DONE__:42:extra:junk"]
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread", _make_scripted_thread(scripted))

    events = await _consume_sse(client)
    # '42:extra:junk' isn't a valid int, so we fall back to 1.
    assert events[-1]["exit_code"] == 1


# ═════════════════════════════════════════════════════
# 7. require_manager gate — soft (default) vs strict
# ═════════════════════════════════════════════════════

@pytest.fixture(autouse=False)
def _clear_sessions():
    auth_mod._sessions.clear()
    yield
    auth_mod._sessions.clear()


@pytest.mark.asyncio
async def test_run_tests_soft_mode_allows_anonymous(client, monkeypatch):
    """With auth_enforced=False (conftest default) the manager gate is soft:
    missing Authorization header records SEC-005 but the request goes through."""
    monkeypatch.setattr(settings, "auth_enforced", False)
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread",
                        _make_scripted_thread(["__DONE__:0"]))

    events = await _consume_sse(client)
    assert events[-1]["type"] == "complete"


@pytest.mark.asyncio
async def test_run_tests_strict_no_token_returns_401(client, monkeypatch):
    """Production mode: no bearer token → 401."""
    monkeypatch.setattr(settings, "auth_enforced", True)
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread",
                        _make_scripted_thread(["__DONE__:0"]))

    resp = await client.post("/api/v1/system/run-tests")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_run_tests_strict_non_manager_returns_403(client, monkeypatch, _clear_sessions):
    """Production mode: valid bearer for a non-manager role → 403."""
    monkeypatch.setattr(settings, "auth_enforced", True)
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread",
                        _make_scripted_thread(["__DONE__:0"]))
    token = auth_mod._create_token("emp_server", "Cassie", ["server"])

    resp = await client.post(
        "/api/v1/system/run-tests",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_run_tests_strict_manager_passes(client, monkeypatch, _clear_sessions):
    """Production mode: valid manager bearer → stream opens normally."""
    monkeypatch.setattr(settings, "auth_enforced", True)
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread",
                        _make_scripted_thread(["__DONE__:0"]))
    token = auth_mod._create_token("emp_mgr", "Morgan", ["manager"])

    events: list[dict] = []
    async with client.stream(
        "POST",
        "/api/v1/system/run-tests",
        headers={"Authorization": f"Bearer {token}"},
    ) as resp:
        assert resp.status_code == 200
        async for raw in resp.aiter_lines():
            if raw.startswith("data: "):
                events.append(json.loads(raw[len("data: "):]))

    assert events[-1]["type"] == "complete"
    assert events[-1]["exit_code"] == 0


@pytest.mark.asyncio
async def test_run_tests_strict_admin_and_owner_pass(client, monkeypatch, _clear_sessions):
    """admin and owner share the manager gate — both must pass."""
    monkeypatch.setattr(settings, "auth_enforced", True)
    monkeypatch.setattr(system_mod, "_run_pytest_in_thread",
                        _make_scripted_thread(["__DONE__:0"]))

    for role in ("admin", "owner"):
        auth_mod._sessions.clear()
        token = auth_mod._create_token(f"emp_{role}", role.title(), [role])
        resp = await client.post(
            "/api/v1/system/run-tests",
            headers={"Authorization": f"Bearer {token}"},
        )
        # 200 means the gate let us through — we don't need to drain the body.
        assert resp.status_code == 200, f"{role} should pass the manager gate"


# ═════════════════════════════════════════════════════
# 8. Integration — real pytest subprocess on tmp tests
# ═════════════════════════════════════════════════════
#
# These tests exercise the real _run_pytest_in_thread path (subprocess.Popen
# + stdout pump) so the end-to-end contract between the thread and the SSE
# generator is covered. Slow-ish (~2-3s each): we launch a real pytest.

@pytest.mark.asyncio
async def test_run_tests_integration_all_pass(client, monkeypatch, tmp_path):
    """Point PROJECT_ROOT at a tmp dir with one trivial test — expect the
    stream to report at least one pass and exit 0."""
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_trivial.py").write_text("def test_ok():\n    assert True\n")

    monkeypatch.setattr(system_mod, "PROJECT_ROOT", tmp_path)

    events = await _consume_sse(client)
    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["exit_code"] == 0
    assert complete["passed"] >= 1
    assert complete["failed"] == 0


@pytest.mark.asyncio
async def test_run_tests_integration_with_failure(client, monkeypatch, tmp_path):
    """A failing test surfaces as failed >= 1 and a non-zero exit code."""
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_broken.py").write_text(
        "def test_ok():\n    assert True\n"
        "def test_bad():\n    assert False\n"
    )

    monkeypatch.setattr(system_mod, "PROJECT_ROOT", tmp_path)

    events = await _consume_sse(client)
    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["exit_code"] != 0
    assert complete["failed"] >= 1
    assert complete["passed"] >= 1


@pytest.mark.asyncio
async def test_run_tests_integration_no_tests_dir(client, monkeypatch, tmp_path):
    """With no tests/ directory, pytest errors with 'file or directory not
    found'. The stream must still terminate cleanly with a non-zero exit
    code rather than hanging — regression guard for Bug B1 (the old
    hardcoded 'core/backend/tests' path masked this as a false-green)."""
    monkeypatch.setattr(system_mod, "PROJECT_ROOT", tmp_path)

    events = await _consume_sse(client)
    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["exit_code"] != 0
