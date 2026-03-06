import SwiftUI

struct MascotDetailView: View {
    @Environment(AppStore.self) var appStore
    @Environment(OverlayManager.self) var overlayManager

    let mascotId: UUID
    @Binding var isPresented: Bool
    @State private var editingEdgeId: String?

    private var mascot: SavedMascot? {
        appStore.mascotStore.mascots.first { $0.id == mascotId }
    }

    var body: some View {
        if let mascot {
            VStack(spacing: 0) {
                // Header
                HStack(spacing: 12) {
                    Button(action: { isPresented = false }) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                                .font(Constants.body(size: 13, weight: .medium))
                        }
                        .foregroundColor(Constants.textMuted)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Text(mascot.name)
                        .font(Constants.heading(size: 18, weight: .semibold))
                        .foregroundColor(Constants.textPrimary)

                    Spacer()

                    Button(action: {
                        if !overlayManager.isOverlayEnabled {
                            overlayManager.enableOverlay()
                        }
                        overlayManager.showOverlayWithConfig(mascot.config)
                    }) {
                        HStack(spacing: 5) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 10))
                            Text("Activate")
                        }
                    }
                    .buttonStyle(BrandSecondaryButton())
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 12)

                Divider().overlay(Constants.border)

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // States grid with video previews
                        statesSection(mascot.config)

                        // Transitions section
                        transitionsSection(mascot)

                        // View on masko.ai link
                        if let slug = mascot.templateSlug {
                            Button(action: {
                                NSWorkspace.shared.open(URL(string: "\(Constants.maskoBaseURL)/community/\(slug)")!)
                            }) {
                                HStack(spacing: 8) {
                                    Image(systemName: "safari")
                                        .font(.system(size: 14))
                                    Text("View on masko.ai")
                                        .font(Constants.body(size: 13, weight: .medium))
                                    Spacer()
                                    Image(systemName: "arrow.up.right")
                                        .font(.system(size: 11, weight: .semibold))
                                }
                                .foregroundColor(Constants.orangePrimary)
                                .padding(14)
                                .background(Constants.orangePrimary.opacity(0.05))
                                .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadius))
                                .overlay(
                                    RoundedRectangle(cornerRadius: Constants.cornerRadius)
                                        .stroke(Constants.orangePrimary.opacity(0.2), lineWidth: 1)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(20)
                }
            }
            .background(Constants.lightBackground)
        }
    }

    // MARK: - States (with video previews)

    @ViewBuilder
    private func statesSection(_ config: MaskoAnimationConfig) -> some View {
        let loopEdges = config.edges.filter { $0.isLoop }

        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("States")
                    .font(Constants.heading(size: 14, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)
                Text("\(config.nodes.count)")
                    .font(Constants.body(size: 12, weight: .medium))
                    .foregroundColor(Constants.textMuted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Constants.chip, in: Capsule())
            }

            LazyVGrid(columns: [
                GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 12)
            ], spacing: 12) {
                ForEach(config.nodes) { node in
                    let isInitial = node.id == config.initialNode
                    let loopEdge = loopEdges.first(where: { $0.source == node.id })

                    VStack(spacing: 0) {
                        // Video preview or thumbnail
                        ZStack {
                            RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall)
                                .fill(Constants.stage)

                            if let edge = loopEdge,
                               let urlStr = edge.videos.hevc ?? edge.videos.webm,
                               let url = URL(string: urlStr) {
                                MascotVideoView(url: url)
                                    .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall))
                            } else if let urlStr = node.transparentThumbnailUrl, let url = URL(string: urlStr) {
                                AsyncImage(url: url) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image
                                            .resizable()
                                            .aspectRatio(contentMode: .fit)
                                    default:
                                        nodePlaceholder
                                    }
                                }
                            } else {
                                nodePlaceholder
                            }
                        }
                        .aspectRatio(1, contentMode: .fit)
                        .padding(8)

                        // Name
                        VStack(spacing: 2) {
                            Text(node.name)
                                .font(Constants.heading(size: 12, weight: .semibold))
                                .foregroundColor(Constants.textPrimary)
                                .lineLimit(1)

                            if isInitial {
                                Text("start")
                                    .font(Constants.body(size: 9, weight: .semibold))
                                    .foregroundColor(Constants.orangePrimary)
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.bottom, 8)
                    }
                    .background(isInitial ? Constants.orangePrimaryLight : Constants.surfaceWhite)
                    .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: Constants.cornerRadius)
                            .stroke(isInitial ? Constants.orangePrimary.opacity(0.3) : Constants.border, lineWidth: 1)
                    )
                }
            }
        }
    }

    private var nodePlaceholder: some View {
        Image(systemName: "photo")
            .font(.system(size: 24))
            .foregroundColor(Constants.textMuted.opacity(0.4))
    }

    // MARK: - Transitions

    @ViewBuilder
    private func transitionsSection(_ mascot: SavedMascot) -> some View {
        let config = mascot.config

        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Transitions")
                    .font(Constants.heading(size: 14, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)
                Text("\(config.edges.count)")
                    .font(Constants.body(size: 12, weight: .medium))
                    .foregroundColor(Constants.textMuted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Constants.chip, in: Capsule())
            }

            VStack(spacing: 0) {
                ForEach(Array(config.edges.enumerated()), id: \.element.id) { idx, edge in
                    if editingEdgeId == edge.id {
                        ConditionEditorRow(
                            edge: edge,
                            config: config,
                            onSave: { newConditions in
                                appStore.mascotStore.updateEdgeConditions(
                                    mascotId: mascot.id,
                                    edgeId: edge.id,
                                    conditions: newConditions
                                )
                                editingEdgeId = nil
                            },
                            onCancel: { editingEdgeId = nil }
                        )
                    } else {
                        EdgeRow(edge: edge, config: config) {
                            editingEdgeId = edge.id
                        }
                    }

                    if idx < config.edges.count - 1 {
                        Divider().overlay(Constants.border)
                    }
                }
            }
            .background(Constants.surfaceWhite)
            .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Constants.cornerRadius)
                    .stroke(Constants.border, lineWidth: 1)
            )
        }
    }
}

