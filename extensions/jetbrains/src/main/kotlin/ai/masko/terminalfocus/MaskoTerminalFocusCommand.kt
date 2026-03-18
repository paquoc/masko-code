package ai.masko.terminalfocus

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.ToolWindowManager
import io.netty.channel.ChannelHandlerContext
import io.netty.handler.codec.http.FullHttpRequest
import io.netty.handler.codec.http.HttpMethod
import io.netty.handler.codec.http.QueryStringDecoder
import org.jetbrains.ide.HttpRequestHandler
import org.jetbrains.ide.RestService

/**
 * HTTP handler for Masko Code terminal focus requests.
 *
 * Listens on JetBrains' built-in server (port 63342):
 *   GET http://localhost:63342/api/masko/focus?pid=12345
 *   GET http://localhost:63342/api/masko/ping
 *
 * Focuses the Terminal tool window and switches to the tab whose shell process
 * is an ancestor of the given PID. Uses OS process tree matching which works
 * across all JetBrains IDE versions (classic and reworked terminal).
 */
class MaskoTerminalFocusHandler : HttpRequestHandler() {

    override fun isSupported(request: FullHttpRequest): Boolean {
        return request.method() == HttpMethod.GET &&
            request.uri().startsWith("/api/masko/")
    }

    override fun process(
        urlDecoder: QueryStringDecoder,
        request: FullHttpRequest,
        context: ChannelHandlerContext
    ): Boolean {
        val path = urlDecoder.path()

        if (path == "/api/masko/focus") {
            val pid = urlDecoder.parameters()["pid"]?.firstOrNull()?.toLongOrNull()

            ApplicationManager.getApplication().invokeLater {
                val project = ProjectManager.getInstance().openProjects.firstOrNull()
                    ?: return@invokeLater
                val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
                    ?: return@invokeLater

                if (pid != null) {
                    focusTerminalByPid(toolWindow, pid)
                } else {
                    toolWindow.show()
                }
            }

            RestService.sendOk(request, context)
            return true
        }

        if (path == "/api/masko/ping") {
            RestService.sendOk(request, context)
            return true
        }

        return false
    }

    /**
     * Focus the terminal tab whose shell process is an ancestor of [targetPid].
     *
     * Each terminal tab spawns a shell as a direct child of the IDE process.
     * We list those child shells sorted by PID (= creation order = tab order),
     * find which one is an ancestor of targetPid, and switch to that tab.
     */
    private fun focusTerminalByPid(
        toolWindow: com.intellij.openapi.wm.ToolWindow,
        targetPid: Long
    ) {
        val contentManager = toolWindow.contentManager
        val contents = contentManager.contents
        if (contents.isEmpty()) {
            toolWindow.show()
            return
        }

        val tabIndex = findTabIndexByProcessTree(targetPid)
        if (tabIndex != null && tabIndex < contents.size) {
            contentManager.setSelectedContent(contents[tabIndex], true)
            toolWindow.show()
            return
        }

        // No match - just show the terminal
        toolWindow.show()
    }

    /**
     * Match targetPid to a terminal tab index via the OS process tree.
     *
     * 1. Find the IDE's direct child shells (sorted by PID = creation order)
     * 2. Walk up from targetPid to find which child shell it descends from
     * 3. Return that shell's index in the sorted list (= tab index)
     */
    private fun findTabIndexByProcessTree(targetPid: Long): Int? {
        val ideChildShells = getIdeChildShells()
        if (ideChildShells.isEmpty()) return null

        val ancestorShell = findAncestorShellUnderIde(targetPid, ideChildShells)
            ?: return null

        val index = ideChildShells.indexOf(ancestorShell)
        return if (index >= 0) index else null
    }

    /**
     * Walk up from [pid] to find the shell that is a direct child of the IDE process.
     */
    private fun findAncestorShellUnderIde(pid: Long, ideChildShells: List<Long>): Long? {
        val idePid = ProcessHandle.current().pid()
        var current = pid
        repeat(10) {
            val ppid = getParentPid(current) ?: return null
            if (ppid == idePid) {
                // current is a direct child of the IDE
                return if (current in ideChildShells) current else null
            }
            if (ppid <= 1) return null
            current = ppid
        }
        return null
    }

    /**
     * Get all direct child shell processes of this IDE, sorted by PID (= creation order).
     */
    private fun getIdeChildShells(): List<Long> {
        val idePid = ProcessHandle.current().pid()
        return try {
            val process = ProcessBuilder("/bin/ps", "-eo", "pid,ppid,comm")
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().readText()
            process.waitFor()

            output.lines()
                .mapNotNull { line ->
                    val parts = line.trim().split(Regex("\\s+"), limit = 3)
                    if (parts.size >= 3) {
                        val childPid = parts[0].toLongOrNull()
                        val parentPid = parts[1].toLongOrNull()
                        val comm = parts[2].substringAfterLast("/")
                        if (parentPid == idePid && comm.matches(Regex("zsh|bash|fish|sh|nu|pwsh|elvish"))) {
                            childPid
                        } else null
                    } else null
                }
                .sorted()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun getParentPid(pid: Long): Long? {
        return try {
            val process = ProcessBuilder("/bin/ps", "-o", "ppid=", "-p", pid.toString())
                .redirectErrorStream(true)
                .start()
            val result = process.inputStream.bufferedReader().readText().trim().toLongOrNull()
            process.waitFor()
            result
        } catch (_: Exception) {
            null
        }
    }
}
