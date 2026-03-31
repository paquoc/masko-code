# Git Bash Signal Handling on Windows: Research Report

## Executive Summary

The `trap '' TERM HUP INT` pattern doesn't work in Git Bash because:

1. **MSYS2/Cygwin signal delivery is fundamentally broken** — Mintty (Git Bash's terminal) doesn't properly deliver signals to bash processes. This is a known, unfixed issue with no clear solution.

2. **`nohup` and `disown` don't work** because they rely on proper signal handling, which fails upstream.

3. **Parent process exit kills children via Windows Job Objects**, not signals. Claude Code (or Node.js child_process on Windows) likely uses Job Objects to manage process trees, which **terminate all children when the parent exits**, bypassing bash's trap handlers entirely.

4. **The real problem**: Your script reads stdin and logs successfully, but the curl never executes because the entire bash process is killed by the parent's Job Object termination before the curl command even starts.

---

## Detailed Findings

### 1. MSYS2/Cygwin Signal Handling Issues

**The Core Problem:**
- MSYS2 (which Git Bash is built on) is derived from Cygwin and emulates POSIX signals using Windows structured exception handling
- Mintty (the terminal emulator Git Bash uses) **eats Ctrl+C signals** and doesn't reliably deliver signals to child processes
- This is documented in MSYS2 ticket #135 as a fundamental issue with "little incentive" to fix due to architectural constraints

**What This Means:**
- `trap '' TERM HUP INT` sets a signal handler, but the signals **never reach the bash process** because mintty/MSYS2 doesn't deliver them properly
- The trap works syntactically but is useless in practice on Git Bash
- Testing in Windows native console (not mintty) gives proper "sig 2" results, proving the issue is terminal-specific

**Sources:**
- [MSYS2 signal handling ticket](https://sourceforge.net/p/msys2/tickets/135/)
- [Dealing with tty/pty in MSYS2](https://gist.github.com/borekb/d36b1d3c4e83514a8d68222d6916a83f)

---

### 2. Windows Process Termination via Job Objects

**How Windows Differs from Unix:**
- On Unix, when a parent dies, children become orphaned (reparented to init)
- On Windows, **there is no init process**. Child processes only survive if explicitly orphaned or if the parent doesn't use Job Objects

**Job Objects (Windows-Specific):**
- A Job Object is a Windows mechanism for managing groups of processes as a unit
- When Claude Code (running as Node.js) spawns bash.exe, it likely wraps it in a Job Object with the `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag
- **This flag terminates ALL associated processes when the job handle closes**, which happens when the parent process exits
- This termination is **immediate and forceful** — it bypasses POSIX signal handlers entirely

**Why Your Script Fails:**
1. Claude Code spawns bash.exe (wrapped in Job Object)
2. Your script reads stdin successfully and logs the event
3. Your script reaches the curl command line... but before it can execute
4. Claude Code sends "Stop" event and kills child processes (closes Job Object handle)
5. **The entire bash process is terminated by Windows**, not by a signal that trap could catch

**Sources:**
- [Job Objects overview (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [TerminateJobObject behavior](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject)
- [Killing child processes with Job Objects](https://www.meziantou.net/killing-all-child-processes-when-the-parent-exits-job-object.htm)

---

### 3. Why `nohup` and `disown` Don't Work

**`nohup` Behavior:**
- `nohup` prevents SIGHUP delivery by registering a signal handler
- **Since MSYS2 doesn't deliver signals properly**, nohup has nothing to protect against
- Additionally, `nohup` only prevents HUP signals, not TERM/INT from Job Object termination

**`disown` Behavior:**
- `disown` tells the shell to forget about a job, but doesn't actually orphan the process on Windows
- The bash process itself is still a child of the Job Object
- When the Job Object terminates, all children terminate regardless of disown status

**The Fundamental Issue:**
- Both rely on signal handling working correctly (which it doesn't in MSYS2)
- Both only affect bash's job control, not Windows-level process termination

---

### 4. Known Workarounds and Their Limitations

#### Workaround 1: `start` Command (Windows-Native)
```bash
start "" cmd /c "curl https://..."
```
- `start` launches via Windows shell, which may create an independent process handle
- **Limitation**: Unreliable; depends on how the parent process management is configured
- **Status**: Documented as "may work" but not guaranteed

**Source:** [Windows bash process detachment](https://a.osmarks.net/content/superuser.com_en_all_2020-04/A/question/577442.html)

#### Workaround 2: Launch via External Binary
```bash
/c/Windows/System32/curl.exe https://... >/dev/null 2>&1 &
```
- Spawn curl.exe directly instead of via bash
- Works if curl.exe isn't wrapped in the same Job Object
- **Limitation**: Assumes the parent doesn't enumerate and kill all child processes; only delays inevitable if it does

#### Workaround 3: Redirect to Temporary File
```bash
curl https://... >> /tmp/request.log 2>&1 &
```
- Ensures I/O completes before parent exits
- **Limitation**: Curl still won't execute if the Job Object closes before the command starts
- **Doesn't actually solve the problem**

#### Workaround 4: Screen/Tmux Session (Not Available in Git Bash)
- Creates a persistent session that survives parent exit
- **Not practical for Git Bash** — these require full terminal emulation

---

### 5. What Actually Works on Windows

**Option A: Change the Parent Process Management in Claude Code**

If Claude Code controls the spawn mechanism:
- **Don't use Job Objects**, or
- **Don't immediately close the Job Object handle** — delay cleanup to let child processes complete
- This requires changes to Node.js child_process management in Claude Code

**Option B: Use a Sentinel File / Completion Marker**

Have the script write to a file when done:
```bash
#!/bin/bash
# ... existing code ...
curl https://... && touch /tmp/hook.done || touch /tmp/hook.failed
```

Then modify Claude Code's cleanup logic:
- Spawn the bash script
- Wait up to N seconds for /tmp/hook.done to appear before killing
- This gives the curl time to send the HTTP request

**Option C: Use Stdout/Stderr for Status Communication**

Instead of async curl:
```bash
#!/bin/bash
# ... read stdin ...
curl https://... -w "\n%{http_code}\n" 2>&1
# Exit code and output goes back to parent
```

If Claude Code needs the response:
- Capture stdout/stderr from the hook process
- The request completes before the script exits

**Option D: Accept That Fire-and-Forget Won't Work**

The architectural reality:
- Windows doesn't support Unix-style async "fire and forget"
- Requesting a URL **must either**:
  - Block the script until completion, OR
  - Use a persistent background service (not spawned by the hook), OR
  - Be queued and executed by the parent process after the hook completes

---

### 6. Tauri/Electron Context

Since you're working on a Windows Tauri port:

**Tauri's Process Management:**
- Spawned children on Windows **cannot be reliably killed** with `.kill()` — the issue is documented in Tauri issue #4949
- Tauri uses platform-specific termination logic; Windows requires different approaches than Unix
- Similar issues affect PyInstaller-wrapped binaries (process tree complexity)

**Electron's Behavior:**
- Child processes spawned with `child_process.fork()` are killed when the parent app exits
- Detached processes created with `unref()` **still die on Windows** when parent exits (unlike Unix)
- Electron's newer `utilityProcess` API provides better lifecycle management but still respects Job Object termination

**Sources:**
- [Tauri spawned children cannot be killed on Windows](https://github.com/tauri-apps/tauri/issues/4949)
- [Electron child process termination](https://github.com/electron/electron/issues/7084)
- [Detached processes die when parent exits on Windows](https://github.com/enkessler/childprocess/issues/99)

---

## Root Cause Analysis

| Layer | Issue | Impact |
|-------|-------|--------|
| **Signal Level** | Mintty doesn't deliver signals to bash | `trap` handlers never fire |
| **Bash Level** | `nohup`/`disown` rely on signals | Both fail upstream |
| **OS Level** | Windows Job Objects terminate all children when parent exits | Your entire bash process dies before curl executes |
| **Architecture Level** | Windows doesn't have Unix-style process inheritance | Fire-and-forget HTTP from child processes fundamentally doesn't work |

---

## Recommended Solutions (In Order)

### 1. **Defer the HTTP Request (Best for Your Use Case)**
Move the curl call **out of the hook script** and into Claude Code itself:
```javascript
// In Claude Code (Node.js)
const hook = spawn('bash', [hookScript], { ... });
// Read hook output...
hook.on('close', () => {
  // AFTER hook completes, send the HTTP request
  fetch(url, { method: 'POST', body: JSON.stringify(...) });
});
```
**Why this works:**
- The hook completes its I/O while the parent is still alive
- The HTTP request happens in the parent process, not a dying child
- No race conditions with process termination

### 2. **Use a Completion Signal in the Hook**
Write to a file or use exit code to signal completion:
```bash
#!/bin/bash
# ... event processing ...
echo "Stop event processed" >&2
exit 0
```

Claude Code waits for exit before terminating. The hook can then send HTTP asynchronously if needed:
```bash
curl https://... & disown
exit 0
```
**This sometimes works** because the curl command starts before the parent kills the Job Object, but it's still a race condition.

### 3. **Use WSL Instead of Git Bash (If Possible)**
WSL 2 has better signal handling and process management. If your Windows Tauri port can target WSL:
```javascript
const shell = '/bin/bash'; // WSL path
```
- Proper POSIX signals work
- `nohup` and `disown` function correctly
- **Downside**: Requires WSL installed; more complex setup

### 4. **Accept Synchronous HTTP Requests**
If the HTTP request is just logging/telemetry:
```bash
curl --max-time 1 https://... >/dev/null 2>&1
exit $?
```
- Script waits for curl completion (with timeout)
- Parent sees exit code
- No async confusion

---

## Answers to Your Research Questions

### Q1: How does Git Bash handle signals differently?
**A:** Mintty (Git Bash's terminal) doesn't deliver signals properly to bash processes. This is a fundamental MSYS2/Cygwin architectural issue. Signals reach mintty but aren't forwarded to child processes reliably. Testing in Windows console instead of mintty shows signals work fine, proving the issue is terminal-specific.

### Q2: How are child processes terminated when parent exits?
**A:** Via **Windows Job Objects**. When a parent process exits, if it was managing children via a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, all associated child processes are immediately terminated. This is forceful, synchronous, and bypasses any POSIX signal handlers.

### Q3: What techniques actually work on Git Bash/Windows?
**A:**
1. Move async work to the parent process (most reliable)
2. Use exit codes/completion files to signal parent (acceptable, still racey)
3. Use WSL instead of Git Bash (works but requires additional setup)
4. Accept synchronous requests (simplest if acceptable for your UX)

### Q4: Does Claude Code use Job Objects?
**A:** Most likely yes. Node.js on Windows uses Job Objects for process management by default. This is a platform standard for ensuring cleanup of child process trees. Claude Code inherits this behavior.

### Q5: Workarounds for fire-and-forget HTTP from Git Bash?
**A:** None that are reliable. Windows architecture doesn't support this pattern. The HTTP request either:
- Must complete before the parent process exits (synchronous or blocking), OR
- Must be executed by the parent process after the hook completes

---

## Summary

**Bottom line:** You can't make the hook script's curl request survive parent exit on Windows using bash-level tricks because:

1. Signals don't work reliably (MSYS2 limitation)
2. The entire bash process is terminated by the parent's Job Object (Windows architecture)

**The solution:** Have Claude Code make the HTTP request after the hook script completes, not the hook itself. This is the only pattern that works reliably on Windows.

---

## Sources Referenced

- [MSYS2 signal handling issues](https://sourceforge.net/p/msys2/tickets/135/)
- [Mintty terminal emulator](https://mintty.github.io/)
- [Windows Job Objects (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Tauri child process issues](https://github.com/tauri-apps/tauri/issues/4949)
- [Electron child process behavior](https://github.com/electron/electron/issues/7084)
- [Job Object termination behavior](https://www.meziantou.net/killing-all-child-processes-when-the-parent-exits-job-object.htm)
- [Detached processes on Windows](https://github.com/enkessler/childprocess/issues/99)
- [Claude Code Windows issues](https://github.com/anthropics/claude-code/issues/28546)