// MARK: - Edge Row

private struct EdgeRow: View {
    let edge: MaskoAnimationEdge
    let config: MaskoAnimationConfig
    let onEdit: () -> Void

    private func nodeName(_ id: String) -> String {
        config.nodes.first { $0.id == id }?.name ?? id
    }

    var body: some View {
        HStack(spacing: 10) {
            // Source → Target
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(nodeName(edge.source))
                        .font(Constants.heading(size: 13, weight: .semibold))
                        .foregroundColor(Constants.textPrimary)

                    Image(systemName: "arrow.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Constants.textMuted)

                    Text(nodeName(edge.target))
                        .font(Constants.heading(size: 13, weight: .semibold))
                        .foregroundColor(Constants.textPrimary)

                    if edge.isLoop {
                        Text("loop")
                            .font(Constants.body(size: 10, weight: .medium))
                            .foregroundColor(Constants.orangePrimary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Constants.orangePrimaryLight, in: Capsule())
                    }
                }

                // Trigger info
                HStack(spacing: 6) {
                    triggerBadge

                    Text(String(format: "%.1fs", edge.duration))
                        .font(Constants.body(size: 11))
                        .foregroundColor(Constants.textMuted)
                }
            }

            Spacer()

            if !edge.isLoop {
                Button(action: onEdit) {
                    Text("Edit")
                        .font(Constants.body(size: 12, weight: .medium))
                        .foregroundColor(Constants.orangePrimary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var triggerBadge: some View {
        let label = conditionLabel
        Text(label)
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(conditionColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(conditionColor.opacity(0.08), in: Capsule())
    }

    private var conditionLabel: String {
        guard let conditions = edge.conditions, !conditions.isEmpty else { return "no condition" }
        if conditions.count == 1 {
            let c = conditions[0]
            return "\(c.input) \(c.op) \(conditionValueStr(c.value))"
        }
        return "\(conditions.count) conditions"
    }

    private func conditionValueStr(_ value: ConditionValue) -> String {
        switch value {
        case .bool(let b): b ? "true" : "false"
        case .number(let n): n == n.rounded() ? "\(Int(n))" : "\(n)"
        }
    }

    private var conditionColor: Color {
        guard let conditions = edge.conditions, !conditions.isEmpty else { return Constants.textMuted }
        let firstInput = conditions[0].input
        if firstInput.hasPrefix("claudeCode::") { return Color(red: 139/255, green: 92/255, blue: 246/255) } // Claude Code = purple
        if firstInput == "clicked" { return Constants.orangePrimary }
        if firstInput == "nodeTime" { return Color(red: 59/255, green: 130/255, blue: 246/255) }   // blue
        if firstInput == "loopCount" { return Color(red: 22/255, green: 163/255, blue: 74/255) }   // green
        return Constants.textMuted
    }
}

// MARK: - Condition Editor Row

private struct ConditionEditorRow: View {
    let edge: MaskoAnimationEdge
    let config: MaskoAnimationConfig
    let onSave: ([MaskoAnimationCondition]?) -> Void
    let onCancel: () -> Void

    @State private var inputName: String

    private static let presets: [(label: String, conditions: [MaskoAnimationCondition])] = [
        ("Click", [
            MaskoAnimationCondition(input: "clicked", op: "==", value: .bool(true)),
        ]),
        ("Hover", [
            MaskoAnimationCondition(input: "mouseOver", op: "==", value: .bool(true)),
        ]),
        ("Working", [
            MaskoAnimationCondition(input: "claudeCode::isWorking", op: "==", value: .bool(true)),
            MaskoAnimationCondition(input: "claudeCode::isAlert", op: "==", value: .bool(false)),
            MaskoAnimationCondition(input: "claudeCode::isCompacting", op: "==", value: .bool(false)),
        ]),
        ("Idle", [
            MaskoAnimationCondition(input: "claudeCode::isIdle", op: "==", value: .bool(true)),
            MaskoAnimationCondition(input: "claudeCode::isAlert", op: "==", value: .bool(false)),
            MaskoAnimationCondition(input: "claudeCode::isCompacting", op: "==", value: .bool(false)),
        ]),
        ("Alert", [
            MaskoAnimationCondition(input: "claudeCode::isAlert", op: "==", value: .bool(true)),
        ]),
        ("Compacting", [
            MaskoAnimationCondition(input: "claudeCode::isCompacting", op: "==", value: .bool(true)),
            MaskoAnimationCondition(input: "claudeCode::isAlert", op: "==", value: .bool(false)),
        ]),
    ]

    init(edge: MaskoAnimationEdge, config: MaskoAnimationConfig,
         onSave: @escaping ([MaskoAnimationCondition]?) -> Void,
         onCancel: @escaping () -> Void) {
        self.edge = edge
        self.config = config
        self.onSave = onSave
        self.onCancel = onCancel
        self._inputName = State(initialValue: edge.conditions?.first?.input ?? "claudeCode::isWorking")
    }

    private func nodeName(_ id: String) -> String {
        config.nodes.first { $0.id == id }?.name ?? id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Edge label
            HStack(spacing: 4) {
                Text(nodeName(edge.source))
                    .font(Constants.heading(size: 13, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)
                Image(systemName: "arrow.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Constants.textMuted)
                Text(nodeName(edge.target))
                    .font(Constants.heading(size: 13, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)
            }

            // Presets
            VStack(alignment: .leading, spacing: 4) {
                Text("Presets")
                    .font(Constants.body(size: 11, weight: .medium))
                    .foregroundColor(Constants.textMuted)
                HStack(spacing: 6) {
                    ForEach(Self.presets, id: \.label) { preset in
                        Button {
                            onSave(preset.conditions)
                        } label: {
                            Text(preset.label)
                                .font(Constants.body(size: 11, weight: .medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Constants.orangePrimaryLight.opacity(0.5))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Cancel
            HStack(spacing: 8) {
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(Constants.body(size: 12, weight: .medium))
                        .foregroundColor(Constants.textMuted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(Constants.orangePrimaryLight.opacity(0.5))
    }
}
