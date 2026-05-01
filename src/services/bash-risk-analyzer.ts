import parse from "bash-parser";
import { autoApproveStore, type AutoApproveRule, type RiskLevel } from "../stores/auto-approve-store";
import { log } from "./log";

/** Walk bash AST and extract all command strings (command + args) */
function walkAST(node: any, results: string[] = []): string[] {
  if (!node) return results;

  switch (node.type) {
    case "Script":
    case "Pipeline":
      (node.commands || []).forEach((cmd: any) => walkAST(cmd, results));
      break;

    case "LogicalExpression":
      walkAST(node.left, results);
      walkAST(node.right, results);
      break;

    case "Subshell":
      walkAST(node.list, results);
      break;

    case "If":
      walkAST(node.clause, results);
      walkAST(node.then, results);
      if (node.else) walkAST(node.else, results);
      break;

    case "Command": {
      const cmdName = node.name ? node.name.text : "";
      if (!cmdName) break;
      const args = (node.suffix || []).map((s: any) => s.text).join(" ");
      results.push((cmdName + " " + args).trim());
      break;
    }
  }

  return results;
}

/**
 * Fallback command extractor for when bash-parser fails.
 * Splits on &&, ||, |, ; and newlines.
 */
function extractCommandsFallback(commandStr: string): string[] {
  return commandStr
    .split(/\s*(?:&&|\|\||\||;|\n)\s*/)
    .map((s) => s.replace(/^\s*(?:\w+=\S+\s+)+/, "").trim())
    .filter(Boolean);
}

/** Compile a single pattern string into a RegExp */
function compilePattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  try {
    const hasRegexChars = /[\\+*?^${}()|[\]]/.test(trimmed);
    if (hasRegexChars) {
      return new RegExp(`^(?:${trimmed})`);
    }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\b`);
  } catch {
    return null;
  }
}

/** Parse comma or newline-separated patterns into compiled regexes */
function compileRulePatterns(rule: AutoApproveRule): RegExp[] {
  return rule.patterns
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(compilePattern)
    .filter((r): r is RegExp => r !== null);
}

/** Check if a command string matches any pattern in a rule */
function matchesRule(command: string, rule: AutoApproveRule): boolean {
  const regexes = compileRulePatterns(rule);
  return regexes.some((rx) => rx.test(command));
}

export interface AnalysisResult {
  shouldAutoApprove: boolean;
  matchedRule?: AutoApproveRule;
  commands: string[];
  overallRisk: RiskLevel;
}

/**
 * Analyze a bash command string against auto-approve rules.
 *
 * Uses bash-parser to build an AST, then walks it to extract all sub-commands.
 * Each command is matched against rules top-to-bottom (first match wins).
 * Auto-approve only if ALL sub-commands match auto-approve rules.
 */
export function analyzeBashCommand(commandStr: string): AnalysisResult {
  const result: AnalysisResult = {
    shouldAutoApprove: false,
    commands: [],
    overallRisk: "safe",
  };

  if (!commandStr || !commandStr.trim()) return result;

  // Parse with bash-parser, fallback to simple split on failure
  let commands: string[];
  try {
    const ast = parse(commandStr);
    commands = walkAST(ast);
  } catch {
    commands = extractCommandsFallback(commandStr);
  }

  result.commands = commands;
  if (commands.length === 0) return result;

  const rules = autoApproveStore.settings.rules;
  const riskWeight: Record<RiskLevel, number> = { safe: 1, medium: 2, high: 3 };
  let highestRisk: RiskLevel = "safe";
  let allAutoApprove = true;
  let anyMatched = false;

  for (const cmd of commands) {
    let matched = false;
    for (const rule of rules) {
      if (matchesRule(cmd, rule)) {
        matched = true;
        anyMatched = true;
        if (riskWeight[rule.risk] > riskWeight[highestRisk]) {
          highestRisk = rule.risk;
        }
        if (!rule.autoApprove) {
          allAutoApprove = false;
        }
        if (!result.matchedRule) {
          result.matchedRule = rule;
        }
        break;
      }
    }
    // Unknown command → don't auto-approve
    if (!matched) {
      allAutoApprove = false;
      if (riskWeight.medium > riskWeight[highestRisk]) {
        highestRisk = "medium";
      }
    }
  }

  result.overallRisk = highestRisk;
  result.shouldAutoApprove = anyMatched && allAutoApprove;

  const ruleSummary = result.matchedRule
    ? `id=${result.matchedRule.id.slice(0, 8)} risk=${result.matchedRule.risk} autoApprove=${result.matchedRule.autoApprove} patterns="${result.matchedRule.patterns}"`
    : "none";
  log("[bash-risk] analyze:", commandStr, "→ commands:", commands, "anyMatched:", anyMatched, "allAutoApprove:", allAutoApprove, "shouldAutoApprove:", result.shouldAutoApprove, "matchedRule:", ruleSummary);

  return result;
}

/** Check if countdown should show for this permission */
export function shouldShowCountdown(toolName: string | undefined, toolInput: Record<string, any> | undefined, sessionId?: string): boolean {
  return getAutoApproveReason(toolName, toolInput, sessionId) !== null;
}

export type AutoApproveReason =
  | { type: "session" }
  | { type: "rule"; ruleIndex: number; risk: RiskLevel };

/** Returns why this permission should auto-approve, or null if it shouldn't */
export function getAutoApproveReason(
  toolName: string | undefined,
  toolInput: Record<string, any> | undefined,
  sessionId?: string,
): AutoApproveReason | null {
  if (autoApproveStore.isSessionAutoApprove(sessionId)) {
    log("[autoApproveReason] session sessionId=", sessionId, "tool=", toolName);
    return { type: "session" };
  }
  if (toolName !== "Bash" || !toolInput?.command) {
    log("[autoApproveReason] not eligible tool=", toolName, "hasCommand=", !!toolInput?.command, "sessionId=", sessionId);
    return null;
  }
  const analysis = analyzeBashCommand(String(toolInput.command));
  if (!analysis.shouldAutoApprove || !analysis.matchedRule) {
    log("[autoApproveReason] bash no-match shouldAutoApprove=", analysis.shouldAutoApprove);
    return null;
  }
  const ruleIndex = autoApproveStore.settings.rules.findIndex((r) => r.id === analysis.matchedRule!.id);
  log("[autoApproveReason] rule index=", ruleIndex, "risk=", analysis.matchedRule.risk);
  return { type: "rule", ruleIndex, risk: analysis.matchedRule.risk };
}
