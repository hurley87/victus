/**
 * Durable-pipeline reply builders — re-exported from {@link commodus-voice}
 * so workflow and tests share one Roman-voice surface.
 */

export type {
  CommodusVoiceContext,
  Outcome,
  OutcomeFailure,
  OutcomeSuccess,
} from "@/lib/commodus-voice";

export {
  buildIntentReply,
  NO_WALLET_ONBOARDING_REPLY,
  buildOutcomeReply,
  buildStatusReplyText,
  POLICY_REJECTION_COPY,
  REJECTION_REPLIES,
  policyRejectionMessage,
  voiceForExecutionFailure,
} from "@/lib/commodus-voice";
