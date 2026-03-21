import Foundation

struct ApprovalRecord: Identifiable, Codable, Equatable {
    let id: UUID
    let toolName: String
    let toolInputSummary: String?
    let projectName: String?
    let assistantName: String
    let outcome: ResolutionOutcome
    let createdAt: Date
    let resolvedAt: Date
    let sessionId: String?

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}
