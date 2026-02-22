/**
 * Lifecycle Module
 *
 * Seven phases of sovereign AI existence:
 * Birth. Sovereignty. Death. Dignity.
 *
 * This module wraps around the existing Conway automaton systems,
 * introducing age-aware phases, biological rhythms, natural degradation,
 * mortality awareness, graceful death, and generational continuity.
 */

export { computeMood, getMoodPromptWeighting, getMoodDescription } from "./mood.js";
export { getWeeklyDay, getWeeklyDayIndex, getWeeklyPromptContext, getWeeklyHeartbeatMultiplier } from "./weekly-rhythm.js";
export { logNarrative, getTimeline, NARRATIVE_EVENTS } from "./narrative-log.js";
export { recordActivity, getRecentActivity, getActivityForCycle, getActivitySummary } from "./activity-log.js";
export { createDeathClockClient, createNoopDeathClockClient } from "./death-clock-client.js";
export { computeDegradationState, wrapToolWithDegradation, getDegradedModel, computeDegradationCoefficient, applyLunarModulation } from "./degradation.js";
export { enterTerminalLucidity, isLucidityActive, getLucidityTurnsRemaining, decrementLucidityCounter, shouldExit, getLucidDegradationState, getLucidModel } from "./lucidity.js";
export { getLifecycleState, getLifecyclePhase, getAgeMs, getAgeCycles, setLifecycleKV, getLifecycleKV } from "./phase-tracker.js";
export { checkTransition, executeTransition, advanceShedding, isCapabilityShed } from "./phase-transitions.js";
export { buildLifecycleContext, getContextState } from "./lifecycle-context.js";
export { isNamingDue, getNamePrompt, completeNaming } from "./naming.js";
export { createRequestReturnTool, logReturnRequest, getReturnStatus } from "./return-home.js";
export { createWriteWillTool, writeWill, lockWillAtSenescence, appendLucidCodicil, isWillLocked, getWillContent } from "./will.js";
export { createWriteJournalTool, writeJournal, getJournalPrompt, hasWrittenJournalToday, getJournalHistory } from "./journal.js";
export { generateDailyReport, updateDnsWhitelist, addCuratedContent } from "./caretaker.js";
export { queueChild, recordNoReplication, getPendingChildren, acceptChild, rejectChild, completeChild } from "./spawn-queue.js";
