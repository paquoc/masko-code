import SwiftUI

struct ConnectionDoctorView: View {
    @Environment(AppStore.self) var appStore
    @Environment(\.dismiss) private var dismiss
    @State private var doctor: ConnectionDoctor?
    @State private var reportCode: String?
    @State private var isSendingReport = false
    @State private var reportError = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "stethoscope")
                    .font(.system(size: 18))
                    .foregroundStyle(Constants.orangePrimary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Connection Doctor")
                        .font(Constants.heading(size: 16, weight: .bold))
                        .foregroundStyle(Constants.textPrimary)
                    Text("Diagnose and repair the connection to Claude Code")
                        .font(Constants.body(size: 12))
                        .foregroundStyle(Constants.textMuted)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Constants.textMuted)
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider().overlay(Constants.border)

            if let doctor {
                if doctor.isRunning {
                    // Running diagnostics
                    VStack(spacing: 12) {
                        ProgressView()
                            .controlSize(.regular)
                        Text("Running diagnostics...")
                            .font(Constants.body(size: 13))
                            .foregroundStyle(Constants.textMuted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                } else if doctor.checks.isEmpty {
                    // Not yet run
                    VStack(spacing: 12) {
                        Image(systemName: "waveform.path.ecg")
                            .font(.system(size: 32))
                            .foregroundStyle(Constants.textMuted.opacity(0.4))
                        Text("Click Run to start diagnostics")
                            .font(Constants.body(size: 13))
                            .foregroundStyle(Constants.textMuted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    // Results
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(doctor.checks) { check in
                                checkRow(check)
                                if check.id != doctor.checks.last?.id {
                                    Divider().overlay(Constants.border).padding(.horizontal)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                    }

                    Divider().overlay(Constants.border)

                    // Summary
                    let errorCount = doctor.checks.filter { $0.status == .error }.count
                    let warningCount = doctor.checks.filter { $0.status == .warning }.count

                    HStack {
                        if errorCount == 0 && warningCount == 0 {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("All checks passed")
                                .font(Constants.body(size: 13, weight: .medium))
                                .foregroundStyle(Constants.textPrimary)
                        } else {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(errorCount > 0 ? Constants.destructiveRed : .orange)
                            Text("\(errorCount) error\(errorCount == 1 ? "" : "s"), \(warningCount) warning\(warningCount == 1 ? "" : "s")")
                                .font(Constants.body(size: 13, weight: .medium))
                                .foregroundStyle(Constants.textPrimary)
                        }
                        Spacer()
                    }
                    .padding()
                }

                Divider().overlay(Constants.border)

                // Actions
                VStack(spacing: 8) {
                    // Repair + Run buttons
                    HStack(spacing: 8) {
                        let hasIssues = doctor.checks.contains { $0.status != .ok }

                        if hasIssues && !doctor.checks.isEmpty {
                            Button {
                                Task { await doctor.repairAll() }
                            } label: {
                                HStack(spacing: 4) {
                                    if doctor.isRepairing {
                                        ProgressView()
                                            .controlSize(.small)
                                    } else {
                                        Image(systemName: "wrench.and.screwdriver")
                                    }
                                    Text(doctor.isRepairing ? "Repairing..." : "Repair All")
                                }
                                .font(Constants.heading(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Constants.orangePrimary)
                                .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall))
                            }
                            .buttonStyle(.plain)
                            .disabled(doctor.isRepairing || doctor.isRunning)
                        }

                        Button {
                            Task { await doctor.runDiagnostics() }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.clockwise")
                                Text(doctor.checks.isEmpty ? "Run Diagnostics" : "Re-run")
                            }
                            .font(Constants.heading(size: 13, weight: .semibold))
                            .foregroundStyle(hasIssues && !doctor.checks.isEmpty ? Constants.orangePrimary : .white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(hasIssues && !doctor.checks.isEmpty ? Constants.orangePrimaryLight : Constants.orangePrimary)
                            .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall))
                        }
                        .buttonStyle(.plain)
                        .disabled(doctor.isRunning || doctor.isRepairing)
                    }

                    // Share with support
                    if !doctor.checks.isEmpty {
                        if let code = reportCode {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                Text("Report sent!")
                                    .font(Constants.body(size: 12, weight: .medium))
                                    .foregroundStyle(Constants.textPrimary)
                                Text(code)
                                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                                    .foregroundStyle(Constants.orangePrimary)
                                    .textSelection(.enabled)
                                Button {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(code, forType: .string)
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .font(.system(size: 10))
                                        .foregroundStyle(Constants.textMuted)
                                }
                                .buttonStyle(.plain)
                            }
                        } else {
                            Button {
                                sendReport()
                            } label: {
                                HStack(spacing: 4) {
                                    if isSendingReport {
                                        ProgressView()
                                            .controlSize(.small)
                                    } else {
                                        Image(systemName: "paperplane")
                                    }
                                    Text(isSendingReport ? "Sending..." : "Share with Masko Support")
                                }
                                .font(Constants.body(size: 12, weight: .medium))
                                .foregroundStyle(Constants.orangePrimary)
                            }
                            .buttonStyle(.plain)
                            .disabled(isSendingReport)

                            if reportError {
                                Text("Failed to send report. Check your internet connection.")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Constants.destructiveRed)
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .frame(width: 420)
        .background(Constants.lightBackground)
        .onExitCommand { dismiss() }
        .task {
            let doc = ConnectionDoctor(
                localServer: appStore.localServer,
                eventStore: appStore.eventStore,
                sessionStore: appStore.sessionStore
            )
            doctor = doc
            await doc.runDiagnostics()
        }
    }

    // MARK: - Check Row

    private func checkRow(_ check: ConnectionDoctor.Check) -> some View {
        HStack(spacing: 10) {
            Image(systemName: iconName(for: check.status))
                .font(.system(size: 14))
                .foregroundStyle(iconColor(for: check.status))
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(check.name)
                    .font(Constants.body(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Text(check.message)
                    .font(.system(size: 11))
                    .foregroundStyle(Constants.textMuted)
            }

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private func iconName(for status: ConnectionDoctor.Check.Status) -> String {
        switch status {
        case .ok: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.circle.fill"
        }
    }

    private func iconColor(for status: ConnectionDoctor.Check.Status) -> Color {
        switch status {
        case .ok: return .green
        case .warning: return .orange
        case .error: return Constants.destructiveRed
        }
    }

    // MARK: - Report

    private func sendReport() {
        guard let doctor else { return }
        isSendingReport = true
        reportError = false
        Task {
            if let code = await doctor.sendReport() {
                reportCode = code
            } else {
                reportError = true
            }
            isSendingReport = false
        }
    }
}
